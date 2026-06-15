use std::sync::Arc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

use parking_lot::RwLock;
use tauri::AppHandle;
use tokio::time::sleep;

use super::collector::collect_metrics;
use super::config::{ConfigError, SshConfig};
use super::connection::SshConnection;
use super::explorer;
use super::pm2::collect_pm2;
use super::session::{SessionController, SessionError};
use super::types::{ConnectionState, RemoteEntry, SshSnapshot};

pub struct SshService {
    config: Option<SshConfig>,
    snapshot: Arc<RwLock<SshSnapshot>>,
    pub session: Arc<SessionController>,
}

impl SshService {
    pub fn new() -> Self {
        Self {
            config: None,
            snapshot: Arc::new(RwLock::new(SshSnapshot::misconfigured(
                "SSH service is initializing".into(),
            ))),
            session: Arc::new(SessionController::new()),
        }
    }

    pub fn snapshot(&self) -> SshSnapshot {
        self.snapshot.read().clone()
    }

    pub async fn list_directory(&self, path: &str) -> Result<Vec<RemoteEntry>, SessionError> {
        self.session
            .with_connection(|connection| async move {
                explorer::list_directory(&connection, path)
                    .await
                    .map_err(SessionError::Explorer)
            })
            .await
    }

    pub async fn open_session_channel(&self) -> Result<russh::Channel<russh::client::Msg>, SessionError> {
        self.session
            .with_connection(|connection| async move {
                connection
                    .open_channel()
                    .await
                    .map_err(SessionError::Command)
            })
            .await
    }

    pub fn initialize(&mut self) {
        match super::config::load_ssh_config() {
            Ok(config) => {
                let snapshot = SshSnapshot::disconnected(&config, None);
                *self.snapshot.write() = snapshot;
                self.config = Some(config);
            }
            Err(error) => {
                *self.snapshot.write() = SshSnapshot::misconfigured(error.to_string());
            }
        }
    }

    pub async fn run_monitor(self: Arc<Self>, app: AppHandle) {
        let Some(config) = self.config.clone() else {
            self.session.publish(&self.snapshot, &app, self.snapshot());
            return;
        };

        let mut retry_delay = config.initial_retry_ms;
        let mut reconnect_attempts = 0u32;

        loop {
            self.publish_state(
                &app,
                ConnectionState::Connecting,
                None,
                Some("Opening secure channel to remote device…".into()),
                reconnect_attempts,
            );

            match SshConnection::connect(&config).await {
                Ok(connection) => {
                    self.session.next_session_id();
                    self.session.register(Arc::new(connection)).await;

                    reconnect_attempts = 0;
                    retry_delay = config.initial_retry_ms;

                    self.publish_state(
                        &app,
                        ConnectionState::Connecting,
                        None,
                        Some("Session established — collecting device metrics…".into()),
                        0,
                    );

                    if let Err(error) = self.refresh_metrics(&config, &app).await {
                        self.session.teardown().await;
                        reconnect_attempts = reconnect_attempts.saturating_add(1);
                        self.publish_state(
                            &app,
                            ConnectionState::Reconnecting,
                            Some(error.to_string()),
                            Some(format!(
                                "Metrics collection failed — retrying in {}s",
                                retry_delay / 1000
                            )),
                            reconnect_attempts,
                        );
                        sleep(Duration::from_millis(retry_delay)).await;
                        retry_delay = next_retry_delay(retry_delay, config.max_retry_ms);
                        continue;
                    }

                    self.publish_state(
                        &app,
                        ConnectionState::Connected,
                        None,
                        Some("Live session — monitoring device health".into()),
                        0,
                    );

                    let stats_every_ticks =
                        (config.stats_interval_secs / config.health_interval_secs).max(1);
                    let mut ticks_since_stats = 0u64;

                    loop {
                        sleep(Duration::from_secs(config.health_interval_secs)).await;

                        if !self.session.is_active().await {
                            break;
                        }

                        if let Err(error) = self
                            .session
                            .with_connection(|connection| async move {
                                connection
                                    .health_check()
                                    .await
                                    .map_err(SessionError::Command)
                            })
                            .await
                        {
                            reconnect_attempts = reconnect_attempts.saturating_add(1);
                            self.publish_state(
                                &app,
                                ConnectionState::Reconnecting,
                                Some(format!("Health check failed: {error}")),
                                Some("Connection dropped — re-establishing session…".into()),
                                reconnect_attempts,
                            );
                            self.session.teardown().await;
                            break;
                        }

                        ticks_since_stats = ticks_since_stats.saturating_add(1);
                        if ticks_since_stats >= stats_every_ticks {
                            ticks_since_stats = 0;
                            if let Err(error) = self.refresh_metrics(&config, &app).await {
                                reconnect_attempts = reconnect_attempts.saturating_add(1);
                                self.publish_state(
                                    &app,
                                    ConnectionState::Reconnecting,
                                    Some(error.to_string()),
                                    Some("Refreshing metrics — reconnecting…".into()),
                                    reconnect_attempts,
                                );
                                self.session.teardown().await;
                                break;
                            }
                        }
                    }
                }
                Err(error) => {
                    reconnect_attempts = reconnect_attempts.saturating_add(1);
                    self.publish_state(
                        &app,
                        ConnectionState::Reconnecting,
                        Some(error.to_string()),
                        Some(format!(
                            "Connection failed — retrying in {}s (attempt {})",
                            retry_delay / 1000,
                            reconnect_attempts
                        )),
                        reconnect_attempts,
                    );
                }
            }

            sleep(Duration::from_millis(retry_delay)).await;
            retry_delay = next_retry_delay(retry_delay, config.max_retry_ms);
        }
    }

    async fn refresh_metrics(
        &self,
        config: &SshConfig,
        app: &AppHandle,
    ) -> Result<(), SessionError> {
        let snapshot_store = self.snapshot.clone();
        let session = self.session.clone();
        let config = config.clone();
        let app = app.clone();

        self.session
            .with_connection(|connection| async move {
                let (specs, storage) = collect_metrics(&connection)
                    .await
                    .map_err(|error| SessionError::Operation(error.to_string()))?;
                let pm2 = collect_pm2(&connection)
                    .await
                    .map_err(|error| SessionError::Operation(error.to_string()))?;
                let now = unix_timestamp();

                let mut snapshot = snapshot_store.read().clone();
                snapshot.state = ConnectionState::Connected;
                snapshot.name = config.name;
                snapshot.user = config.user;
                snapshot.host = config.host;
                snapshot.port = config.port;
                snapshot.last_connected_at = Some(now.clone());
                snapshot.last_updated_at = Some(now);
                snapshot.last_error = None;
                snapshot.status_message =
                    Some("Live session — monitoring device health".into());
                snapshot.reconnect_attempts = 0;
                snapshot.specs = Some(specs);
                snapshot.storage = Some(storage);
                snapshot.pm2 = Some(pm2);

                session.publish(&snapshot_store, &app, snapshot);
                Ok(())
            })
            .await
    }

    fn publish_state(
        &self,
        app: &AppHandle,
        state: ConnectionState,
        error: Option<String>,
        status_message: Option<String>,
        reconnect_attempts: u32,
    ) {
        let mut snapshot = self.snapshot.read().clone();
        snapshot.state = state;
        snapshot.last_error = error;
        snapshot.status_message = status_message;
        snapshot.reconnect_attempts = reconnect_attempts;
        snapshot.last_updated_at = Some(unix_timestamp());

        if matches!(state, ConnectionState::Disconnected | ConnectionState::Misconfigured) {
            snapshot.specs = None;
            snapshot.storage = None;
            snapshot.pm2 = None;
        }

        self.session.publish(&self.snapshot, app, snapshot);
    }
}

pub fn config_error_message(error: ConfigError) -> String {
    error.to_string()
}

fn next_retry_delay(current: u64, max: u64) -> u64 {
    (current.saturating_mul(2)).min(max)
}

fn unix_timestamp() -> String {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}
