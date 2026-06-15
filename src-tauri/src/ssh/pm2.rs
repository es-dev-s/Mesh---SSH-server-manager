use serde::Deserialize;
use thiserror::Error;

use super::connection::{SshConnection, SshError};
use super::types::{Pm2Process, Pm2Summary};

#[derive(Debug, Error)]
pub enum Pm2CollectError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("failed to parse PM2 data: {0}")]
    Parse(String),
}

const PM2_SCRIPT: &str = r#"sh -lc 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; PM2=$(command -v pm2 2>/dev/null); if [ -z "$PM2" ]; then printf "PM2META|0|\n"; exit 0; fi; VER=$($PM2 -v 2>/dev/null || echo unknown); printf "PM2META|1|%s\n" "$VER"; $PM2 jlist 2>/dev/null || echo "[]"'"#;

pub async fn collect_pm2(connection: &SshConnection) -> Result<Pm2Summary, Pm2CollectError> {
    let payload = connection.exec(PM2_SCRIPT).await?;
    parse_pm2(&payload)
}

fn parse_pm2(payload: &str) -> Result<Pm2Summary, Pm2CollectError> {
    let meta_line = payload
        .lines()
        .map(str::trim)
        .find(|line| line.starts_with("PM2META|"))
        .ok_or_else(|| Pm2CollectError::Parse("missing PM2META line".into()))?;

    let meta_parts: Vec<&str> = meta_line.split('|').collect();
    if meta_parts.len() < 3 {
        return Err(Pm2CollectError::Parse("invalid PM2META format".into()));
    }

    let installed = meta_parts[1] == "1";
    if !installed {
        return Ok(Pm2Summary::default());
    }

    let version = if meta_parts[2].is_empty() {
        None
    } else {
        Some(meta_parts[2].to_string())
    };

    let json_start = payload
        .find('[')
        .ok_or_else(|| Pm2CollectError::Parse("missing PM2 JSON payload".into()))?;
    let json_payload = payload[json_start..].trim();

    let raw_processes: Vec<Pm2RawProcess> = if json_payload == "[]" || json_payload.is_empty() {
        Vec::new()
    } else {
        serde_json::from_str(json_payload).unwrap_or_default()
    };

    let processes: Vec<Pm2Process> = raw_processes.into_iter().map(map_process).collect();
    let running_count = processes
        .iter()
        .filter(|process| process.status == "online")
        .count() as u32;

    Ok(Pm2Summary {
        installed: true,
        version,
        running_count,
        total_count: processes.len() as u32,
        processes,
    })
}

fn map_process(raw: Pm2RawProcess) -> Pm2Process {
    let env = raw.pm2_env.unwrap_or_default();
    let monit = raw.monit.unwrap_or_default();

    let script_path = env
        .pm_exec_path
        .clone()
        .unwrap_or_else(|| "unknown".into());
    let cwd = env.pm_cwd.clone().unwrap_or_else(|| "unknown".into());
    let interpreter = env
        .exec_interpreter
        .clone()
        .unwrap_or_else(|| "unknown".into());
    let exec_mode = normalize_exec_mode(env.exec_mode.as_deref());
    let status = env.status.unwrap_or_else(|| "unknown".into());
    let args = env
        .args
        .as_ref()
        .map(|items| items.join(" "))
        .unwrap_or_default();
    let script_name = script_path
        .rsplit('/')
        .next()
        .or_else(|| script_path.rsplit('\\').next())
        .unwrap_or(&script_path)
        .to_string();

    let description = build_description(&interpreter, &script_name, &raw.name);

    Pm2Process {
        id: raw.pm_id.unwrap_or(0),
        name: raw.name,
        status,
        pid: raw.pid,
        interpreter,
        exec_mode,
        cwd,
        script_path,
        args,
        memory_bytes: monit.memory.unwrap_or(0),
        cpu_percent: monit.cpu.unwrap_or(0.0),
        restarts: env.unstable_restarts.unwrap_or(0),
        uptime_ms: env.pm_uptime.unwrap_or(0),
        version: env.version.unwrap_or_default(),
        description,
    }
}

fn build_description(interpreter: &str, script_name: &str, process_name: &str) -> String {
    let runtime = match interpreter {
        "node" | "nodejs" => "Node.js application",
        "python" | "python3" => "Python application",
        "bash" | "sh" => "Shell script",
        "php" => "PHP application",
        _ if interpreter != "unknown" => return format!("{interpreter} · {script_name}"),
        _ => "Application",
    };

    if script_name == process_name {
        format!("{runtime} · {process_name}")
    } else {
        format!("{runtime} · {process_name} ({script_name})")
    }
}

fn normalize_exec_mode(mode: Option<&str>) -> String {
    match mode {
        Some("cluster_mode") => "Cluster".into(),
        Some("fork_mode") => "Fork".into(),
        Some(value) => value.replace('_', " "),
        None => "Unknown".into(),
    }
}

#[derive(Debug, Deserialize)]
struct Pm2RawProcess {
    name: String,
    pid: Option<u32>,
    pm_id: Option<u32>,
    #[serde(default)]
    monit: Option<Pm2Monit>,
    #[serde(default)]
    pm2_env: Option<Pm2Env>,
}

#[derive(Debug, Default, Deserialize)]
struct Pm2Monit {
    memory: Option<u64>,
    cpu: Option<f64>,
}

#[derive(Debug, Default, Deserialize)]
struct Pm2Env {
    status: Option<String>,
    pm_cwd: Option<String>,
    pm_exec_path: Option<String>,
    exec_interpreter: Option<String>,
    exec_mode: Option<String>,
    #[serde(default)]
    args: Option<Vec<String>>,
    unstable_restarts: Option<u32>,
    pm_uptime: Option<u64>,
    version: Option<String>,
}
