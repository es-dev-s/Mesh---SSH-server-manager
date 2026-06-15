use std::collections::HashMap;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;
use std::time::Duration;

use crate::ssh::SshService;
use russh::ChannelMsg;
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};
use tokio::sync::Mutex;

pub enum TerminalAction {
    Input(String),
    Resize { cols: u32, rows: u32 },
    Close,
}

pub struct TerminalSession {
    pub sender: UnboundedSender<TerminalAction>,
    pub spawn_generation: u64,
}

pub struct TerminalRegistry {
    pub sessions: Mutex<HashMap<String, TerminalSession>>,
    spawn_counter: AtomicU64,
    /// Serializes `create_terminal_session` per terminal id (StrictMode double-mount).
    create_locks: Mutex<HashMap<String, Arc<Mutex<()>>>>,
}

impl Default for TerminalRegistry {
    fn default() -> Self {
        Self {
            sessions: Mutex::new(HashMap::new()),
            spawn_counter: AtomicU64::new(0),
            create_locks: Mutex::new(HashMap::new()),
        }
    }
}

impl TerminalRegistry {
    pub fn next_spawn_generation(&self) -> u64 {
        self.spawn_counter.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub async fn is_active_spawn(&self, id: &str, generation: u64) -> bool {
        self.sessions
            .lock()
            .await
            .get(id)
            .is_some_and(|session| session.spawn_generation == generation)
    }

    pub async fn list_session_ids(&self) -> Vec<String> {
        self.sessions.lock().await.keys().cloned().collect()
    }

    pub async fn active_spawn_generation(&self, id: &str) -> Option<u64> {
        self.sessions
            .lock()
            .await
            .get(id)
            .map(|session| session.spawn_generation)
    }

    async fn acquire_create_lock(&self, id: &str) -> tokio::sync::OwnedMutexGuard<()> {
        let lock = {
            let mut locks = self.create_locks.lock().await;
            locks
                .entry(id.to_string())
                .or_insert_with(|| Arc::new(Mutex::new(())))
                .clone()
        };
        lock.lock_owned().await
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalSessionInfo {
    pub id: String,
    pub cols: u32,
    pub rows: u32,
    pub spawn_generation: u64,
}

fn reopen_stagger_ms(terminal_id: &str) -> u64 {
    let hash = terminal_id
        .bytes()
        .fold(0u64, |acc, byte| acc.wrapping_mul(31).wrapping_add(u64::from(byte)));
    50 + (hash % 150)
}

fn format_pty_open_error(error: &str) -> String {
    let lower = error.to_lowercase();
    if lower.contains("too many")
        || lower.contains("maximum")
        || lower.contains("open refused")
        || lower.contains("resource shortage")
        || lower.contains("channel failure")
    {
        return "Too many concurrent terminal sessions on this SSH connection — close a tab and try again.".into();
    }
    error.to_string()
}

fn normalize_dimensions(cols: u32, rows: u32) -> (u32, u32) {
    (cols.max(1).min(500), rows.max(1).min(200))
}

fn is_ephemeral_open_error(error: &str) -> bool {
    let lower = error.to_lowercase();
    lower.contains("connectfailed")
        || lower.contains("failed to open channel")
        || lower.contains("maximum")
        || lower.contains("too many")
        || lower.contains("resource shortage")
        || lower.contains("channel failure")
        || lower.contains("open refused")
}

async fn shutdown_pty_channel(channel: &mut russh::Channel<russh::client::Msg>) {
    let _ = channel.eof().await;
    if channel.close().await.is_ok() {
        let _ = tokio::time::timeout(Duration::from_secs(2), async {
            while let Some(msg) = channel.wait().await {
                if matches!(msg, ChannelMsg::Close) {
                    break;
                }
            }
        })
        .await;
    }
}

async fn open_pty_channel_with_retry(
    service: &SshService,
    terminal_id: &str,
    cols: u32,
    rows: u32,
    ssh_session_id: u64,
    reason: &str,
) -> Result<russh::Channel<russh::client::Msg>, String> {
    const MAX_ATTEMPTS: u32 = 4;
    let mut last_error = String::new();

    for attempt in 1..=MAX_ATTEMPTS {
        match open_pty_channel(
            service,
            terminal_id,
            cols,
            rows,
            ssh_session_id,
            reason,
        )
        .await
        {
            Ok(channel) => return Ok(channel),
            Err(error) => {
                last_error = error.clone();
                if !is_ephemeral_open_error(&error) || attempt == MAX_ATTEMPTS {
                    break;
                }
                let delay_ms = 150 * u64::from(attempt) + reopen_stagger_ms(terminal_id) % 100;
                log::warn!(
                    "pty open retry terminal_id={terminal_id} attempt={attempt}/{MAX_ATTEMPTS} error={error} delay_ms={delay_ms}"
                );
                tokio::time::sleep(Duration::from_millis(delay_ms)).await;
            }
        }
    }

    Err(last_error)
}

async fn open_pty_channel(
    service: &SshService,
    terminal_id: &str,
    cols: u32,
    rows: u32,
    ssh_session_id: u64,
    reason: &str,
) -> Result<russh::Channel<russh::client::Msg>, String> {
    // TODO(tmux): When SSH_TERMINAL_TMUX=1, attach to a named tmux session here instead
    // of a raw shell so PTY state survives transport reconnects without re-running setup.

    let channel = service
        .open_session_channel()
        .await
        .map_err(|err| format_pty_open_error(&err.to_string()))?;

    channel
        .request_pty(true, "xterm-256color", cols, rows, 0, 0, &[])
        .await
        .map_err(|err| format_pty_open_error(&format!("PTY request failed: {err}")))?;

    channel
        .request_shell(true)
        .await
        .map_err(|err| format_pty_open_error(&format!("Shell request failed: {err}")))?;

    log::info!(
        "pty open terminal_id={terminal_id} ssh_session_id={ssh_session_id} cols={cols} rows={rows} reason={reason}"
    );

    service.session.reset_probe_failure_streak();

    Ok(channel)
}

async fn run_pty_loop(
    channel: &mut russh::Channel<russh::client::Msg>,
    app: &AppHandle,
    terminal_id: &str,
    input_rx: &mut tokio::sync::mpsc::UnboundedReceiver<TerminalAction>,
) -> bool {
    loop {
        tokio::select! {
            action = input_rx.recv() => {
                match action {
                    Some(TerminalAction::Input(data)) => {
                        if channel.data(std::io::Cursor::new(data.as_bytes())).await.is_err() {
                            return false;
                        }
                    }
                    Some(TerminalAction::Resize { cols, rows }) => {
                        let _ = channel.window_change(cols, rows, 0, 0).await;
                    }
                    Some(TerminalAction::Close) | None => {
                        return true;
                    }
                }
            }
            msg = channel.wait() => {
                match msg {
                    Some(ChannelMsg::Data { data }) => {
                        let output = String::from_utf8_lossy(&data).to_string();
                        let _ = app.emit(&format!("terminal-data:{terminal_id}"), output);
                    }
                    Some(ChannelMsg::ExtendedData { data, .. }) => {
                        let output = String::from_utf8_lossy(&data).to_string();
                        let _ = app.emit(&format!("terminal-data:{terminal_id}"), output);
                    }
                    Some(ChannelMsg::Eof) => {
                        // PTY stdin EOF — shell may still emit output; keep reading.
                    }
                    Some(ChannelMsg::Close) | None => {
                        return false;
                    }
                    _ => {}
                }
            }
        }
    }
}

async fn wait_for_new_session(
    session_controller: &crate::ssh::session::SessionController,
    session_watch: &mut tokio::sync::watch::Receiver<u64>,
    previous_session_id: u64,
    input_rx: &mut tokio::sync::mpsc::UnboundedReceiver<TerminalAction>,
) -> Result<u64, WaitAbort> {
    if let Some(new_id) = session_controller
        .next_connected_session_after(previous_session_id)
        .await
    {
        return Ok(new_id);
    }

    loop {
        tokio::select! {
            changed = session_watch.changed() => {
                if changed.is_err() {
                    return Err(WaitAbort::Cancelled);
                }
                if let Some(new_id) = session_controller
                    .next_connected_session_after(previous_session_id)
                    .await
                {
                    return Ok(new_id);
                }
            }
            action = input_rx.recv() => {
                match action {
                    Some(TerminalAction::Close) => return Err(WaitAbort::Closed),
                    Some(TerminalAction::Resize { .. }) | Some(TerminalAction::Input(_)) => {}
                    None => return Err(WaitAbort::Cancelled),
                }
            }
        }
    }
}

enum WaitAbort {
    Closed,
    Cancelled,
}

async fn reopen_pty_channel(
    service: &SshService,
    session_controller: &crate::ssh::session::SessionController,
    terminal_id: &str,
    cols: u32,
    rows: u32,
    ssh_session_id: u64,
) -> Result<russh::Channel<russh::client::Msg>, String> {
    let registration = session_controller
        .pty_registration(terminal_id)
        .await
        .unwrap_or(crate::ssh::session::PtyRegistration { cols, rows });
    open_pty_channel_with_retry(
        service,
        terminal_id,
        registration.cols,
        registration.rows,
        ssh_session_id,
        "reopen",
    )
    .await
}

async fn close_terminal_session_inner(
    id: &str,
    expected_spawn_generation: Option<u64>,
    service: &SshService,
    registry: &TerminalRegistry,
) {
    let sender = {
        let mut sessions = registry.sessions.lock().await;
        match sessions.get(id) {
            Some(session)
                if expected_spawn_generation
                    .map_or(true, |generation| generation == session.spawn_generation) =>
            {
                sessions.remove(id).map(|session| session.sender)
            }
            Some(_) => {
                log::info!(
                    "pty close ignored terminal_id={id} reason=stale_spawn_generation"
                );
                None
            }
            None => None,
        }
    };

    if sender.is_none() {
        return;
    }

    service.session.unregister_pty(id).await;

    if let Some(sender) = sender {
        let _ = sender.send(TerminalAction::Close);
    }

    log::info!("pty close requested terminal_id={id}");
}

async fn close_terminal_session_locked(
    id: &str,
    expected_spawn_generation: Option<u64>,
    service: &SshService,
    registry: &TerminalRegistry,
) {
    let _guard = registry.acquire_create_lock(id).await;
    close_terminal_session_inner(id, expected_spawn_generation, service, registry).await;
}

#[tauri::command]
pub async fn list_terminal_sessions(
    service: State<'_, std::sync::Arc<SshService>>,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
) -> Result<Vec<TerminalSessionInfo>, String> {
    let ids = registry.list_session_ids().await;
    let mut sessions = Vec::with_capacity(ids.len());

    for id in ids {
        let spawn_generation = registry
            .sessions
            .lock()
            .await
            .get(&id)
            .map(|session| session.spawn_generation)
            .unwrap_or(0);
        let registration = service
            .session
            .pty_registration(&id)
            .await
            .unwrap_or(crate::ssh::session::PtyRegistration {
                cols: 80,
                rows: 24,
            });

        sessions.push(TerminalSessionInfo {
            id,
            cols: registration.cols,
            rows: registration.rows,
            spawn_generation,
        });
    }

    Ok(sessions)
}

/// Drop backend PTY sessions that no longer have a matching frontend tab id.
#[tauri::command]
pub async fn sync_terminal_sessions(
    active_ids: Vec<String>,
    service: State<'_, std::sync::Arc<SshService>>,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
) -> Result<Vec<String>, String> {
    let active: std::collections::HashSet<String> = active_ids.into_iter().collect();
    let backend_ids = service.session.list_pty_ids().await;

    if active.is_empty() && !backend_ids.is_empty() {
        log::info!(
            "pty sync skipped — preserving {} backend sessions during empty active tab set",
            backend_ids.len()
        );
        return Ok(vec![]);
    }

    let mut closed = Vec::new();

    for id in backend_ids {
        if !active.contains(&id) {
            close_terminal_session_locked(&id, None, &service, &registry).await;
            closed.push(id);
        }
    }

    if !closed.is_empty() {
        log::info!("pty sync closed orphan terminal_ids={closed:?}");
    }

    Ok(closed)
}

#[tauri::command]
pub async fn create_terminal_session(
    id: String,
    cols: u16,
    rows: u16,
    service: State<'_, std::sync::Arc<SshService>>,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
    app: AppHandle,
) -> Result<u64, String> {
    let _create_guard = registry.inner().acquire_create_lock(&id).await;

    let cols = cols as u32;
    let rows = rows as u32;
    let (cols, rows) = normalize_dimensions(cols, rows);

    if service.session.is_pty_registered(&id).await {
        if let Some(existing_generation) = registry.active_spawn_generation(&id).await {
            log::info!(
                "pty create skipped terminal_id={id} reason=already_active spawn_generation={existing_generation}"
            );
            return Ok(existing_generation);
        }
    }

    let spawn_generation = registry.next_spawn_generation();
    let ssh_session_id = service.session.current_session_id();

    let active_count = registry.list_session_ids().await.len();
    log::info!(
        "pty create start terminal_id={id} spawn_generation={spawn_generation} active_registry_count={active_count}"
    );

    service
        .session
        .register_pty(id.clone(), cols, rows)
        .await;

    let channel_result = open_pty_channel_with_retry(
        &service,
        &id,
        cols,
        rows,
        ssh_session_id,
        "initial",
    )
    .await;

    let mut channel = match channel_result {
        Ok(channel) => channel,
        Err(error) => {
            service.session.unregister_pty(&id).await;
            if is_ephemeral_open_error(&error) {
                service.session.signal_transport_recover();
            }
            log::warn!("pty create failed terminal_id={id} error={error}");
            return Err(error);
        }
    };

    let (input_tx, mut input_rx) = unbounded_channel::<TerminalAction>();

    {
        let mut sessions = registry.sessions.lock().await;
        sessions.insert(
            id.clone(),
            TerminalSession {
                sender: input_tx,
                spawn_generation,
            },
        );
    }

    let active_after = registry.list_session_ids().await.len();
    log::info!(
        "pty create ready terminal_id={id} spawn_generation={spawn_generation} active_registry_count={active_after}"
    );

    let service = service.inner().clone();
    let session_controller = service.session.clone();
    let registry = registry.inner().clone();
    let app_clone = app.clone();
    let terminal_id = id.clone();
    let mut session_watch = session_controller.subscribe_session();
    let mut attached_session_id = session_controller.current_session_id();

    tokio::spawn(async move {
        loop {
            if !registry
                .is_active_spawn(&terminal_id, spawn_generation)
                .await
            {
                log::info!(
                    "pty task exit terminal_id={terminal_id} spawn_generation={spawn_generation} reason=superseded"
                );
                shutdown_pty_channel(&mut channel).await;
                break;
            }

            if !session_controller.is_pty_registered(&terminal_id).await {
                log::info!(
                    "pty task exit terminal_id={terminal_id} spawn_generation={spawn_generation} reason=unregistered"
                );
                shutdown_pty_channel(&mut channel).await;
                break;
            }

            let user_closed = run_pty_loop(
                &mut channel,
                &app_clone,
                &terminal_id,
                &mut input_rx,
            )
            .await;

            shutdown_pty_channel(&mut channel).await;

            if user_closed {
                log::info!(
                    "pty closed terminal_id={terminal_id} spawn_generation={spawn_generation} reason=user"
                );
                let _ = app_clone.emit(&format!("terminal-closed:{terminal_id}"), ());
                break;
            }

            if !registry
                .is_active_spawn(&terminal_id, spawn_generation)
                .await
                || !session_controller.is_pty_registered(&terminal_id).await
            {
                break;
            }

            // Local channel glitch while transport is still up — try one immediate reopen.
            if session_controller.is_active().await
                && attached_session_id > 0
                && session_controller.current_session_id() == attached_session_id
            {
                match reopen_pty_channel(
                    &service,
                    &session_controller,
                    &terminal_id,
                    cols,
                    rows,
                    attached_session_id,
                )
                .await
                {
                    Ok(next_channel) => {
                        channel = next_channel;
                        continue;
                    }
                    Err(error) => {
                        log::debug!(
                            "pty immediate reopen failed terminal_id={terminal_id} error={error}"
                        );
                    }
                }
            }

            log::info!(
                "pty waiting for transport terminal_id={terminal_id} spawn_generation={spawn_generation} previous_ssh_session_id={attached_session_id}"
            );

            let new_session_id = match wait_for_new_session(
                &session_controller,
                &mut session_watch,
                attached_session_id,
                &mut input_rx,
            )
            .await
            {
                Ok(new_id) => new_id,
                Err(WaitAbort::Closed) => break,
                Err(WaitAbort::Cancelled) => break,
            };

            attached_session_id = new_session_id;

            let mut reopened = false;
            while session_controller.is_active().await
                && session_controller.current_session_id() == attached_session_id
                && registry
                    .is_active_spawn(&terminal_id, spawn_generation)
                    .await
                && session_controller.is_pty_registered(&terminal_id).await
            {
                tokio::time::sleep(Duration::from_millis(reopen_stagger_ms(&terminal_id))).await;

                let _ = app_clone.emit(&format!("terminal-reconnecting:{terminal_id}"), ());
                log::info!(
                    "pty reconnecting terminal_id={terminal_id} spawn_generation={spawn_generation} ssh_session_id={attached_session_id}"
                );

                match reopen_pty_channel(
                    &service,
                    &session_controller,
                    &terminal_id,
                    cols,
                    rows,
                    attached_session_id,
                )
                .await
                {
                    Ok(next_channel) => {
                        channel = next_channel;
                        reopened = true;
                        break;
                    }
                    Err(error) => {
                        log::warn!(
                            "pty reopen failed terminal_id={terminal_id} ssh_session_id={attached_session_id} error={error}"
                        );
                    }
                }
            }

            if reopened {
                continue;
            }
        }

        if registry
            .is_active_spawn(&terminal_id, spawn_generation)
            .await
            && session_controller.is_pty_registered(&terminal_id).await
        {
            log::info!(
                "pty closed terminal_id={terminal_id} spawn_generation={spawn_generation} reason=channel_lost"
            );
            let _ = app_clone.emit(&format!("terminal-closed:{terminal_id}"), ());
        }
    });

    Ok(spawn_generation)
}

#[tauri::command]
pub async fn write_terminal_input(
    id: String,
    input: String,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
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
    service: State<'_, std::sync::Arc<SshService>>,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
) -> Result<(), String> {
    let cols = cols as u32;
    let rows = rows as u32;
    let (cols, rows) = normalize_dimensions(cols, rows);

    service.session.update_pty_size(&id, cols, rows).await;

    let sessions = registry.sessions.lock().await;
    if let Some(session) = sessions.get(&id) {
        session
            .sender
            .send(TerminalAction::Resize { cols, rows })
            .map_err(|err| err.to_string())?;
        Ok(())
    } else {
        Err("Session not found".into())
    }
}

#[tauri::command]
pub async fn close_terminal_session(
    id: String,
    spawn_generation: Option<u64>,
    service: State<'_, std::sync::Arc<SshService>>,
    registry: State<'_, std::sync::Arc<TerminalRegistry>>,
) -> Result<(), String> {
    close_terminal_session_locked(&id, spawn_generation, &service, &registry).await;
    Ok(())
}
