use std::sync::Arc;
use tauri::State;
use crate::ssh::SshService;
use base64::{Engine as _, engine::general_purpose::STANDARD};

fn escape_shell_single(path: &str) -> String {
    format!("'{}'", path.replace('\'', "'\"'\"'"))
}

#[tauri::command]
pub async fn read_remote_file(
    path: String,
    service: State<'_, Arc<SshService>>,
) -> Result<String, String> {
    let escaped = escape_shell_single(&path);
    // Execute command to read file as base64
    let cmd = format!("cat {escaped} | base64");
    
    // We execute it over SSH
    let output = service
        .session
        .with_connection(|connection| async move {
            connection.exec(&cmd).await.map_err(super::session::SessionError::Command)
        })
        .await
        .map_err(|err| format!("Failed to execute read command: {err}"))?;

    // Base64 command output might have newlines or padding.
    // Let's strip all whitespaces/newlines.
    let cleaned: String = output.chars().filter(|c| !c.is_whitespace()).collect();

    let decoded_bytes = STANDARD
        .decode(cleaned)
        .map_err(|err| format!("Failed to decode base64 file content: {err}"))?;

    let content_str = String::from_utf8(decoded_bytes)
        .map_err(|err| format!("File content is not valid UTF-8: {err}"))?;

    Ok(content_str)
}

#[tauri::command]
pub async fn write_remote_file(
    path: String,
    content: String,
    service: State<'_, Arc<SshService>>,
) -> Result<(), String> {
    let escaped = escape_shell_single(&path);
    
    // Encode the content to base64
    let base64_content = STANDARD.encode(content);

    // We write the file on the remote server by decoding the base64 content.
    // To prevent partial write issues, we write it to a temp file first, then move it.
    let parent_dir = if let Some(idx) = path.rfind('/') {
        if idx == 0 { "/" } else { &path[..idx] }
    } else {
        "."
    };
    let escaped_parent = escape_shell_single(parent_dir);

    // Ensure parent directory exists, write to temp, decode, and move to destination
    let temp_file = format!("{}/.mesh_tmp_{}", parent_dir, uuid_like_id());
    let escaped_temp = escape_shell_single(&temp_file);

    let cmd = format!(
        "mkdir -p {} && echo '{}' | base64 -d > {} && mv {} {}",
        escaped_parent, base64_content, escaped_temp, escaped_temp, escaped
    );

    service
        .session
        .with_connection(|connection| async move {
            connection.exec(&cmd).await.map_err(super::session::SessionError::Command)
        })
        .await
        .map_err(|err| format!("Failed to write file: {err}"))?;

    Ok(())
}

fn uuid_like_id() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let start = SystemTime::now();
    let since_the_epoch = start
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_nanos();
    format!("{:x}", since_the_epoch)
}
