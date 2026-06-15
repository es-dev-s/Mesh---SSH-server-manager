use std::collections::HashMap;
use std::sync::Arc;
use tokio::sync::Mutex;
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tauri::{AppHandle, Emitter, State};
use crate::ssh::SshService;
use russh::ChannelMsg;

pub enum TerminalAction {
    Input(String),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct TerminalSession {
    pub sender: UnboundedSender<TerminalAction>,
}

#[derive(Default)]
pub struct TerminalRegistry {
    pub sessions: Mutex<HashMap<String, TerminalSession>>,
}

#[tauri::command]
pub async fn create_terminal_session(
    id: String,
    cols: u16,
    rows: u16,
    service: State<'_, Arc<SshService>>,
    registry: State<'_, TerminalRegistry>,
    app: AppHandle,
) -> Result<(), String> {
    // 1. Open a new SSH channel
    let mut channel = service
        .open_session_channel()
        .await
        .map_err(|err| err.to_string())?;

    // 2. Request PTY
    channel
        .request_pty(
            true,
            "xterm-256color",
            cols as u32,
            rows as u32,
            0,
            0,
            &[],
        )
        .await
        .map_err(|err| format!("PTY request failed: {err}"))?;

    // 3. Request Shell
    channel
        .request_shell(true)
        .await
        .map_err(|err| format!("Shell request failed: {err}"))?;

    // 4. Create communication channel
    let (input_tx, mut input_rx) = unbounded_channel::<TerminalAction>();

    // 5. Store in the registry
    {
        let mut sessions = registry.sessions.lock().await;
        sessions.insert(
            id.clone(),
            TerminalSession {
                sender: input_tx,
            },
        );
    }

    // 6. Spawn the combined event loop task
    let app_clone = app.clone();
    let session_id = id.clone();
    tokio::spawn(async move {
        loop {
            tokio::select! {
                action = input_rx.recv() => {
                    match action {
                        Some(TerminalAction::Input(data)) => {
                            if let Err(_) = channel.data(std::io::Cursor::new(data.as_bytes())).await {
                                break;
                            }
                        }
                        Some(TerminalAction::Resize { cols, rows }) => {
                            let _ = channel.window_change(cols, rows, 0, 0).await;
                        }
                        Some(TerminalAction::Close) | None => {
                            break;
                        }
                    }
                }
                msg = channel.wait() => {
                    match msg {
                        Some(ChannelMsg::Data { data }) => {
                            let output = String::from_utf8_lossy(&data).to_string();
                            let _ = app_clone.emit(&format!("terminal-data:{}", session_id), output);
                        }
                        Some(ChannelMsg::ExtendedData { data, .. }) => {
                            let output = String::from_utf8_lossy(&data).to_string();
                            let _ = app_clone.emit(&format!("terminal-data:{}", session_id), output);
                        }
                        Some(ChannelMsg::Eof) | Some(ChannelMsg::Close) | None => {
                            break;
                        }
                        _ => {}
                    }
                }
            }
        }

        // Clean up when closed
        let _ = app_clone.emit(&format!("terminal-closed:{}", session_id), ());
    });

    Ok(())
}

#[tauri::command]
pub async fn write_terminal_input(
    id: String,
    input: String,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let sessions = registry.sessions.lock().await;
    if let Some(session) = sessions.get(&id) {
        session
            .sender
            .send(TerminalAction::Input(input))
            .map_err(|err| err.to_string())?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub async fn resize_terminal_session(
    id: String,
    cols: u16,
    rows: u16,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let sessions = registry.sessions.lock().await;
    if let Some(session) = sessions.get(&id) {
        session
            .sender
            .send(TerminalAction::Resize {
                cols: cols as u32,
                rows: rows as u32,
            })
            .map_err(|err| err.to_string())?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub async fn close_terminal_session(
    id: String,
    registry: State<'_, TerminalRegistry>,
) -> Result<(), String> {
    let mut sessions = registry.sessions.lock().await;
    if let Some(session) = sessions.remove(&id) {
        let _ = session.sender.send(TerminalAction::Close);
    }
    Ok(())
}
