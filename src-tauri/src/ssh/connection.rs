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
    #[error("SSH command failed: {0}")]
    Command(String),
    #[error("SSH key error: {0}")]
    Key(String),
}

struct ClientHandler;

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
        client_config.keepalive_interval = Some(Duration::from_secs(30));
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
        let session = self.session.lock().await;
        let mut channel = session
            .channel_open_session()
            .await
            .map_err(|error| SshError::Command(error.to_string()))?;

        channel
            .exec(true, command.as_bytes())
            .await
            .map_err(|error| SshError::Command(error.to_string()))?;

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
                Some(ChannelMsg::Eof) | None => break,
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

    pub async fn health_check(&self) -> Result<(), SshError> {
        let response = self.exec("echo mesh-health-ok").await?;
        if response == "mesh-health-ok" {
            Ok(())
        } else {
            Err(SshError::Command(format!(
                "unexpected health check response: {response}"
            )))
        }
    }

    pub async fn disconnect(&self) {
        let session = self.session.lock().await;
        let _ = session
            .disconnect(Disconnect::ByApplication, "", "English")
            .await;
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
