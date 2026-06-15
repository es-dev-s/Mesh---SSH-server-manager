use thiserror::Error;

use super::connection::{SshConnection, SshError};
use super::types::{DeviceSpecs, StorageSummary, StorageVolume};

#[derive(Debug, Error)]
pub enum CollectError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("failed to parse remote metrics: {0}")]
    Parse(String),
}

pub async fn collect_metrics(
    connection: &SshConnection,
) -> Result<(DeviceSpecs, StorageSummary), CollectError> {
    let payload = connection.exec(METRICS_SCRIPT).await?;
    parse_metrics(&payload)
}

const METRICS_SCRIPT: &str = r#"sh -c 'H=$(hostname 2>/dev/null || echo unknown); if [ -f /etc/os-release ]; then OS=$(grep "^PRETTY_NAME=" /etc/os-release | cut -d= -f2- | tr -d "\""); else OS=$(uname -s 2>/dev/null || echo Linux); fi; K=$(uname -sr 2>/dev/null || echo unknown); A=$(uname -m 2>/dev/null || echo unknown); CPU=$(grep -m1 "model name" /proc/cpuinfo 2>/dev/null | cut -d: -f2- | sed "s/^ //"); [ -z "$CPU" ] && CPU=unknown; CORES=$(lscpu -p=CORE 2>/dev/null | grep -v "^#" | sort -u | wc -l | tr -d " "); [ -z "$CORES" ] || [ "$CORES" -eq 0 ] && CORES=$(nproc 2>/dev/null || echo 1); THREADS=$(nproc 2>/dev/null || echo "$CORES"); MT=$(awk "/^MemTotal:/ {print \$2}" /proc/meminfo 2>/dev/null || echo 0); MA=$(awk "/^MemAvailable:/ {print \$2}" /proc/meminfo 2>/dev/null || echo 0); MU=$((MT - MA)); ST=$(awk "/^SwapTotal:/ {print \$2}" /proc/meminfo 2>/dev/null || echo 0); SF=$(awk "/^SwapFree:/ {print \$2}" /proc/meminfo 2>/dev/null || echo 0); SU=$((ST - SF)); UP=$(awk "{print int(\$1)}" /proc/uptime 2>/dev/null || echo 0); read L1 L2 L3 _ </proc/loadavg 2>/dev/null || L1=0 L2=0 L3=0; PHYS=$(lsblk -b -d -n -o SIZE,TYPE 2>/dev/null | awk "\$2==\"disk\" {s+=\$1} END {print int(s+0)}"); printf "SPEC|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s|%s\n" "$H" "$OS" "$K" "$A" "$CPU" "$CORES" "$THREADS" "$MT" "$MU" "$MA" "$ST" "$SU" "$UP" "$L1" "$L2" "$L3"; printf "PHYS|%s\n" "$PHYS"; df -B1 -x tmpfs -x devtmpfs -x squashfs -x overlay -x efivarfs --output=source,size,used,avail,pcent,target 2>/dev/null | tail -n +2 | awk "NF>=6 {printf \"VOL|%s|%s|%s|%s|%s|%s\\n\",\$1,\$6,\$2,\$3,\$4,\$5; t+=\$2; u+=\$3; a+=\$4} END {pct=(t>0)?(u*100/t):0; printf \"SUM|%d|%d|%d|%.1f\\n\", t+0, u+0, a+0, pct}"'"#;

fn parse_metrics(payload: &str) -> Result<(DeviceSpecs, StorageSummary), CollectError> {
    let mut physical_total_bytes = 0u64;
    let mut filesystem_total_bytes = 0u64;
    let mut filesystem_used_bytes = 0u64;
    let mut filesystem_available_bytes = 0u64;
    let mut filesystem_used_percent = 0.0f64;
    let mut volumes = Vec::new();
    let mut specs: Option<DeviceSpecs> = None;

    for line in payload.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let parts: Vec<&str> = line.split('|').collect();
        match parts.first().copied() {
            Some("SPEC") if parts.len() == 17 => {
                specs = Some(parse_specs(&parts)?);
            }
            Some("PHYS") if parts.len() == 2 => {
                physical_total_bytes = parse_u64_field(parts[1], "physical disk total")?;
            }
            Some("SUM") if parts.len() == 5 => {
                filesystem_total_bytes = parse_u64_field(parts[1], "filesystem total")?;
                filesystem_used_bytes = parse_u64_field(parts[2], "filesystem used")?;
                filesystem_available_bytes = parse_u64_field(parts[3], "filesystem available")?;
                filesystem_used_percent = parse_f64_field(parts[4], "filesystem percent")?;
            }
            Some("VOL") if parts.len() == 7 => {
                volumes.push(parse_volume(&parts)?);
            }
            _ => {}
        }
    }

    let specs = specs.ok_or_else(|| {
        CollectError::Parse(format!(
            "missing SPEC line in metrics payload: {}",
            truncate(payload, 160)
        ))
    })?;

    if filesystem_total_bytes == 0 && !volumes.is_empty() {
        for volume in &volumes {
            filesystem_total_bytes = filesystem_total_bytes.saturating_add(volume.total_bytes);
            filesystem_used_bytes = filesystem_used_bytes.saturating_add(volume.used_bytes);
            filesystem_available_bytes =
                filesystem_available_bytes.saturating_add(volume.available_bytes);
        }
        if filesystem_total_bytes > 0 {
            filesystem_used_percent =
                (filesystem_used_bytes as f64 / filesystem_total_bytes as f64) * 100.0;
        }
    }

    Ok((
        specs,
        StorageSummary {
            physical_total_bytes,
            filesystem_total_bytes,
            filesystem_used_bytes,
            filesystem_available_bytes,
            filesystem_used_percent,
            volumes,
        },
    ))
}

fn parse_specs(parts: &[&str]) -> Result<DeviceSpecs, CollectError> {
    let mem_total_kb = parse_u64_field(parts[8], "memory total")?;
    let mem_used_kb = parse_u64_field(parts[9], "memory used")?;
    let mem_avail_kb = parse_u64_field(parts[10], "memory available")?;
    let swap_total_kb = parse_u64_field(parts[11], "swap total")?;
    let swap_used_kb = parse_u64_field(parts[12], "swap used")?;

    Ok(DeviceSpecs {
        hostname: fallback(parts[1], "unknown"),
        os_name: fallback(parts[2], "Linux"),
        kernel: fallback(parts[3], "Linux"),
        architecture: fallback(parts[4], "unknown"),
        cpu_model: fallback(parts[5], "Unknown CPU"),
        cpu_cores: parse_u64_field(parts[6], "cpu cores")? as u32,
        cpu_threads: parse_u64_field(parts[7], "cpu threads")? as u32,
        memory_total_bytes: mem_total_kb.saturating_mul(1024),
        memory_used_bytes: mem_used_kb.saturating_mul(1024),
        memory_available_bytes: mem_avail_kb.saturating_mul(1024),
        swap_total_bytes: swap_total_kb.saturating_mul(1024),
        swap_used_bytes: swap_used_kb.saturating_mul(1024),
        uptime_seconds: parse_u64_field(parts[13], "uptime")?,
        load_average_1m: parse_f64_field(parts[14], "load 1m")?,
        load_average_5m: parse_f64_field(parts[15], "load 5m")?,
        load_average_15m: parse_f64_field(parts[16], "load 15m")?,
    })
}

fn parse_volume(parts: &[&str]) -> Result<StorageVolume, CollectError> {
    let used_percent = parts[6]
        .trim_end_matches('%')
        .parse::<f64>()
        .map_err(|_| CollectError::Parse(format!("invalid volume percent: {}", parts[6])))?;

    Ok(StorageVolume {
        filesystem: parts[1].to_string(),
        mount_point: parts[2].to_string(),
        total_bytes: parse_u64_field(parts[3], "volume total")?,
        used_bytes: parse_u64_field(parts[4], "volume used")?,
        available_bytes: parse_u64_field(parts[5], "volume available")?,
        used_percent,
    })
}

fn parse_u64_field(value: &str, label: &str) -> Result<u64, CollectError> {
    value
        .trim()
        .parse()
        .map_err(|_| CollectError::Parse(format!("invalid {label}: {value}")))
}

fn parse_f64_field(value: &str, label: &str) -> Result<f64, CollectError> {
    value
        .trim()
        .parse()
        .map_err(|_| CollectError::Parse(format!("invalid {label}: {value}")))
}

fn fallback(value: &str, default: &str) -> String {
    if value.trim().is_empty() {
        default.to_string()
    } else {
        value.trim().to_string()
    }
}

fn truncate(value: &str, max: usize) -> String {
    if value.len() <= max {
        value.to_string()
    } else {
        format!("{}…", &value[..max])
    }
}
