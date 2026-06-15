use std::sync::Arc;
use std::time::Duration;

use async_trait::async_trait;
use russh::client::{self, Handler, KeyboardInteractiveAuthResponse};
use russh::{ChannelMsg, Disconnect};
use russh_keys::key::KeyPair;
use thiserror::Error;
use tokio::sync::Mutex;
use tokio::time::timeout;

use super::config::SshConfig;

#[derive(Debug, Error)]
pub enum SshError {
    #[error("SSH connection failed: {0}")]
    Connect(String),
    #[error("SSH authentication failed: {0}")]
    Auth(String),
    /// Remote command returned non-zero, timed out, or produced unexpected output.
    /// The transport session remains usable.
    #[error("SSH command failed: {0}")]
    Command(String),
    /// TCP/session/channel failure — the shared connection should be re-established.
    #[error("SSH transport error: {0}")]
    Transport(String),
    #[error("SSH key error: {0}")]
    Key(String),
}

impl SshError {
    /// True when the shared SSH session is no longer usable and must reconnect.
    pub fn is_transport_error(&self) -> bool {
        matches!(self, SshError::Connect(_) | SshError::Transport(_))
    }

    /// Transient failure opening a new channel (server MaxSessions, momentary load).
    /// Does not mean the existing TCP/keepalive transport is dead.
    pub fn is_ephemeral_channel_open_failure(&self) -> bool {
        match self {
            SshError::Transport(message) => {
                let lower = message.to_lowercase();
                lower.contains("connectfailed")
                    || lower.contains("failed to open channel")
                    || lower.contains("maximum")
                    || lower.contains("too many")
                    || lower.contains("resource shortage")
                    || lower.contains("channel failure")
                    || lower.contains("open refused")
            }
            _ => false,
        }
    }

    /// Confirmed transport death — not a transient probe channel-open failure.
    pub fn is_fatal_transport_error(&self) -> bool {
        match self {
            SshError::Connect(_) => true,
            SshError::Transport(_) => {
                self.is_transport_error() && !self.is_ephemeral_channel_open_failure()
            }
            _ => false,
        }
    }
}

pub struct ClientHandler;

#[async_trait]
impl Handler for ClientHandler {
    type Error = russh::Error;

    async fn check_server_key(
        &mut self,
        _server_public_key: &russh_keys::key::PublicKey,
    ) -> Result<bool, Self::Error> {
        Ok(true)
    }
}

pub struct SshConnection {
    session: Arc<Mutex<client::Handle<ClientHandler>>>,
    exec_timeout: Duration,
}

impl SshConnection {
    pub async fn connect(config: &SshConfig) -> Result<Self, SshError> {
        let mut client_config = client::Config::default();
        // Keep the TCP session warm through NAT/firewall idle timeouts.
        client_config.keepalive_interval = Some(Duration::from_secs(15));
        client_config.keepalive_max = 5;
        let client_config = Arc::new(client_config);
        let handler = ClientHandler;

        let connect_future = client::connect(
            client_config,
            (config.host.as_str(), config.port),
            handler,
        );

        let mut session = timeout(
            Duration::from_secs(config.connect_timeout_secs),
            connect_future,
        )
        .await
        .map_err(|_| {
            SshError::Connect(format!(
                "timed out after {}s connecting to {}:{}",
                config.connect_timeout_secs, config.host, config.port
            ))
        })?
        .map_err(|error| SshError::Connect(error.to_string()))?;

        let auth_result = authenticate(config, &mut session).await?;

        if auth_result {
            Ok(Self {
                session: Arc::new(Mutex::new(session)),
                exec_timeout: Duration::from_secs(config.exec_timeout_secs),
            })
        } else {
            Err(SshError::Auth(format!(
                "all authentication methods failed for {}@{}",
                config.user, config.host
            )))
        }
    }

    pub async fn exec(&self, command: &str) -> Result<String, SshError> {
        timeout(self.exec_timeout, self.exec_inner(command))
            .await
            .map_err(|_| {
                SshError::Command(format!(
                    "command timed out after {}s",
                    self.exec_timeout.as_secs()
                ))
            })?
    }

    async fn exec_inner(&self, command: &str) -> Result<String, SshError> {
        // Hold the session mutex only while opening the channel, not during I/O.
        let mut channel = {
            let session = self.session.lock().await;
            session
                .channel_open_session()
                .await
                .map_err(|error| SshError::Transport(error.to_string()))?
        };

        channel
            .exec(true, command.as_bytes())
            .await
            .map_err(|error| SshError::Transport(error.to_string()))?;

        let mut stdout = String::new();
        let mut stderr = String::new();
        let mut exit_code = 0u32;

        loop {
            match channel.wait().await {
                Some(ChannelMsg::Data { data }) => {
                    stdout.push_str(&String::from_utf8_lossy(&data));
                }
                Some(ChannelMsg::ExtendedData { data, .. }) => {
                    stderr.push_str(&String::from_utf8_lossy(&data));
                }
                Some(ChannelMsg::ExitStatus { exit_status }) => {
                    exit_code = exit_status;
                }
                Some(ChannelMsg::Eof) => break,
                Some(ChannelMsg::Close) => {
                    return Err(SshError::Transport(
                        "exec channel closed before completion".into(),
                    ));
                }
                None => {
                    return Err(SshError::Transport(
                        "exec channel closed unexpectedly".into(),
                    ));
                }
                _ => {}
            }
        }

        if exit_code != 0 {
            let detail = if stderr.is_empty() {
                stdout.trim().to_string()
            } else {
                stderr.trim().to_string()
            };

            return Err(SshError::Command(format!(
                "command exited with status {exit_code}: {detail}"
            )));
        }

        Ok(stdout.trim().to_string())
    }

    pub async fn disconnect(&self) {
        let session = self.session.lock().await;
        let _ = session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
    }

    pub async fn open_channel(&self) -> Result<russh::Channel<russh::client::Msg>, SshError> {
        log::debug!("channel_open_session: waiting for session mutex");
        let channel = {
            let session = self.session.lock().await;
            log::debug!("channel_open_session: acquired session mutex");
            session
                .channel_open_session()
                .await
                .map_err(|error| SshError::Transport(error.to_string()))?
        };
        log::info!("channel_open_session: success");
        Ok(channel)
    }
}

fn load_key(path: &std::path::Path, passphrase: Option<&str>) -> Result<KeyPair, SshError> {
    russh_keys::load_secret_key(path, passphrase)
        .map_err(|error| SshError::Key(error.to_string()))
}

async fn authenticate(
    config: &SshConfig,
    session: &mut client::Handle<ClientHandler>,
) -> Result<bool, SshError> {
    if let Some(key_path) = &config.key_path {
        let key_pair = load_key(key_path, config.key_passphrase.as_deref())?;
        if session
            .authenticate_publickey(&config.user, Arc::new(key_pair))
            .await
            .map_err(|error| SshError::Auth(error.to_string()))?
        {
            return Ok(true);
        }
    }

    if let Some(password) = &config.password {
        if session
            .authenticate_password(&config.user, password)
            .await
            .map_err(|error| SshError::Auth(error.to_string()))?
        {
            return Ok(true);
        }

        if try_keyboard_interactive(session, &config.user, password).await? {
            return Ok(true);
        }
    }

    if config.key_path.is_none() && config.password.is_none() {
        return Err(SshError::Auth(
            "no SSH_PASSWORD or SSH_KEY_PATH configured".into(),
        ));
    }

    Ok(false)
}

async fn try_keyboard_interactive(
    session: &mut client::Handle<ClientHandler>,
    user: &str,
    password: &str,
) -> Result<bool, SshError> {
    let mut response = session
        .authenticate_keyboard_interactive_start(user, None)
        .await
        .map_err(|error| SshError::Auth(error.to_string()))?;

    loop {
        match response {
            KeyboardInteractiveAuthResponse::Success => return Ok(true),
            KeyboardInteractiveAuthResponse::Failure => return Ok(false),
            KeyboardInteractiveAuthResponse::InfoRequest { prompts, .. } => {
                let answers: Vec<String> = prompts
                    .iter()
                    .map(|prompt| {
                        if prompt.echo {
                            password.to_string()
                        } else {
                            password.to_string()
                        }
                    })
                    .collect();

                response = session
                    .authenticate_keyboard_interactive_respond(answers)
                    .await
                    .map_err(|error| SshError::Auth(error.to_string()))?;
            }
        }
    }
}
