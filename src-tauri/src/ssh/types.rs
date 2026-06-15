use serde::Serialize;

#[derive(Debug, Clone, Copy, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum ConnectionState {
    Connecting,
    Connected,
    Reconnecting,
    Disconnected,
    Misconfigured,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct DeviceSpecs {
    pub hostname: String,
    pub os_name: String,
    pub kernel: String,
    pub architecture: String,
    pub cpu_model: String,
    pub cpu_cores: u32,
    pub cpu_threads: u32,
    pub memory_total_bytes: u64,
    pub memory_used_bytes: u64,
    pub memory_available_bytes: u64,
    pub swap_total_bytes: u64,
    pub swap_used_bytes: u64,
    pub uptime_seconds: u64,
    pub load_average_1m: f64,
    pub load_average_5m: f64,
    pub load_average_15m: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageVolume {
    pub filesystem: String,
    pub mount_point: String,
    pub total_bytes: u64,
    pub used_bytes: u64,
    pub available_bytes: u64,
    pub used_percent: f64,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct StorageSummary {
    pub physical_total_bytes: u64,
    pub filesystem_total_bytes: u64,
    pub filesystem_used_bytes: u64,
    pub filesystem_available_bytes: u64,
    pub filesystem_used_percent: f64,
    pub volumes: Vec<StorageVolume>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Pm2Process {
    pub id: u32,
    pub name: String,
    pub status: String,
    pub pid: Option<u32>,
    pub interpreter: String,
    pub exec_mode: String,
    pub cwd: String,
    pub script_path: String,
    pub args: String,
    pub memory_bytes: u64,
    pub cpu_percent: f64,
    pub restarts: u32,
    pub uptime_ms: u64,
    pub version: String,
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Pm2Summary {
    pub installed: bool,
    pub version: Option<String>,
    pub running_count: u32,
    pub total_count: u32,
    pub processes: Vec<Pm2Process>,
}

#[derive(Debug, Clone, Serialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct RemoteEntry {
    pub name: String,
    pub entry_type: String,
    pub kind: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SshSnapshot {
    pub state: ConnectionState,
    pub name: String,
    pub user: String,
    pub host: String,
    pub port: u16,
    pub last_connected_at: Option<String>,
    pub last_updated_at: Option<String>,
    pub last_error: Option<String>,
    pub status_message: Option<String>,
    pub reconnect_attempts: u32,
    pub revision: u64,
    pub session_id: u64,
    pub specs: Option<DeviceSpecs>,
    pub storage: Option<StorageSummary>,
    pub pm2: Option<Pm2Summary>,
}

impl SshSnapshot {
    pub fn disconnected(config: &super::config::SshConfig, error: Option<String>) -> Self {
        Self {
            state: ConnectionState::Disconnected,
            name: config.name.clone(),
            user: config.user.clone(),
            host: config.host.clone(),
            port: config.port,
            last_connected_at: None,
            last_updated_at: None,
            last_error: error,
            status_message: None,
            reconnect_attempts: 0,
            revision: 0,
            session_id: 0,
            specs: None,
            storage: None,
            pm2: None,
        }
    }

    pub fn misconfigured(message: String) -> Self {
        Self {
            state: ConnectionState::Misconfigured,
            name: "unknown".into(),
            user: "unknown".into(),
            host: "unknown".into(),
            port: 22,
            last_connected_at: None,
            last_updated_at: None,
            last_error: Some(message),
            status_message: None,
            reconnect_attempts: 0,
            revision: 0,
            session_id: 0,
            specs: None,
            storage: None,
            pm2: None,
        }
    }
}
