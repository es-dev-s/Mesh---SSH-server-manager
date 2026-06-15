use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicU32, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::{watch, Mutex, RwLock as AsyncRwLock};

use super::connection::SshConnection;
use super::types::SshSnapshot;

pub const SSH_STATUS_EVENT: &str = "ssh://status";

#[derive(Clone)]
pub struct SessionHandle {
    pub generation: u64,
    pub connection: Arc<SshConnection>,
}

/// PTY dimensions tracked by the connection manager so channels can be re-opened
/// after a transport-level reconnect without tearing down the frontend terminal tab.
#[derive(Debug, Clone)]
pub struct PtyRegistration {
    pub cols: u32,
    pub rows: u32,
}

/// Owns the single authenticated SSH session, reconnect transitions, and registered
/// long-lived PTY channels. Short-lived exec channels are opened directly on the
/// shared connection without holding `transition_lock`.
///
/// Channel discipline: each PTY has exactly one backend task that owns its
/// `russh::Channel` — that task is the sole reader (`channel.wait`) and sole writer
/// (`channel.data` / `window_change`). Never share a channel across tasks.
pub struct SessionController {
    generation: AtomicU64,
    session_id: AtomicU64,
    revision: AtomicU64,
    active: AsyncRwLock<Option<SessionHandle>>,
    /// Guards session swap, teardown, and reconnect only — not individual exec/PTY ops.
    transition_lock: Mutex<()>,
    session_watch: watch::Sender<u64>,
    pty_sessions: Mutex<HashMap<String, PtyRegistration>>,
    /// Consecutive transient probe/exec channel-open failures (reset on any successful I/O).
    probe_failure_streak: AtomicU32,
    /// Set when channel pool appears exhausted; monitor recycles transport when no PTYs remain.
    transport_recover_pending: AtomicBool,
}

impl SessionController {
    pub fn new() -> Self {
        let (session_watch, _) = watch::channel(0);
        Self {
            generation: AtomicU64::new(0),
            session_id: AtomicU64::new(0),
            revision: AtomicU64::new(0),
            active: AsyncRwLock::new(None),
            transition_lock: Mutex::new(()),
            session_watch,
            pty_sessions: Mutex::new(HashMap::new()),
            probe_failure_streak: AtomicU32::new(0),
            transport_recover_pending: AtomicBool::new(false),
        }
    }

    pub fn signal_transport_recover(&self) {
        self.transport_recover_pending.store(true, Ordering::SeqCst);
    }

    pub fn take_transport_recover(&self) -> bool {
        self.transport_recover_pending.swap(false, Ordering::SeqCst)
    }

    pub fn reset_probe_failure_streak(&self) {
        self.probe_failure_streak.store(0, Ordering::SeqCst);
    }

    /// Increment streak; returns the new count after increment.
    pub fn record_probe_failure(&self) -> u32 {
        self.probe_failure_streak.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn subscribe_session(&self) -> watch::Receiver<u64> {
        self.session_watch.subscribe()
    }

    pub fn next_session_id(&self) -> u64 {
        self.session_id.fetch_add(1, Ordering::SeqCst) + 1
    }

    pub fn current_session_id(&self) -> u64 {
        self.session_id.load(Ordering::SeqCst)
    }

    pub async fn is_active(&self) -> bool {
        self.active.read().await.is_some()
    }

    pub async fn register_pty(&self, id: String, cols: u32, rows: u32) {
        self.pty_sessions
            .lock()
            .await
            .insert(id, PtyRegistration { cols, rows });
    }

    pub async fn update_pty_size(&self, id: &str, cols: u32, rows: u32) {
        if let Some(registration) = self.pty_sessions.lock().await.get_mut(id) {
            registration.cols = cols;
            registration.rows = rows;
        }
    }

    pub async fn unregister_pty(&self, id: &str) {
        self.pty_sessions.lock().await.remove(id);
    }

    pub async fn is_pty_registered(&self, id: &str) -> bool {
        self.pty_sessions.lock().await.contains_key(id)
    }

    pub async fn pty_registration(&self, id: &str) -> Option<PtyRegistration> {
        self.pty_sessions.lock().await.get(id).cloned()
    }

    pub async fn list_pty_ids(&self) -> Vec<String> {
        self.pty_sessions.lock().await.keys().cloned().collect()
    }

    /// Install a freshly authenticated connection. Notifies all registered PTY loops via
    /// `session_watch` so each tab re-opens its channel on the new transport session.
    pub async fn register(&self, connection: Arc<SshConnection>) -> SessionHandle {
        let _transition = self.transition_lock.lock().await;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let handle = SessionHandle {
            generation,
            connection,
        };
        *self.active.write().await = Some(handle.clone());
        let session_id = self.session_id.load(Ordering::SeqCst);
        let pty_count = self.pty_sessions.lock().await.len();
        log::info!(
            "ssh session registered transport_generation={generation} ssh_session_id={session_id} registered_ptys={pty_count}"
        );
        if session_id > 0 {
            let _ = self.session_watch.send(session_id);
        }
        handle
    }

    /// Tear down the transport session after a confirmed transport failure.
    /// PTY tabs stay registered and will re-open channels when `register` fires again.
    /// Does not bump `generation` or notify `session_watch` — only `register` does that.
    /// `transition_lock` is always released when this future completes (Mutex guard drop).
    pub async fn teardown(&self, reason: &str) {
        let _transition = self.transition_lock.lock().await;
        if let Some(handle) = self.active.write().await.take() {
            log::info!(
                "ssh session teardown transport_generation={} reason={reason}",
                handle.generation
            );
            handle.connection.disconnect().await;
        }
    }

    /// Returns a session id strictly newer than `after` once the transport is active again.
    pub async fn next_connected_session_after(&self, after: u64) -> Option<u64> {
        if !self.is_active().await {
            return None;
        }
        let current = self.current_session_id();
        if current > after && current > 0 {
            Some(current)
        } else {
            None
        }
    }

    /// Run an operation against the current connection without holding `transition_lock`.
    /// Validates the session generation before returning so callers can detect mid-flight reconnects.
    pub async fn with_connection<T, Fut, F>(&self, operation: F) -> Result<T, SessionError>
    where
        F: FnOnce(Arc<SshConnection>) -> Fut,
        Fut: std::future::Future<Output = Result<T, SessionError>>,
    {
        let handle = self
            .active
            .read()
            .await
            .clone()
            .ok_or(SessionError::NotConnected)?;

        let generation = handle.generation;
        let result = operation(handle.connection).await?;

        let still_valid = self
            .active
            .read()
            .await
            .as_ref()
            .is_some_and(|current| current.generation == generation);

        if !still_valid {
            return Err(SessionError::Expired);
        }

        Ok(result)
    }

    pub fn publish(
        &self,
        snapshot_store: &RwLock<SshSnapshot>,
        app: &AppHandle,
        mut snapshot: SshSnapshot,
    ) {
        snapshot.revision = self.revision.fetch_add(1, Ordering::SeqCst) + 1;
        snapshot.session_id = self.session_id.load(Ordering::SeqCst);
        *snapshot_store.write() = snapshot.clone();
        let _ = app.emit(SSH_STATUS_EVENT, snapshot);
    }

    pub fn publish_mut(
        &self,
        snapshot_store: &RwLock<SshSnapshot>,
        app: &AppHandle,
        update: impl FnOnce(&mut SshSnapshot),
    ) {
        let mut snapshot = snapshot_store.read().clone();
        update(&mut snapshot);
        self.publish(snapshot_store, app, snapshot);
    }
}

#[derive(Debug, thiserror::Error)]
pub enum SessionError {
    #[error("SSH session is not connected")]
    NotConnected,
    #[error("SSH session expired — reconnecting")]
    Expired,
    #[error(transparent)]
    Command(#[from] super::connection::SshError),
    #[error(transparent)]
    Explorer(#[from] super::explorer::ExplorerError),
    #[error("{0}")]
    Operation(String),
}

impl SessionError {
    /// True when the shared SSH transport must be re-established.
    pub fn is_transport_error(&self) -> bool {
        match self {
            SessionError::NotConnected | SessionError::Expired => true,
            SessionError::Command(error) => error.is_transport_error(),
            SessionError::Explorer(error) => error.is_transport_error(),
            SessionError::Operation(_) => false,
        }
    }

    /// Transient channel-open failure on a probe/exec — not confirmed transport death.
    pub fn is_probe_channel_failure(&self) -> bool {
        match self {
            SessionError::Command(error) => error.is_ephemeral_channel_open_failure(),
            SessionError::Explorer(error) => error.is_probe_channel_failure(),
            _ => false,
        }
    }

    /// Confirmed transport death (TCP/session gone), not a transient probe failure.
    pub fn is_fatal_transport_error(&self) -> bool {
        match self {
            SessionError::NotConnected | SessionError::Expired => true,
            SessionError::Command(error) => error.is_fatal_transport_error(),
            SessionError::Explorer(error) => error.is_fatal_transport_error(),
            SessionError::Operation(_) => false,
        }
    }
}
