use thiserror::Error;

use super::connection::{SshConnection, SshError};
use super::types::RemoteEntry;

#[derive(Debug, Error)]
pub enum ExplorerError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("SSH session expired — reconnecting")]
    SessionExpired,
    #[error("invalid path: {0}")]
    InvalidPath(String),
    #[error("failed to parse directory listing: {0}")]
    Parse(String),
}

impl ExplorerError {
    pub fn is_transport_error(&self) -> bool {
        match self {
            ExplorerError::Ssh(error) => error.is_transport_error(),
            ExplorerError::SessionExpired => true,
            ExplorerError::InvalidPath(_) | ExplorerError::Parse(_) => false,
        }
    }

    pub fn is_probe_channel_failure(&self) -> bool {
        match self {
            ExplorerError::Ssh(error) => error.is_ephemeral_channel_open_failure(),
            _ => false,
        }
    }

    pub fn is_fatal_transport_error(&self) -> bool {
        match self {
            ExplorerError::Ssh(error) => error.is_fatal_transport_error(),
            ExplorerError::SessionExpired => true,
            ExplorerError::InvalidPath(_) | ExplorerError::Parse(_) => false,
        }
    }
}

pub async fn list_directory(
    connection: &SshConnection,
    path: &str,
) -> Result<Vec<RemoteEntry>, ExplorerError> {
    validate_remote_path(path)?;

    let escaped = escape_shell_single(path);
    let script = format!(
        r#"sh -c 'find {escaped} -maxdepth 1 -mindepth 1 \( -type f -o -type d -o -type l \) -printf "%y|%f\n" 2>/dev/null | sort'"#
    );

    let payload = connection.exec(&script).await?;
    parse_directory_listing(&payload)
}

pub async fn resolve_home(connection: &SshConnection) -> Result<String, ExplorerError> {
    let payload = connection
        .exec(r#"sh -c 'printf %s "$HOME"'"#)
        .await?
        .trim()
        .to_string();

    if payload.is_empty() {
        return Err(ExplorerError::InvalidPath(
            "could not resolve remote home directory".into(),
        ));
    }

    validate_remote_path(&payload)?;
    Ok(payload)
}

pub async fn create_directory(
    connection: &SshConnection,
    path: &str,
) -> Result<(), ExplorerError> {
    validate_remote_path(path)?;
    validate_entry_name(path.rsplit('/').next().unwrap_or(""))?;

    let escaped = escape_shell_single(path);
    let script = format!(r#"sh -c 'mkdir -p {escaped}'"#);
    connection.exec(&script).await?;
    Ok(())
}

pub async fn create_file(connection: &SshConnection, path: &str) -> Result<(), ExplorerError> {
    validate_remote_path(path)?;
    validate_entry_name(path.rsplit('/').next().unwrap_or(""))?;

    let parent = path.rfind('/').map(|index| &path[..index]).unwrap_or("/");
    validate_remote_path(parent)?;

    let escaped_parent = escape_shell_single(parent);
    let escaped = escape_shell_single(path);
    let script = format!(r#"sh -c 'mkdir -p {escaped_parent} && : > {escaped}'"#);
    connection.exec(&script).await?;
    Ok(())
}

fn validate_entry_name(name: &str) -> Result<(), ExplorerError> {
    if name.is_empty() || name.len() > 255 {
        return Err(ExplorerError::InvalidPath(
            "name must be 1–255 characters".into(),
        ));
    }
    if name == "." || name == ".." || name.contains('/') {
        return Err(ExplorerError::InvalidPath("invalid file or folder name".into()));
    }
    Ok(())
}

fn validate_remote_path(path: &str) -> Result<(), ExplorerError> {
    if !path.starts_with('/') {
        return Err(ExplorerError::InvalidPath(
            "path must be absolute".into(),
        ));
    }
    if path.contains("..") {
        return Err(ExplorerError::InvalidPath(
            "path traversal is not allowed".into(),
        ));
    }
    if path.len() > 4096 {
        return Err(ExplorerError::InvalidPath("path is too long".into()));
    }
    Ok(())
}

fn escape_shell_single(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\"'\"'"))
}

fn parse_directory_listing(payload: &str) -> Result<Vec<RemoteEntry>, ExplorerError> {
    let mut entries = Vec::new();

    for line in payload.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let parts: Vec<&str> = line.splitn(2, '|').collect();
        if parts.len() != 2 {
            continue;
        }

        let name = parts[1].trim();
        if name.is_empty() || name == "." || name == ".." {
            continue;
        }

        let entry_type = match parts[0] {
            "d" => "folder",
            "f" | "l" => "file",
            _ => continue,
        };

        entries.push(RemoteEntry {
            name: name.to_string(),
            entry_type: entry_type.to_string(),
            kind: classify_file_kind(name),
        });
    }

    Ok(entries)
}

fn classify_file_kind(name: &str) -> String {
    let lower = name.to_lowercase();
    let ext = lower.rsplit('.').next().unwrap_or("");

    match ext {
        "ts" | "tsx" | "js" | "jsx" | "rs" | "py" | "go" | "java" | "sh" | "bash" | "sql" => {
            "code".into()
        }
        "json" | "yaml" | "yml" | "toml" | "env" | "conf" | "cfg" | "ini" | "xml" => "config".into(),
        "log" => "log".into(),
        "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg" | "ico" => "image".into(),
        "zip" | "tar" | "gz" | "bz2" | "xz" | "7z" | "rar" | "dump" | "rdb" => "archive".into(),
        "md" | "txt" | "pdf" | "doc" | "docx" => "doc".into(),
        _ => "doc".into(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_traversal() {
        assert!(validate_remote_path("/home/../etc").is_err());
    }

    #[test]
    fn parses_find_output() {
        let payload = "d|src\nf|package.json\nf|server.js\n";
        let entries = parse_directory_listing(payload).unwrap();
        assert_eq!(entries.len(), 3);
        assert_eq!(entries[0].entry_type, "folder");
        assert_eq!(entries[1].kind, "config");
    }
}
