use std::env;
use std::path::{Path, PathBuf};

use thiserror::Error;

#[derive(Debug, Clone)]
pub struct SshConfig {
    pub name: String,
    pub user: String,
    pub host: String,
    pub port: u16,
    pub password: Option<String>,
    pub key_path: Option<PathBuf>,
    pub key_passphrase: Option<String>,
    pub health_interval_secs: u64,
    pub stats_interval_secs: u64,
    pub initial_retry_ms: u64,
    pub max_retry_ms: u64,
    pub connect_timeout_secs: u64,
    pub exec_timeout_secs: u64,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error("missing required environment variable: {0}")]
    MissingVar(&'static str),
    #[error("set SSH_PASSWORD or SSH_KEY_PATH in .env for authentication")]
    MissingAuth,
    #[error("SSH private key not found at: {0}")]
    KeyNotFound(String),
}

pub fn load_ssh_config() -> Result<SshConfig, ConfigError> {
    load_dotenv_files();

    let name = env::var("SSH_NAME").unwrap_or_else(|_| "es".into());
    let user = env::var("SSH_USER").unwrap_or_else(|_| name.clone());
    let host = required_var("SSH_HOST")?;
    let port = env::var("SSH_PORT")
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(22);

    let password = env::var("SSH_PASSWORD")
        .ok()
        .filter(|value| !value.is_empty());

    let key_path = env::var("SSH_KEY_PATH").ok().and_then(|value| {
        if value.is_empty() {
            return None;
        }
        let mut path = PathBuf::from(value);
        if !path.is_absolute() {
            if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
                path = Path::new(&manifest_dir).join("..").join(path);
            }
        }
        Some(path)
    });

    if password.is_none() && key_path.is_none() {
        return Err(ConfigError::MissingAuth);
    }

    if let Some(ref path) = key_path {
        if !path.exists() {
            return Err(ConfigError::KeyNotFound(path.display().to_string()));
        }
    }

    Ok(SshConfig {
        name,
        user,
        host,
        port,
        password,
        key_path,
        key_passphrase: env::var("SSH_KEY_PASSPHRASE").ok(),
        health_interval_secs: parse_u64("SSH_HEALTH_INTERVAL_SECS", 10),
        stats_interval_secs: parse_u64("SSH_STATS_INTERVAL_SECS", 15),
        initial_retry_ms: parse_u64("SSH_INITIAL_RETRY_MS", 2_000),
        max_retry_ms: parse_u64("SSH_MAX_RETRY_MS", 30_000),
        connect_timeout_secs: parse_u64("SSH_CONNECT_TIMEOUT_SECS", 15),
        exec_timeout_secs: parse_u64("SSH_EXEC_TIMEOUT_SECS", 45),
    })
}

fn required_var(name: &'static str) -> Result<String, ConfigError> {
    env::var(name).map_err(|_| ConfigError::MissingVar(name))
}

fn parse_u64(name: &str, default: u64) -> u64 {
    env::var(name)
        .ok()
        .and_then(|value| value.parse().ok())
        .unwrap_or(default)
}

fn load_dotenv_files() {
    let _ = dotenvy::dotenv();

    if let Ok(manifest_dir) = env::var("CARGO_MANIFEST_DIR") {
        let candidates = [
            Path::new(&manifest_dir).join("../.env"),
            Path::new(&manifest_dir).join(".env"),
        ];

        for candidate in candidates {
            if candidate.exists() {
                let _ = dotenvy::from_path(candidate);
            }
        }
    }
}
