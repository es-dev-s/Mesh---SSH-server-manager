use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Arc;

use parking_lot::RwLock;
use tauri::{AppHandle, Emitter};
use tokio::sync::{Mutex, RwLock as AsyncRwLock};

use super::connection::SshConnection;
use super::types::SshSnapshot;

pub const SSH_STATUS_EVENT: &str = "ssh://status";

#[derive(Clone)]
pub struct SessionHandle {
    pub generation: u64,
    pub connection: Arc<SshConnection>,
}

pub struct SessionController {
    generation: AtomicU64,
    session_id: AtomicU64,
    revision: AtomicU64,
    active: AsyncRwLock<Option<SessionHandle>>,
    ops_lock: Mutex<()>,
}

impl SessionController {
    pub fn new() -> Self {
        Self {
            generation: AtomicU64::new(0),
            session_id: AtomicU64::new(0),
            revision: AtomicU64::new(0),
            active: AsyncRwLock::new(None),
            ops_lock: Mutex::new(()),
        }
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

    pub async fn register(&self, connection: Arc<SshConnection>) -> SessionHandle {
        let _ops = self.ops_lock.lock().await;
        let generation = self.generation.fetch_add(1, Ordering::SeqCst) + 1;
        let handle = SessionHandle {
            generation,
            connection,
        };
        *self.active.write().await = Some(handle.clone());
        handle
    }

    pub async fn teardown(&self) {
        let _ops = self.ops_lock.lock().await;
        if let Some(handle) = self.active.write().await.take() {
            handle.connection.disconnect().await;
            self.generation.fetch_add(1, Ordering::SeqCst);
        }
    }

    pub async fn with_connection<T, Fut, F>(&self, operation: F) -> Result<T, SessionError>
    where
        F: FnOnce(Arc<SshConnection>) -> Fut,
        Fut: std::future::Future<Output = Result<T, SessionError>>,
    {
        let _ops = self.ops_lock.lock().await;

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
