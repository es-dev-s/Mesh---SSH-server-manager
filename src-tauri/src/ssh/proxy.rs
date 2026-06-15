use std::collections::{HashMap, HashSet};

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use thiserror::Error;

use super::connection::{SshConnection, SshError};
use super::pm2::collect_pm2;

const STAGING_DIR: &str = "mesh-proxy-staging";
const APP_NGINX_CONFIG: &str = "/etc/nginx/sites-available/app";
const PROTECTED_CONFIG_NAMES: &[&str] = &["app", "salesradar.live", "default"];
const PROTECTED_DOMAINS: &[&str] = &[
    "app.salesradar.live",
    "time.salesradar.live",
    "salesradar.live",
    "www.salesradar.live",
];

#[derive(Debug, Error)]
pub enum ProxyError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("duplicate domain: {0}")]
    DuplicateDomain(String),
    #[error("invalid domain: {0}")]
    InvalidDomain(String),
    #[error("invalid port: {0}")]
    InvalidPort(String),
    #[error("nginx configuration validation failed: {0}")]
    Validation(String),
    #[error("insufficient privileges: {0}")]
    Privilege(String),
    #[error("failed to parse nginx configuration: {0}")]
    Parse(String),
    #[error("protected configuration: {0}")]
    Protected(String),
    #[error("rollback failed: {0}")]
    Rollback(String),
    #[error("{0}")]
    Operation(String),
}

impl ProxyError {
    pub fn is_transport_error(&self) -> bool {
        match self {
            ProxyError::Ssh(error) => error.is_transport_error(),
            ProxyError::DuplicateDomain(_)
            | ProxyError::InvalidDomain(_)
            | ProxyError::InvalidPort(_)
            | ProxyError::Validation(_)
            | ProxyError::Privilege(_)
            | ProxyError::Parse(_)
            | ProxyError::Protected(_)
            | ProxyError::Rollback(_)
            | ProxyError::Operation(_) => false,
        }
    }

    fn from_pm2(error: super::pm2::Pm2CollectError) -> Self {
        match error {
            super::pm2::Pm2CollectError::Ssh(ssh) => ProxyError::Ssh(ssh),
            super::pm2::Pm2CollectError::Parse(message) => ProxyError::Parse(message),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NginxProxyEntry {
    pub domain: String,
    pub target_host: String,
    pub target_port: u16,
    pub config_file: String,
    pub pm2_app: Option<String>,
    pub listen_port: u16,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnproxiedPm2App {
    pub name: String,
    pub port: u16,
    pub pid: Option<u32>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListeningPort {
    pub port: u16,
    pub process: Option<String>,
    pub pm2_app: Option<String>,
    pub proxied: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NginxProxyOverview {
    pub proxies: Vec<NginxProxyEntry>,
    pub unproxied_apps: Vec<UnproxiedPm2App>,
    pub listening_ports: Vec<ListeningPort>,
    pub dns_ip: String,
    pub passwordless_sudo: bool,
    pub fetched_at: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsInstructions {
    pub domain: String,
    pub record_type: String,
    pub name: String,
    pub ipv4: String,
    pub proxy_status: String,
    pub certbot_command: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct StageProxyResult {
    pub domain: String,
    pub port: u16,
    pub staged_path: String,
    pub target_config_file: String,
    pub apply_method: String,
    pub config_content: String,
    pub apply_commands: Vec<String>,
    pub dns: DnsInstructions,
    pub port_listening: bool,
    pub port_already_proxied: bool,
    pub websocket_enabled: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProxyResult {
    pub domain: String,
    pub port: u16,
    pub applied: bool,
    pub auto_applied: bool,
    pub staged_path: String,
    pub target_config_file: String,
    pub apply_method: String,
    pub config_content: String,
    pub apply_commands: Vec<String>,
    pub dns: DnsInstructions,
    pub port_listening: bool,
    pub port_already_proxied: bool,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveProxyResult {
    pub domain: String,
    pub removed: bool,
    pub auto_removed: bool,
    pub config_file: String,
    pub apply_commands: Vec<String>,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DnsCheckResult {
    pub domain: String,
    pub expected_ip: String,
    pub resolved: bool,
    pub addresses: Vec<String>,
}

#[derive(Debug, Clone)]
struct ParsedServerBlock {
    server_names: Vec<String>,
    target_host: String,
    target_port: u16,
    listen_port: u16,
}

#[derive(Debug, Clone)]
struct ParsedConfigFile {
    enabled_path: String,
    blocks: Vec<ParsedServerBlock>,
}

#[derive(Debug, Clone)]
struct ListeningEntry {
    port: u16,
    process: Option<String>,
    pids: Vec<u32>,
}

pub async fn collect_overview(
    connection: &SshConnection,
    dns_ip: &str,
) -> Result<NginxProxyOverview, ProxyError> {
    let configs = read_nginx_configs(connection).await?;
    let listening = read_listening_ports(connection).await?;
    let pm2 = collect_pm2(connection).await.map_err(ProxyError::from_pm2)?;
    let pid_to_pm2 = build_pid_to_pm2_map(&pm2);
    let port_to_pm2 = build_port_to_pm2_map(&listening, &pid_to_pm2);

    let mut proxies = Vec::new();
    let mut proxied_ports = HashSet::new();

    for file in &configs {
        for block in &file.blocks {
            proxied_ports.insert(block.target_port);
            for domain in &block.server_names {
                proxies.push(NginxProxyEntry {
                    domain: domain.clone(),
                    target_host: block.target_host.clone(),
                    target_port: block.target_port,
                    config_file: file.enabled_path.clone(),
                    pm2_app: port_to_pm2.get(&block.target_port).cloned(),
                    listen_port: block.listen_port,
                });
            }
        }
    }

    proxies.sort_by(|a, b| a.domain.cmp(&b.domain));

    let mut listening_ports: Vec<ListeningPort> = listening
        .iter()
        .map(|entry| ListeningPort {
            port: entry.port,
            process: entry.process.clone(),
            pm2_app: port_to_pm2.get(&entry.port).cloned(),
            proxied: proxied_ports.contains(&entry.port),
        })
        .collect();
    listening_ports.sort_by_key(|entry| entry.port);

    let mut unproxied_apps = Vec::new();
    for process in &pm2.processes {
        if process.status != "online" {
            continue;
        }
        let Some(pid) = process.pid else {
            continue;
        };
        let Some(port) = listening
            .iter()
            .find_map(|entry| entry.pids.contains(&pid).then_some(entry.port))
        else {
            continue;
        };
        if proxied_ports.contains(&port) {
            continue;
        }
        unproxied_apps.push(UnproxiedPm2App {
            name: process.name.clone(),
            port,
            pid: Some(pid),
        });
    }
    unproxied_apps.sort_by(|a, b| a.name.cmp(&b.name));

    let passwordless_sudo = check_passwordless_sudo(connection).await?;

    Ok(NginxProxyOverview {
        proxies,
        unproxied_apps,
        listening_ports,
        dns_ip: dns_ip.to_string(),
        passwordless_sudo,
        fetched_at: unix_timestamp(),
    })
}

pub async fn stage_proxy(
    connection: &SshConnection,
    dns_ip: &str,
    domain: &str,
    port: u16,
    websocket_enabled: bool,
) -> Result<StageProxyResult, ProxyError> {
    let domain = validate_domain(domain)?;
    validate_port(port)?;
    ensure_not_protected_filename(&domain)?;
    ensure_app_config_exists(connection).await?;

    let overview = collect_overview(connection, dns_ip).await?;
    if overview
        .proxies
        .iter()
        .any(|entry| entry.domain.eq_ignore_ascii_case(&domain))
    {
        return Err(ProxyError::DuplicateDomain(domain));
    }

    let listening = read_listening_ports(connection).await?;
    let port_listening = listening.iter().any(|entry| entry.port == port);
    let port_already_proxied = overview.proxies.iter().any(|entry| entry.target_port == port);

    let config_content = generate_server_block(&domain, port, websocket_enabled);
    let staged_path = staged_block_path(&domain);
    write_staged_config(connection, &domain, &config_content).await?;
    verify_staged_config(connection, &domain).await?;

    let apply_commands = build_apply_commands(&domain, &staged_path);
    let dns = build_dns_instructions(&domain, dns_ip);

    Ok(StageProxyResult {
        domain,
        port,
        staged_path,
        target_config_file: APP_NGINX_CONFIG.into(),
        apply_method: "append".into(),
        config_content,
        apply_commands,
        dns,
        port_listening,
        port_already_proxied,
        websocket_enabled,
    })
}

pub async fn create_proxy(
    connection: &SshConnection,
    dns_ip: &str,
    domain: &str,
    port: u16,
    websocket_enabled: bool,
) -> Result<CreateProxyResult, ProxyError> {
    let staged = stage_proxy(connection, dns_ip, domain, port, websocket_enabled).await?;

    if !check_passwordless_sudo(connection).await? {
        return Ok(CreateProxyResult {
            domain: staged.domain.clone(),
            port: staged.port,
            applied: false,
            auto_applied: false,
            staged_path: staged.staged_path.clone(),
            target_config_file: staged.target_config_file.clone(),
            apply_method: staged.apply_method.clone(),
            config_content: staged.config_content.clone(),
            apply_commands: staged.apply_commands.clone(),
            dns: staged.dns.clone(),
            port_listening: staged.port_listening,
            port_already_proxied: staged.port_already_proxied,
            message: "Enter your sudo password in the Server terminal, then run the apply commands below. They append to the existing app nginx config — same as manual nano.".into(),
        });
    }

    match apply_proxy_auto(connection, &staged.domain).await {
        Ok(()) => Ok(CreateProxyResult {
            domain: staged.domain.clone(),
            port: staged.port,
            applied: true,
            auto_applied: true,
            staged_path: staged.staged_path.clone(),
            target_config_file: staged.target_config_file.clone(),
            apply_method: staged.apply_method.clone(),
            config_content: staged.config_content.clone(),
            apply_commands: staged.apply_commands.clone(),
            dns: staged.dns.clone(),
            port_listening: staged.port_listening,
            port_already_proxied: staged.port_already_proxied,
            message: "Proxy applied — block appended to app nginx config, validated, and reloaded.".into(),
        }),
        Err(error) => {
            let detail = error.to_string();
            Ok(CreateProxyResult {
                domain: staged.domain.clone(),
                port: staged.port,
                applied: false,
                auto_applied: false,
                staged_path: staged.staged_path.clone(),
                target_config_file: staged.target_config_file.clone(),
                apply_method: staged.apply_method.clone(),
                config_content: staged.config_content.clone(),
                apply_commands: staged.apply_commands.clone(),
                dns: staged.dns.clone(),
                port_listening: staged.port_listening,
                port_already_proxied: staged.port_already_proxied,
                message: format!(
                    "Automatic apply failed ({detail}). Staged block preserved at {} — run the apply commands manually.",
                    staged.staged_path
                ),
            })
        }
    }
}

pub async fn check_dns(
    connection: &SshConnection,
    domain: &str,
    expected_ip: &str,
) -> Result<DnsCheckResult, ProxyError> {
    let domain = validate_domain(domain)?;
    let escaped = shell_single_quote(&domain);
    let payload = connection
        .exec(&format!(
            "dig +short A {escaped} 2>/dev/null | grep -E '^[0-9.]+$' || true"
        ))
        .await?;

    let addresses: Vec<String> = payload
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty())
        .map(str::to_string)
        .collect();

    let resolved = addresses.iter().any(|address| address == expected_ip);

    Ok(DnsCheckResult {
        domain,
        expected_ip: expected_ip.to_string(),
        resolved,
        addresses,
    })
}

pub async fn remove_proxy(
    connection: &SshConnection,
    domain: &str,
) -> Result<RemoveProxyResult, ProxyError> {
    let domain = validate_domain(domain)?;
    ensure_removable_domain(&domain)?;

    let overview = collect_overview(connection, "0.0.0.0").await?;
    let Some(entry) = overview
        .proxies
        .iter()
        .find(|proxy| proxy.domain.eq_ignore_ascii_case(&domain))
    else {
        return Err(ProxyError::Operation(format!(
            "no nginx proxy found for {domain}"
        )));
    };

    let config_path = resolve_config_real_path(connection, &entry.config_file).await?;
    let current = read_config_file(connection, &config_path).await?;
    let (updated, removed_blocks) = remove_server_blocks_for_domain(&current, &domain)?;
    if removed_blocks == 0 {
        return Err(ProxyError::Operation(format!(
            "could not locate nginx server block for {domain} in {config_path}"
        )));
    }

    let staged_path = staged_removal_path(&domain);
    write_staged_removal_config(connection, &domain, &updated).await?;

    let apply_commands = build_remove_commands(&domain, &staged_path, &config_path);

    if !check_passwordless_sudo(connection).await? {
        return Ok(RemoveProxyResult {
            domain: domain.clone(),
            removed: false,
            auto_removed: false,
            config_file: config_path,
            apply_commands,
            message: "Removal staged — run the apply commands in the Server terminal with sudo."
                .into(),
        });
    }

    match apply_removal_auto(connection, &domain, &config_path).await {
        Ok(()) => Ok(RemoveProxyResult {
            domain,
            removed: true,
            auto_removed: true,
            config_file: config_path,
            apply_commands,
            message: "Proxy removed — nginx validated and reloaded.".into(),
        }),
        Err(error) => Ok(RemoveProxyResult {
            domain,
            removed: false,
            auto_removed: false,
            config_file: config_path,
            apply_commands,
            message: format!(
                "Automatic removal failed ({error}). Staged config preserved — apply manually."
            ),
        }),
    }
}

const NGINX_RELOAD_COMMAND: &str = "sudo nginx -t && sudo systemctl reload nginx";

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct NginxReloadResult {
    pub reloaded: bool,
    pub message: String,
    pub command: String,
}

pub async fn reload_nginx(connection: &SshConnection) -> Result<NginxReloadResult, ProxyError> {
    if !check_passwordless_sudo(connection).await? {
        return Ok(NginxReloadResult {
            reloaded: false,
            message: "Passwordless sudo is not configured — run the command in the Server terminal."
                .into(),
            command: NGINX_RELOAD_COMMAND.into(),
        });
    }

    match connection
        .exec(&format!("sh -lc '{NGINX_RELOAD_COMMAND}'"))
        .await
    {
        Ok(_) => Ok(NginxReloadResult {
            reloaded: true,
            message: "Nginx validated and reloaded successfully.".into(),
            command: NGINX_RELOAD_COMMAND.into(),
        }),
        Err(SshError::Command(message)) if message.to_lowercase().contains("sudo") => {
            Err(ProxyError::Privilege(message))
        }
        Err(SshError::Command(message)) => Err(ProxyError::Validation(message)),
        Err(error) => Err(ProxyError::Ssh(error)),
    }
}

async fn read_nginx_configs(connection: &SshConnection) -> Result<Vec<ParsedConfigFile>, ProxyError> {
    let script = r#"sh -lc 'for link in /etc/nginx/sites-enabled/*; do [ -e "$link" ] || continue; real=$(readlink -f "$link" 2>/dev/null || echo "$link"); echo "MESH_NGINX_FILE|$link|$real"; cat "$real" 2>/dev/null; echo "MESH_NGINX_END"; done'"#;
    let payload = connection.exec(script).await?;
    parse_nginx_payload(&payload)
}

async fn read_listening_ports(connection: &SshConnection) -> Result<Vec<ListeningEntry>, ProxyError> {
    let payload = connection
        .exec(r#"ss -tlnp 2>/dev/null | awk 'NR>1 {print}'"#)
        .await?;
    Ok(parse_listening_ports(&payload))
}

async fn check_passwordless_sudo(connection: &SshConnection) -> Result<bool, ProxyError> {
    let payload = connection
        .exec(r#"sh -lc 'sudo -n true >/dev/null 2>&1 && echo yes || echo no'"#)
        .await?;
    Ok(payload.trim() == "yes")
}

async fn ensure_app_config_exists(connection: &SshConnection) -> Result<(), ProxyError> {
    let escaped = shell_single_quote(APP_NGINX_CONFIG);
    let payload = connection
        .exec(&format!(r#"sh -lc 'test -f {escaped} && echo yes || echo no'"#))
        .await?;
    if payload.trim() != "yes" {
        return Err(ProxyError::Operation(format!(
            "nginx config not found at {APP_NGINX_CONFIG} — create it on the server first"
        )));
    }
    Ok(())
}

fn staged_block_filename(domain: &str) -> String {
    format!("{domain}.block")
}

fn staged_block_path(domain: &str) -> String {
    format!("$HOME/{STAGING_DIR}/{}", staged_block_filename(domain))
}

async fn write_staged_config(
    connection: &SshConnection,
    domain: &str,
    content: &str,
) -> Result<(), ProxyError> {
    let base64_content = STANDARD.encode(content);
    let filename = staged_block_filename(domain);
    let script = format!(
        r#"sh -lc 'set -e
mkdir -p "$HOME/{STAGING_DIR}"
echo '"'"'{base64_content}'"'"' | base64 -d > "$HOME/{STAGING_DIR}/{filename}"
test -s "$HOME/{STAGING_DIR}/{filename}"'"#
    );
    connection.exec(&script).await?;
    Ok(())
}

async fn verify_staged_config(connection: &SshConnection, domain: &str) -> Result<(), ProxyError> {
    let filename = staged_block_filename(domain);
    let script = format!(
        r#"sh -lc 'test -s "$HOME/{STAGING_DIR}/{filename}" && echo ok || echo missing'"#
    );
    let payload = connection.exec(&script).await?;
    if payload.trim() != "ok" {
        return Err(ProxyError::Operation(format!(
            "failed to stage nginx block at {}",
            staged_block_path(domain)
        )));
    }
    Ok(())
}

async fn apply_proxy_auto(connection: &SshConnection, domain: &str) -> Result<(), ProxyError> {
    let filename = staged_block_filename(domain);
    let escaped_app = shell_single_quote(APP_NGINX_CONFIG);
    let script = format!(
        r#"sh -lc 'set -e
BLOCK="$HOME/{STAGING_DIR}/{filename}"
APP={escaped_app}
if [ ! -s "$BLOCK" ]; then
  echo "staged block missing: $BLOCK" >&2
  exit 10
fi
sudo env BLOCK="$BLOCK" APP="$APP" bash -c '"'"'set -e
cp "$APP" "$APP.bak.$(date +%s)"
cat "$BLOCK" >> "$APP"
nginx -t
systemctl reload nginx
echo applied'"'"''"#
    );

    match connection.exec(&script).await {
        Ok(_) => Ok(()),
        Err(SshError::Command(message)) if message.contains("status 10") => {
            Err(ProxyError::Operation(format!(
                "staged block missing at {} — click Stage proxy again before applying",
                staged_block_path(domain)
            )))
        }
        Err(SshError::Command(message)) if message.contains("status 11") => {
            Err(ProxyError::Validation(extract_nginx_test_output(&message)))
        }
        Err(SshError::Command(message)) if message.contains("status 12") => {
            Err(ProxyError::Operation(
                "nginx reload failed after validation — app config was restored from backup".into(),
            ))
        }
        Err(SshError::Command(message)) if message.contains("sudo") => {
            Err(ProxyError::Privilege(message))
        }
        Err(error) => Err(ProxyError::Ssh(error)),
    }
}

fn build_apply_commands(_domain: &str, staged_path: &str) -> Vec<String> {
    let script = format!(
        r#"BLOCK="{staged_path}"
test -f "$BLOCK" || {{ echo 'Missing staged file — click Stage proxy in Mesh first'; exit 1; }}
cat "$BLOCK"
echo ""
echo "Applying nginx config (enter sudo password once)..."
sudo env BLOCK="$BLOCK" bash -c 'set -e
APP={APP_NGINX_CONFIG}
cp "$APP" "$APP.bak.$(date +%Y%m%d%H%M%S)"
cat "$BLOCK" >> "$APP"
nginx -t
systemctl reload nginx
echo "Done — proxy live."'"#
    );
    vec![
        format!("# Staged block: {staged_path}"),
        script,
    ]
}

fn build_dns_instructions(domain: &str, dns_ip: &str) -> DnsInstructions {
    let name = dns_record_name(domain);
    DnsInstructions {
        domain: domain.to_string(),
        record_type: "A".into(),
        name,
        ipv4: dns_ip.to_string(),
        proxy_status: "DNS only (grey cloud in Cloudflare)".into(),
        certbot_command: format!("sudo certbot --nginx -d {domain}"),
    }
}

fn dns_record_name(domain: &str) -> String {
    if domain.contains('.') {
        domain.split('.').next().unwrap_or(domain).to_string()
    } else {
        domain.to_string()
    }
}

fn generate_server_block(domain: &str, port: u16, websocket_enabled: bool) -> String {
    let mut block = format!(
        "server {{\n    listen 80;\n    server_name {domain};\n\n    location / {{\n        proxy_pass http://127.0.0.1:{port};\n        proxy_http_version 1.1;\n\n        proxy_set_header Host $host;\n        proxy_set_header X-Real-IP $remote_addr;\n"
    );
    if websocket_enabled {
        block.push_str("        proxy_set_header Upgrade $http_upgrade;\n        proxy_set_header Connection \"upgrade\";\n");
    }
    block.push_str("    }\n}\n");
    block
}

fn validate_domain(domain: &str) -> Result<String, ProxyError> {
    let domain = domain.trim().to_ascii_lowercase();
    if domain.is_empty() || domain.len() > 253 {
        return Err(ProxyError::InvalidDomain(
            "domain must be between 1 and 253 characters".into(),
        ));
    }
    if domain.contains("..") || domain.starts_with('.') || domain.ends_with('.') {
        return Err(ProxyError::InvalidDomain("invalid domain format".into()));
    }
    for label in domain.split('.') {
        if label.is_empty() || label.len() > 63 {
            return Err(ProxyError::InvalidDomain("invalid domain label".into()));
        }
        if !label
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
        {
            return Err(ProxyError::InvalidDomain(
                "domain may only contain letters, numbers, dots, and hyphens".into(),
            ));
        }
        if label.starts_with('-') || label.ends_with('-') {
            return Err(ProxyError::InvalidDomain(
                "domain labels cannot start or end with a hyphen".into(),
            ));
        }
    }
    Ok(domain)
}

fn validate_port(port: u16) -> Result<(), ProxyError> {
    if port == 0 {
        return Err(ProxyError::InvalidPort("port must be between 1 and 65535".into()));
    }
    Ok(())
}

fn ensure_not_protected_filename(domain: &str) -> Result<(), ProxyError> {
    if PROTECTED_CONFIG_NAMES.iter().any(|name| *name == domain) {
        return Err(ProxyError::Protected(format!(
            "refusing to modify protected nginx config \"{domain}\""
        )));
    }
    Ok(())
}

fn ensure_removable_domain(domain: &str) -> Result<(), ProxyError> {
    if PROTECTED_DOMAINS
        .iter()
        .any(|protected| protected.eq_ignore_ascii_case(domain))
    {
        return Err(ProxyError::Protected(format!(
            "refusing to remove protected domain \"{domain}\""
        )));
    }
    Ok(())
}

async fn resolve_config_real_path(
    connection: &SshConnection,
    enabled_path: &str,
) -> Result<String, ProxyError> {
    let escaped = shell_single_quote(enabled_path);
    let payload = connection
        .exec(&format!(
            r#"sh -lc 'readlink -f {escaped} 2>/dev/null || echo {escaped}'"#
        ))
        .await?;
    Ok(payload.trim().to_string())
}

async fn read_config_file(
    connection: &SshConnection,
    path: &str,
) -> Result<String, ProxyError> {
    let escaped = shell_single_quote(path);
    let payload = connection
        .exec(&format!(r#"sh -lc 'cat {escaped} 2>/dev/null || true'"#))
        .await?;
    if payload.trim().is_empty() {
        return Err(ProxyError::Operation(format!(
            "nginx config is empty or missing at {path}"
        )));
    }
    Ok(payload)
}

fn staged_removal_filename(domain: &str) -> String {
    format!("{domain}.config")
}

fn staged_removal_path(domain: &str) -> String {
    format!("$HOME/{STAGING_DIR}/{}", staged_removal_filename(domain))
}

async fn write_staged_removal_config(
    connection: &SshConnection,
    domain: &str,
    content: &str,
) -> Result<(), ProxyError> {
    let base64_content = STANDARD.encode(content);
    let filename = staged_removal_filename(domain);
    let script = format!(
        r#"sh -lc 'set -e
mkdir -p "$HOME/{STAGING_DIR}"
echo '"'"'{base64_content}'"'"' | base64 -d > "$HOME/{STAGING_DIR}/{filename}"
test -s "$HOME/{STAGING_DIR}/{filename}"'"#
    );
    connection.exec(&script).await?;
    Ok(())
}

async fn apply_removal_auto(
    connection: &SshConnection,
    domain: &str,
    config_path: &str,
) -> Result<(), ProxyError> {
    let filename = staged_removal_filename(domain);
    let escaped_config = shell_single_quote(config_path);
    let script = format!(
        r#"sh -lc 'set -e
STAGED="$HOME/{STAGING_DIR}/{filename}"
TARGET={escaped_config}
if [ ! -s "$STAGED" ]; then
  echo "staged config missing: $STAGED" >&2
  exit 10
fi
sudo env STAGED="$STAGED" TARGET="$TARGET" bash -c '"'"'set -e
cp "$TARGET" "$TARGET.bak.$(date +%s)"
cp "$STAGED" "$TARGET"
nginx -t
systemctl reload nginx
echo removed'"'"''"#
    );

    match connection.exec(&script).await {
        Ok(_) => Ok(()),
        Err(SshError::Command(message)) if message.contains("status 10") => Err(
            ProxyError::Operation(format!(
                "staged config missing at {} — try remove again",
                staged_removal_path(domain)
            )),
        ),
        Err(SshError::Command(message)) if message.contains("sudo") => {
            Err(ProxyError::Privilege(message))
        }
        Err(SshError::Command(message)) => Err(ProxyError::Validation(message)),
        Err(error) => Err(ProxyError::Ssh(error)),
    }
}

fn build_remove_commands(domain: &str, staged_path: &str, config_path: &str) -> Vec<String> {
    let script = format!(
        r#"STAGED="{staged_path}"
TARGET="{config_path}"
test -f "$STAGED" || {{ echo 'Missing staged file — click Remove in Mesh first'; exit 1; }}
echo "Removing nginx block for {domain} (enter sudo password once)..."
sudo env STAGED="$STAGED" TARGET="$TARGET" bash -c 'set -e
cp "$TARGET" "$TARGET.bak.$(date +%Y%m%d%H%M%S)"
cp "$STAGED" "$TARGET"
nginx -t
systemctl reload nginx
echo "Done — proxy removed."'"#
    );
    vec![
        format!("# Staged config: {staged_path}"),
        script,
    ]
}

fn remove_server_blocks_for_domain(content: &str, domain: &str) -> Result<(String, usize), ProxyError> {
    let mut output = String::new();
    let mut depth = 0usize;
    let mut current = String::new();
    let mut in_block = false;
    let mut removed_blocks = 0usize;

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("server") && trimmed.contains('{') && depth == 0 {
            in_block = true;
            current.clear();
        }

        if in_block {
            current.push_str(line);
            current.push('\n');
            depth = depth
                .saturating_add(trimmed.matches('{').count())
                .saturating_sub(trimmed.matches('}').count());

            if depth == 0 {
                if block_contains_domain(&current, domain) {
                    removed_blocks += 1;
                } else {
                    output.push_str(&current);
                }
                current.clear();
                in_block = false;
            }
            continue;
        }

        output.push_str(line);
        output.push('\n');
    }

    if in_block {
        return Err(ProxyError::Parse(
            "nginx config ended inside an unclosed server block".into(),
        ));
    }

    Ok((output, removed_blocks))
}

fn block_contains_domain(block: &str, domain: &str) -> bool {
    for line in block.lines() {
        let trimmed = line.trim();
        if !trimmed.starts_with("server_name ") {
            continue;
        }
        let names: Vec<_> = trimmed
            .trim_start_matches("server_name")
            .trim()
            .trim_end_matches(';')
            .split_whitespace()
            .collect();
        if names
            .iter()
            .any(|name| name.eq_ignore_ascii_case(domain))
        {
            return true;
        }
    }
    false
}

fn parse_nginx_payload(payload: &str) -> Result<Vec<ParsedConfigFile>, ProxyError> {
    let mut files = Vec::new();
    let mut current_enabled: Option<String> = None;
    let mut current_body = String::new();

    for line in payload.lines() {
        if let Some(rest) = line.strip_prefix("MESH_NGINX_FILE|") {
            if let Some(enabled) = current_enabled.take() {
                files.push(ParsedConfigFile {
                    enabled_path: enabled,
                    blocks: parse_server_blocks(&current_body)?,
                });
                current_body.clear();
            }
            current_enabled = rest.split('|').next().map(str::to_string);
            continue;
        }
        if line == "MESH_NGINX_END" {
            if let Some(enabled) = current_enabled.take() {
                files.push(ParsedConfigFile {
                    enabled_path: enabled,
                    blocks: parse_server_blocks(&current_body)?,
                });
                current_body.clear();
            }
            continue;
        }
        current_body.push_str(line);
        current_body.push('\n');
    }

    if let Some(enabled) = current_enabled {
        files.push(ParsedConfigFile {
            enabled_path: enabled,
            blocks: parse_server_blocks(&current_body)?,
        });
    }

    Ok(files)
}

fn parse_server_blocks(content: &str) -> Result<Vec<ParsedServerBlock>, ProxyError> {
    let mut blocks = Vec::new();
    let mut depth = 0usize;
    let mut current = String::new();

    for line in content.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with("server") && trimmed.contains('{') && depth == 0 {
            current.clear();
        }
        if !current.is_empty() || (trimmed.starts_with("server") && trimmed.contains('{')) {
            current.push_str(line);
            current.push('\n');
        }
        depth = depth
            .saturating_add(trimmed.matches('{').count())
            .saturating_sub(trimmed.matches('}').count());
        if depth == 0 && !current.is_empty() {
            if let Some(block) = parse_single_server_block(&current)? {
                blocks.push(block);
            }
            current.clear();
        }
    }

    Ok(blocks)
}

fn parse_single_server_block(block: &str) -> Result<Option<ParsedServerBlock>, ProxyError> {
    let mut listen_port = 80u16;
    let mut server_names = Vec::new();
    let mut target_host = None;
    let mut target_port = None;

    for line in block.lines() {
        let trimmed = line.trim();
        if trimmed.starts_with('#') || trimmed.is_empty() {
            continue;
        }
        if trimmed.starts_with("listen ") {
            if let Some(port) = extract_listen_port(trimmed) {
                listen_port = port;
            }
        } else if trimmed.starts_with("server_name ") {
            let names = trimmed
                .trim_start_matches("server_name")
                .trim()
                .trim_end_matches(';')
                .split_whitespace()
                .map(str::to_string)
                .collect::<Vec<_>>();
            server_names.extend(names);
        } else if trimmed.starts_with("proxy_pass ") {
            if let Some((host, port)) = extract_proxy_pass(trimmed) {
                target_host = Some(host);
                target_port = Some(port);
            }
        }
    }

    server_names.retain(|name| name != "_" && !name.is_empty());
    let (Some(host), Some(port)) = (target_host, target_port) else {
        return Ok(None);
    };

    Ok(Some(ParsedServerBlock {
        server_names,
        target_host: host,
        target_port: port,
        listen_port,
    }))
}

fn extract_listen_port(line: &str) -> Option<u16> {
    let value = line
        .trim_start_matches("listen")
        .trim()
        .trim_end_matches(';')
        .split_whitespace()
        .next()?;
    value.parse().ok()
}

fn extract_proxy_pass(line: &str) -> Option<(String, u16)> {
    let value = line
        .trim_start_matches("proxy_pass")
        .trim()
        .trim_end_matches(';');
    let without_scheme = value
        .strip_prefix("http://")
        .or_else(|| value.strip_prefix("https://"))?;
    let (host_port, _) = without_scheme.split_once('/').unwrap_or((without_scheme, ""));
    if let Some((host, port)) = host_port.rsplit_once(':') {
        return Some((host.to_string(), port.parse().ok()?));
    }
    Some(("127.0.0.1".into(), host_port.parse().ok()?))
}

fn parse_listening_ports(payload: &str) -> Vec<ListeningEntry> {
    let mut entries = Vec::new();
    for line in payload.lines().map(str::trim).filter(|line| !line.is_empty()) {
        let Some(port) = extract_ss_port(line) else {
            continue;
        };
        let process = extract_ss_process(line);
        let pids = extract_ss_pids(line);
        entries.push(ListeningEntry {
            port,
            process,
            pids,
        });
    }
    entries
}

fn extract_ss_port(line: &str) -> Option<u16> {
    let local = line.split_whitespace().nth(3)?;
    local.rsplit(':').next()?.parse().ok()
}

fn extract_ss_process(line: &str) -> Option<String> {
    let start = line.find("users:((")?;
    let segment = line.get(start + 8..)?;
    let end = segment.find('"')?;
    Some(segment[..end].to_string())
}

fn extract_ss_pids(line: &str) -> Vec<u32> {
    let mut pids = Vec::new();
    for segment in line.split("pid=") {
        if let Some(raw) = segment.split(',').next() {
            if let Ok(pid) = raw.trim().parse::<u32>() {
                pids.push(pid);
            }
        }
    }
    pids
}

fn build_pid_to_pm2_map(pm2: &super::types::Pm2Summary) -> HashMap<u32, String> {
    pm2.processes
        .iter()
        .filter_map(|process| process.pid.map(|pid| (pid, process.name.clone())))
        .collect()
}

fn build_port_to_pm2_map(
    listening: &[ListeningEntry],
    pid_to_pm2: &HashMap<u32, String>,
) -> HashMap<u16, String> {
    let mut map = HashMap::new();
    for entry in listening {
        for pid in &entry.pids {
            if let Some(name) = pid_to_pm2.get(pid) {
                map.entry(entry.port).or_insert_with(|| name.clone());
            }
        }
    }
    map
}

fn extract_nginx_test_output(message: &str) -> String {
    message
        .split("status 11:")
        .nth(1)
        .unwrap_or(message)
        .trim()
        .to_string()
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\"'\"'"))
}

fn unix_timestamp() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs().to_string())
        .unwrap_or_else(|_| "0".into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_server_block() {
        let content = r#"
server {
    listen 80;
    server_name app.salesradar.live;

    location / {
        proxy_pass http://127.0.0.1:3042;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
"#;
        let blocks = parse_server_blocks(content).unwrap();
        assert_eq!(blocks.len(), 1);
        assert_eq!(blocks[0].server_names, vec!["app.salesradar.live"]);
        assert_eq!(blocks[0].target_port, 3042);
    }

    #[test]
    fn rejects_duplicate_domain_validation() {
        assert!(validate_domain("app.salesradar.live").is_ok());
        assert!(validate_domain("bad..domain").is_err());
    }

    #[test]
    fn parses_audit_payload() {
        let payload = r#"MESH_NGINX_FILE|/etc/nginx/sites-enabled/app|/etc/nginx/sites-available/app
server {
    listen 80;
    server_name app.salesradar.live;
    location / {
        proxy_pass http://127.0.0.1:3042;
    }
}
MESH_NGINX_END
MESH_NGINX_FILE|/etc/nginx/sites-enabled/salesradar.live|/etc/nginx/sites-available/salesradar.live
server {
    listen 80;
    server_name salesradar.live www.salesradar.live;
    location / {
        proxy_pass http://localhost:3000;
    }
}
MESH_NGINX_END"#;
        let files = parse_nginx_payload(payload).unwrap();
        assert_eq!(files.len(), 2);
        assert_eq!(files[0].blocks[0].target_port, 3042);
        assert_eq!(files[1].blocks[0].server_names.len(), 2);
    }

    #[test]
    fn build_apply_commands_append_to_app() {
        let commands = build_apply_commands(
            "go.salesradar.live",
            "$HOME/mesh-proxy-staging/go.salesradar.live.block",
        );
        assert!(commands[0].contains("Staged block"));
        let script = &commands[1];
        assert!(script.contains("mesh-proxy-staging/go.salesradar.live.block"));
        assert!(script.contains(APP_NGINX_CONFIG));
        assert!(script.contains("sudo env BLOCK"));
        assert!(script.contains("nginx -t"));
        assert!(script.contains("enter sudo password once"));
    }

    #[test]
    fn removes_single_domain_block() {
        let content = r#"
server {
    listen 80;
    server_name app.salesradar.live;
    location / {
        proxy_pass http://127.0.0.1:3042;
    }
}
server {
    listen 80;
    server_name crm.salesradar.live;
    location / {
        proxy_pass http://127.0.0.1:4000;
    }
}
"#;
        let (updated, removed) =
            remove_server_blocks_for_domain(content, "crm.salesradar.live").unwrap();
        assert_eq!(removed, 1);
        assert!(updated.contains("app.salesradar.live"));
        assert!(!updated.contains("crm.salesradar.live"));
    }
}
