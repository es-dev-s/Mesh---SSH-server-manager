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
        let result = self
            .session
            .with_connection(|connection| async move {
                explorer::list_directory(&connection, path)
                    .await
                    .map_err(SessionError::Explorer)
            })
            .await;
        if result.is_ok() {
            self.session.reset_probe_failure_streak();
        }
        result
    }

    pub async fn open_session_channel(
        &self,
    ) -> Result<russh::Channel<russh::client::Msg>, SessionError> {
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

    /// Connection lifecycle:
    /// 1. Connect + authenticate (new TCP session)
    /// 2. Collect metrics (command failures do NOT tear down the session)
    /// 3. Monitor loop — russh keepalive is primary transport liveness; metrics probes
    ///    use a consecutive-failure threshold before teardown (transient channel-open
    ///    failures must not kill long-lived PTY tabs).
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
                    self.session.reset_probe_failure_streak();
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

                    match self.refresh_metrics(&config, &app).await {
                        Ok(()) => {
                            self.session.reset_probe_failure_streak();
                        }
                        Err(error) if error.is_fatal_transport_error() => {
                            self.session
                                .teardown(&format!("initial_metrics_refresh_fatal: {error}"))
                                .await;
                            reconnect_attempts = reconnect_attempts.saturating_add(1);
                            self.publish_state(
                                &app,
                                ConnectionState::Reconnecting,
                                Some(error.to_string()),
                                Some(format!(
                                    "Connection lost — retrying in {}s",
                                    retry_delay / 1000
                                )),
                                reconnect_attempts,
                            );
                            sleep(Duration::from_millis(retry_delay)).await;
                            retry_delay = next_retry_delay(retry_delay, config.max_retry_ms);
                            continue;
                        }
                        Err(error) if error.is_probe_channel_failure() => {
                            let streak = self.session.record_probe_failure();
                            log::warn!(
                                "initial metrics probe channel failure {streak}/{}: {error} — session kept alive",
                                config.probe_failure_threshold
                            );
                            self.session.publish_mut(&self.snapshot, &app, |snapshot| {
                                snapshot.state = ConnectionState::Connected;
                                snapshot.last_error = Some(format!(
                                    "Metrics temporarily unavailable ({streak}/{}): {error}",
                                    config.probe_failure_threshold
                                ));
                                snapshot.status_message =
                                    Some("Live session — metrics probe deferred".into());
                                snapshot.last_updated_at = Some(unix_timestamp());
                            });
                        }
                        Err(error) if error.is_transport_error() => {
                            self.session
                                .teardown(&format!("initial_metrics_refresh: {error}"))
                                .await;
                            reconnect_attempts = reconnect_attempts.saturating_add(1);
                            self.publish_state(
                                &app,
                                ConnectionState::Reconnecting,
                                Some(error.to_string()),
                                Some(format!(
                                    "Connection lost — retrying in {}s",
                                    retry_delay / 1000
                                )),
                                reconnect_attempts,
                            );
                            sleep(Duration::from_millis(retry_delay)).await;
                            retry_delay = next_retry_delay(retry_delay, config.max_retry_ms);
                            continue;
                        }
                        Err(error) => {
                            // Command/parse failures: stay connected, surface the error in snapshot.
                            self.publish_state(
                                &app,
                                ConnectionState::Connected,
                                Some(error.to_string()),
                                Some(
                                    "Live session — metrics temporarily unavailable".into(),
                                ),
                                0,
                            );
                        }
                    }

                    if !self.session.is_active().await {
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
                    let probe_threshold = config.probe_failure_threshold;

                    loop {
                        // Primary transport liveness: russh keepalive (15s interval, max 5 misses).
                        // No exec-based health probe — it opens an extra channel every tick and
                        // was tearing down live sessions on transient ConnectFailed under load.
                        sleep(Duration::from_secs(config.health_interval_secs)).await;

                        if !self.session.is_active().await {
                            break;
                        }

                        ticks_since_stats = ticks_since_stats.saturating_add(1);
                        if ticks_since_stats >= stats_every_ticks {
                            ticks_since_stats = 0;

                            let pty_count = self.session.list_pty_ids().await.len();
                            if pty_count > 0 {
                                log::debug!(
                                    "metrics refresh skipped — {pty_count} active PTY channel(s)"
                                );
                                self.session.publish_mut(&self.snapshot, &app, |snapshot| {
                                    if snapshot.state == ConnectionState::Connected {
                                        snapshot.last_error = None;
                                        snapshot.status_message = Some(format!(
                                            "Live session — {pty_count} terminal(s) active"
                                        ));
                                        snapshot.last_updated_at = Some(unix_timestamp());
                                    }
                                });
                                continue;
                            }

                            match self.refresh_metrics(&config, &app).await {
                                Ok(()) => {
                                    self.session.reset_probe_failure_streak();
                                }
                                Err(error) if error.is_fatal_transport_error() => {
                                    reconnect_attempts = reconnect_attempts.saturating_add(1);
                                    self.publish_state(
                                        &app,
                                        ConnectionState::Reconnecting,
                                        Some(error.to_string()),
                                        Some("Connection dropped — re-establishing session…".into()),
                                        reconnect_attempts,
                                    );
                                    self.session
                                        .teardown(&format!("metrics_refresh_fatal: {error}"))
                                        .await;
                                    break;
                                }
                                Err(error) if error.is_probe_channel_failure() => {
                                    let streak = self.session.record_probe_failure();
                                    log::warn!(
                                        "metrics probe channel failure {streak}/{probe_threshold}: {error}"
                                    );
                                    publish_metrics_degraded(
                                        &self.session,
                                        &self.snapshot,
                                        &app,
                                        &error,
                                        streak,
                                        probe_threshold,
                                    )
                                    .await;

                                    if streak >= probe_threshold {
                                        reconnect_attempts =
                                            reconnect_attempts.saturating_add(1);
                                        self.publish_state(
                                            &app,
                                            ConnectionState::Reconnecting,
                                            Some(format!(
                                                "Metrics probe failed {streak} times: {error}"
                                            )),
                                            Some(
                                                "Connection dropped — re-establishing session…"
                                                    .into(),
                                            ),
                                            reconnect_attempts,
                                        );
                                        self.session.teardown(&format!(
                                            "metrics_probe_streak_{streak}: {error}"
                                        )).await;
                                        break;
                                    }
                                }
                                Err(error) if error.is_transport_error() => {
                                    let streak = self.session.record_probe_failure();
                                    log::warn!(
                                        "metrics transport error {streak}/{probe_threshold}: {error}"
                                    );
                                    if streak >= probe_threshold {
                                        reconnect_attempts =
                                            reconnect_attempts.saturating_add(1);
                                        self.publish_state(
                                            &app,
                                            ConnectionState::Reconnecting,
                                            Some(error.to_string()),
                                            Some(
                                                "Connection dropped — re-establishing session…"
                                                    .into(),
                                            ),
                                            reconnect_attempts,
                                        );
                                        self.session
                                            .teardown(&format!(
                                                "metrics_transport_streak_{streak}: {error}"
                                            ))
                                            .await;
                                        break;
                                    }

                                    publish_metrics_degraded(
                                        &self.session,
                                        &self.snapshot,
                                        &app,
                                        &error,
                                        streak,
                                        probe_threshold,
                                    )
                                    .await;
                                }
                                Err(error) => {
                                    self.session.publish_mut(&self.snapshot, &app, |snapshot| {
                                        snapshot.last_error =
                                            Some(format!("Metrics refresh warning: {error}"));
                                        snapshot.last_updated_at = Some(unix_timestamp());
                                    });
                                }
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
                    .map_err(|error| match error {
                        super::collector::CollectError::Ssh(ssh) => SessionError::Command(ssh),
                        super::collector::CollectError::Parse(message) => {
                            SessionError::Operation(message)
                        }
                    })?;
                let pm2 = collect_pm2(&connection)
                    .await
                    .map_err(|error| match error {
                        super::pm2::Pm2CollectError::Ssh(ssh) => SessionError::Command(ssh),
                        super::pm2::Pm2CollectError::Parse(message) => {
                            SessionError::Operation(message)
                        }
                    })?;
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

async fn publish_metrics_degraded(
    session: &SessionController,
    snapshot_store: &RwLock<SshSnapshot>,
    app: &AppHandle,
    error: &SessionError,
    streak: u32,
    threshold: u32,
) {
    let pty_count = session.list_pty_ids().await.len();
    session.publish_mut(snapshot_store, app, |snapshot| {
        snapshot.last_updated_at = Some(unix_timestamp());
        if pty_count > 0 {
            snapshot.last_error = None;
            snapshot.status_message = Some(format!(
                "Live session — {pty_count} terminal(s) active"
            ));
            return;
        }
        snapshot.last_error = Some(format!(
            "Metrics probe deferred ({streak}/{threshold}): {error}"
        ));
        snapshot.status_message =
            Some("Live session — metrics temporarily unavailable".into());
    });
}
