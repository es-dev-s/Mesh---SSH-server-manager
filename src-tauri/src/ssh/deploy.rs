use std::time::Duration;

use base64::{engine::general_purpose::STANDARD, Engine as _};
use serde::Serialize;
use thiserror::Error;

use super::connection::{SshConnection, SshError};

const DEPLOY_ROOT: &str = "$HOME/mesh-deployments";
const PATH_EXPORT: &str = r#"export PATH="/usr/local/go/bin:$HOME/go/bin:$HOME/.local/share/fnm/aliases/default/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH""#;
const DEPLOY_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Error)]
pub enum DeployError {
    #[error(transparent)]
    Ssh(#[from] SshError),
    #[error("invalid repository URL: {0}")]
    InvalidRepo(String),
    #[error("invalid app name: {0}")]
    InvalidName(String),
    #[error("deploy failed: {0}")]
    Failed(String),
    #[error("{0}")]
    Operation(String),
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployStep {
    pub label: String,
    pub success: bool,
    pub detail: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployResult {
    pub app_name: String,
    pub repo_url: String,
    pub deploy_dir: String,
    pub pm2_name: String,
    pub success: bool,
    pub steps: Vec<DeployStep>,
    pub port: Option<u16>,
    pub local_url: Option<String>,
    pub server_host: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeploymentEntry {
    pub app_name: String,
    pub repo_url: Option<String>,
    pub deploy_dir: String,
    pub pm2_name: String,
    pub pm2_status: Option<String>,
    pub port: Option<u16>,
    pub local_url: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DeployOverview {
    pub deployments: Vec<DeploymentEntry>,
    pub server_host: String,
    pub deploy_root: String,
    pub fetched_at: String,
}

pub async fn list_deployments(
    connection: &SshConnection,
    server_host: &str,
) -> Result<DeployOverview, DeployError> {
    let script = format!(
        r#"sh -lc '{PATH_EXPORT}; ROOT={DEPLOY_ROOT}; echo MESH_DEPLOY_ROOT|$ROOT; for d in "$ROOT"/*; do [ -d "$d" ] || continue; name=$(basename "$d"); url=""; if [ -f "$d/.mesh-repo" ]; then url=$(cat "$d/.mesh-repo" 2>/dev/null); fi; echo MESH_DEPLOY|$name|$url|$d; done'"#
    );
    let payload = connection.exec(&script).await?;
    let mut deployments = Vec::new();

    for line in payload.lines().map(str::trim).filter(|line| !line.is_empty()) {
        if let Some(rest) = line.strip_prefix("MESH_DEPLOY|") {
            let parts: Vec<&str> = rest.splitn(3, '|').collect();
            if parts.len() < 3 {
                continue;
            }
            let app_name = parts[0].to_string();
            let repo_url = if parts[1].is_empty() {
                None
            } else {
                Some(parts[1].to_string())
            };
            let deploy_dir = parts[2].to_string();
            let pm2_name = format!("mesh-{app_name}");
            deployments.push(DeploymentEntry {
                app_name,
                repo_url,
                deploy_dir,
                pm2_name,
                pm2_status: None,
                port: None,
                local_url: None,
            });
        }
    }

    enrich_with_pm2_ports(connection, server_host, &mut deployments).await?;

    Ok(DeployOverview {
        deployments,
        server_host: server_host.to_string(),
        deploy_root: DEPLOY_ROOT.replace("$HOME", "~"),
        fetched_at: unix_timestamp(),
    })
}

pub async fn run_deploy(
    connection: &SshConnection,
    server_host: &str,
    repo_url: &str,
    build_command: Option<&str>,
    start_command: &str,
    app_name: Option<&str>,
    env_content: Option<&str>,
) -> Result<DeployResult, DeployError> {
    let repo_url = validate_repo_url(repo_url)?;
    let slug = app_name
        .map(validate_app_name)
        .transpose()?
        .unwrap_or_else(|| slug_from_repo(&repo_url));
    validate_app_name(&slug)?;

    let start_command = start_command.trim();
    let build_command = build_command.map(str::trim).filter(|s| !s.is_empty());
    let env_content = env_content.map(str::trim).filter(|s| !s.is_empty());
    let pm2_name = format!("mesh-{slug}");
    let deploy_dir = format!("{DEPLOY_ROOT}/{slug}");

    let body = build_deploy_body(
        DeployMode::Fresh {
            repo_url: &repo_url,
            build_command,
            start_command,
            env_content,
        },
        &slug,
        &pm2_name,
    );
    let (payload, failed) = exec_deploy_script(connection, &body).await?;
    finish_deploy_result(
        slug,
        repo_url,
        deploy_dir,
        pm2_name,
        server_host,
        payload,
        failed,
    )
}

pub async fn read_deploy_env(
    connection: &SshConnection,
    app_name: &str,
) -> Result<String, DeployError> {
    let slug = validate_app_name(app_name)?;
    let dir = shell_single_quote(&format!("{DEPLOY_ROOT}/{slug}"));
    let script = format!(
        r#"sh -c 'if [ -f {dir}/.mesh-env ]; then cat {dir}/.mesh-env; elif [ -f {dir}/.env ]; then cat {dir}/.env; fi'"#
    );
    Ok(connection.exec(&script).await.unwrap_or_default())
}

pub async fn pull_deploy(
    connection: &SshConnection,
    server_host: &str,
    app_name: &str,
) -> Result<DeployResult, DeployError> {
    let slug = validate_app_name(app_name)?;
    let pm2_name = format!("mesh-{slug}");
    let deploy_dir = format!("{DEPLOY_ROOT}/{slug}");

    let body = build_deploy_body(DeployMode::Pull, &slug, &pm2_name);
    let (payload, failed) = exec_deploy_script(connection, &body).await?;
    let repo_url = read_deploy_meta(connection, &slug).await.unwrap_or_default();
    finish_deploy_result(
        slug,
        repo_url,
        deploy_dir,
        pm2_name,
        server_host,
        payload,
        failed,
    )
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RemoveDeployResult {
    pub app_name: String,
    pub removed: bool,
    pub message: String,
}

pub async fn remove_deployment(
    connection: &SshConnection,
    app_name: &str,
) -> Result<RemoveDeployResult, DeployError> {
    let slug = validate_app_name(app_name)?;
    let pm2_name = format!("mesh-{slug}");
    let deploy_dir = format!("{DEPLOY_ROOT}/{slug}");

    let script = format!(
        r#"sh -lc 'set -e
{PATH_EXPORT}
PM2={pm2_quoted}
DIR={dir_quoted}
pm2 delete "$PM2" >/dev/null 2>&1 || true
pm2 save >/dev/null 2>&1 || true
if [ -d "$DIR" ]; then rm -rf "$DIR"; fi
echo removed'"#,
        pm2_quoted = shell_single_quote(&pm2_name),
        dir_quoted = shell_single_quote(&deploy_dir),
    );

    connection
        .exec(&script)
        .await
        .map_err(|error| DeployError::Failed(error.to_string()))?;

    Ok(RemoveDeployResult {
        app_name: slug,
        removed: true,
        message: format!("Removed deployment and PM2 process {pm2_name}."),
    })
}

async fn read_deploy_meta(connection: &SshConnection, slug: &str) -> Result<String, DeployError> {
    let dir = format!("{DEPLOY_ROOT}/{slug}");
    let escaped = shell_single_quote(&format!("{dir}/.mesh-repo"));
    let payload = connection
        .exec(&format!(r#"sh -lc 'cat {escaped} 2>/dev/null || true'"#))
        .await?;
    Ok(payload.trim().to_string())
}

async fn enrich_with_pm2_ports(
    connection: &SshConnection,
    server_host: &str,
    deployments: &mut [DeploymentEntry],
) -> Result<(), DeployError> {
    if deployments.is_empty() {
        return Ok(());
    }

    let script = format!(
        r#"sh -lc '{PATH_EXPORT}; pm2 jlist 2>/dev/null || echo "[]"'"#
    );
    let payload = connection.exec(&script).await?;
    let json_start = payload.find('[').unwrap_or(0);
    let json: serde_json::Value = serde_json::from_str(&payload[json_start..]).unwrap_or_default();

    let mut name_to_status: std::collections::HashMap<String, (String, Option<u32>)> =
        std::collections::HashMap::new();
    if let Some(list) = json.as_array() {
        for item in list {
            let name = item.get("name").and_then(|v| v.as_str()).unwrap_or("");
            let status = item
                .get("pm2_env")
                .and_then(|env| env.get("status"))
                .and_then(|v| v.as_str())
                .unwrap_or("unknown")
                .to_string();
            let pid = item
                .get("pid")
                .and_then(|v| v.as_u64())
                .map(|v| v as u32);
            name_to_status.insert(name.to_string(), (status, pid));
        }
    }

    let ss_payload = connection
        .exec(r#"ss -tlnp 2>/dev/null | awk 'NR>1 {print}'"#)
        .await?;
    let pid_ports = parse_pid_ports(&ss_payload);

    for entry in deployments.iter_mut() {
        if let Some((status, pid)) = name_to_status.get(&entry.pm2_name) {
            entry.pm2_status = Some(status.clone());
            if let Some(pid) = pid {
                entry.port = pid_ports.get(pid).copied();
                entry.local_url = entry.port.map(|p| format!("http://{server_host}:{p}"));
            }
        }
    }

    Ok(())
}

fn parse_pid_ports(payload: &str) -> std::collections::HashMap<u32, u16> {
    let mut map = std::collections::HashMap::new();
    for line in payload.lines() {
        let Some(port) = extract_ss_port(line) else {
            continue;
        };
        for segment in line.split("pid=") {
            if let Some(raw) = segment.split(',').next() {
                if let Ok(pid) = raw.trim().parse::<u32>() {
                    map.entry(pid).or_insert(port);
                }
            }
        }
    }
    map
}

fn extract_ss_port(line: &str) -> Option<u16> {
    let local = line.split_whitespace().nth(3)?;
    local.rsplit(':').next()?.parse().ok()
}

enum DeployMode<'a> {
    Fresh {
        repo_url: &'a str,
        build_command: Option<&'a str>,
        start_command: &'a str,
        env_content: Option<&'a str>,
    },
    Pull,
}

const STACK_DETECT_BLOCK: &str = r#"
if [ -z "$BUILD_CMD" ] || [ -z "$START_CMD" ]; then
  if [ -f go.mod ]; then
    [ -z "$BUILD_CMD" ] && BUILD_CMD="go build -o $SLUG ."
    [ -z "$START_CMD" ] && START_CMD="./$SLUG"
    echo "MESH_STEP|Detect|ok|Go project — build and run binary"
  elif [ -f package.json ]; then
    if grep -q '"next"' package.json 2>/dev/null || [ -f next.config.js ] || [ -f next.config.mjs ] || [ -f next.config.ts ]; then
      [ -z "$BUILD_CMD" ] && BUILD_CMD="npm ci && npm run build"
      [ -z "$START_CMD" ] && START_CMD="npm run start"
      echo "MESH_STEP|Detect|ok|Next.js — npm ci, build, start"
    elif grep -q '"vite"' package.json 2>/dev/null || [ -f vite.config.js ] || [ -f vite.config.ts ]; then
      [ -z "$BUILD_CMD" ] && BUILD_CMD="npm ci && npm run build"
      [ -z "$START_CMD" ] && START_CMD="npm run preview -- --host 0.0.0.0 --port ${PORT:-4173}"
      echo "MESH_STEP|Detect|ok|Vite/React — build and preview server"
    elif grep -q '"build"' package.json 2>/dev/null; then
      [ -z "$BUILD_CMD" ] && BUILD_CMD="npm ci && npm run build"
      [ -z "$START_CMD" ] && START_CMD="npm run start"
      echo "MESH_STEP|Detect|ok|Node.js — npm ci, build, start"
    else
      [ -z "$BUILD_CMD" ] && BUILD_CMD="npm ci"
      [ -z "$START_CMD" ] && START_CMD="npm start"
      echo "MESH_STEP|Detect|ok|Node.js — npm ci and start"
    fi
  elif [ -f cmd/main.go ] || ls *.go >/dev/null 2>&1; then
    [ -z "$BUILD_CMD" ] && BUILD_CMD="go build -o $SLUG ."
    [ -z "$START_CMD" ] && START_CMD="./$SLUG"
    echo "MESH_STEP|Detect|ok|Go sources detected"
  else
    echo "MESH_STEP|Detect|fail|Unknown stack — set build/start commands manually"
    exit 25
  fi
fi
"#;

const BUILD_RUN_BLOCK: &str = r#"
if [ -n "$BUILD_CMD" ]; then printf '%s' "$BUILD_CMD" > "$DIR/.mesh-build"; fi
if [ -n "$START_CMD" ]; then printf '%s' "$START_CMD" > "$DIR/.mesh-start"; fi
if [ -f "$DIR/.mesh-env" ]; then
  cp "$DIR/.mesh-env" "$DIR/.env"
  echo "MESH_STEP|Env|ok|Environment configured"
elif [ -f "$DIR/.env" ]; then
  echo "MESH_STEP|Env|ok|Using existing .env"
elif [ -f "$DIR/.env.example" ]; then
  echo "MESH_STEP|Env|fail|Add environment variables in Deploy before deploying"
  exit 26
else
  echo "MESH_STEP|Env|ok|No environment file required"
fi
if [ -n "$BUILD_CMD" ]; then
  if ! eval "$BUILD_CMD"; then
    echo "MESH_STEP|Build|fail|Build command failed"
    exit 20
  fi
  echo "MESH_STEP|Build|ok|Build finished"
else
  echo "MESH_STEP|Build|ok|Skipped (no build command)"
fi
pm2 delete "$PM2" >/dev/null 2>&1 || true
START_CMD="$(printf '%s' "$START_CMD" | tr -d '\r' | sed 's/^[[:space:]]*//;s/[[:space:]]*$//')"
if [ -z "$START_CMD" ]; then
  echo "MESH_STEP|PM2|fail|Start command is empty"
  exit 23
fi
mesh_start_pm2() {
  cd "$DIR" || return 1
  case "$START_CMD" in
    ./*)
      BIN="${START_CMD#./}"
      chmod +x "$DIR/$BIN" 2>/dev/null || true
      pm2 start "$DIR/$BIN" --name "$PM2" --cwd "$DIR" --interpreter none
      ;;
    npm\ run\ *)
      pm2 start npm --name "$PM2" --cwd "$DIR" -- run ${START_CMD#npm run }
      ;;
    npm\ start)
      pm2 start npm --name "$PM2" --cwd "$DIR" -- start
      ;;
    node\ *)
      pm2 start ${START_CMD#node } --name "$PM2" --cwd "$DIR"
      ;;
    *)
      pm2 start bash --name "$PM2" -- -lc "cd \"$DIR\" && exec $START_CMD"
      ;;
  esac
}
if ! mesh_start_pm2; then
  echo "MESH_STEP|PM2|fail|PM2 failed to start process"
  exit 23
fi
pm2 save >/dev/null 2>&1 || true
sleep 3
PM2_STATUS="$(pm2 describe "$PM2" 2>/dev/null | sed -n 's/.*status[^│]*│ \([^│]*\).*/\1/p' | head -1 | tr -d ' ')"
if [ "$PM2_STATUS" != "online" ]; then
  ERR_TAIL="$(tail -5 "$HOME/.pm2/logs/${PM2}-error.log" 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g')"
  if [ -z "$ERR_TAIL" ]; then
    ERR_TAIL="$(tail -5 "$HOME/.pm2/logs/${PM2}-out.log" 2>/dev/null | tr '\n' ' ' | sed 's/  */ /g')"
  fi
  echo "MESH_STEP|PM2|fail|${ERR_TAIL:-Process is $PM2_STATUS — check start command and .env}"
  exit 24
fi
echo "MESH_STEP|PM2|ok|Process started (status: online)"
"#;

fn b64_write(path_expr: &str, content: &str) -> String {
    let encoded = STANDARD.encode(content.as_bytes());
    format!("echo '{encoded}' | base64 -d > {path_expr}")
}

fn wrap_bash_script(body: &str) -> String {
    let encoded = STANDARD.encode(body.as_bytes());
    format!("sh -lc \"echo '{encoded}' | base64 -d | bash\"")
}

fn build_deploy_body(mode: DeployMode<'_>, slug: &str, pm2_name: &str) -> String {
    let (clone_block, init_vars) = match &mode {
        DeployMode::Fresh {
            repo_url,
            build_command,
            start_command,
            env_content,
        } => {
            let build = build_command.unwrap_or("");
            let env_block = env_content.map(|env| {
                format!(
                    "{}\n{}",
                    b64_write(r#""$DIR/.env""#, env),
                    b64_write(r#""$DIR/.mesh-env""#, env),
                )
            }).unwrap_or_default();
            let clone_block = format!(
                r#"if [ -d "$DIR/.git" ]; then
  git -C "$DIR" pull --ff-only
  echo "MESH_STEP|Clone|ok|Repository updated"
else
  git clone "{repo_url}" "$DIR"
  echo "MESH_STEP|Clone|ok|Repository cloned"
fi
{b64_repo}
{b64_build}
{b64_start}
{env_block}"#,
                repo_url = repo_url.replace('"', "\\\""),
                b64_repo = b64_write(r#""$DIR/.mesh-repo""#, repo_url),
                b64_build = b64_write(r#""$DIR/.mesh-build""#, build),
                b64_start = b64_write(r#""$DIR/.mesh-start""#, start_command),
                env_block = env_block,
            );
            let init_vars = format!(
                r#"BUILD_CMD={build_b64}
START_CMD={start_b64}"#,
                build_b64 = b64_inline(build),
                start_b64 = b64_inline(start_command),
            );
            (clone_block, init_vars)
        }
        DeployMode::Pull => (
            r#"if [ ! -d "$DIR/.git" ]; then
  echo "MESH_STEP|Pull|fail|No git repo at $DIR — deploy first"
  exit 21
fi
git -C "$DIR" pull --ff-only
echo "MESH_STEP|Pull|ok|Repository updated"
if [ -f "$DIR/.mesh-env" ]; then cp "$DIR/.mesh-env" "$DIR/.env"; fi
BUILD_CMD=""
START_CMD=""
if [ -f "$DIR/.mesh-build" ]; then BUILD_CMD="$(cat "$DIR/.mesh-build")"; fi
if [ -f "$DIR/.mesh-start" ]; then START_CMD="$(cat "$DIR/.mesh-start")"; fi"#
                .to_string(),
            String::new(),
        ),
    };

    format!(
        r#"set -e
{PATH_EXPORT}
ROOT={DEPLOY_ROOT}
SLUG={slug}
PM2={pm2}
DIR="$ROOT/$SLUG"
mkdir -p "$ROOT"
echo "MESH_STEP|Prepare|ok|Deploy directory $DIR"
{clone_block}
cd "$DIR"
{init_vars}
{STACK_DETECT_BLOCK}
{BUILD_RUN_BLOCK}
PORT=""
PID=$(pm2 pid "$PM2" 2>/dev/null | head -1)
if [ -n "$PID" ] && [ "$PID" != "0" ]; then
  PORT=$(ss -tlnp 2>/dev/null | grep "pid=$PID" | head -1 | sed -n "s/.*:\\([0-9][0-9]*\\) .*/\\1/p")
fi
echo "MESH_PORT|$PORT"
echo "MESH_STEP|Done|ok|Deploy complete"
"#,
        PATH_EXPORT = PATH_EXPORT,
        DEPLOY_ROOT = DEPLOY_ROOT,
        slug = slug,
        pm2 = pm2_name,
        clone_block = clone_block,
        init_vars = init_vars,
        STACK_DETECT_BLOCK = STACK_DETECT_BLOCK,
        BUILD_RUN_BLOCK = BUILD_RUN_BLOCK,
    )
}

fn b64_inline(content: &str) -> String {
    if content.is_empty() {
        return "\"\"".into();
    }
    format!(
        "\"$(echo '{}' | base64 -d)\"",
        STANDARD.encode(content.as_bytes())
    )
}

async fn exec_deploy_script(
    connection: &SshConnection,
    body: &str,
) -> Result<(String, bool), DeployError> {
    let script = wrap_bash_script(body);
    match connection.exec_with_timeout(&script, DEPLOY_TIMEOUT).await {
        Ok(payload) => Ok((payload, false)),
        Err(SshError::Command(message)) => Ok((extract_command_output(&message), true)),
        Err(error) => Err(DeployError::Failed(error.to_string())),
    }
}

fn extract_command_output(message: &str) -> String {
    message
        .split_once(": ")
        .map(|(_, rest)| rest.to_string())
        .unwrap_or_else(|| message.to_string())
}

fn finish_deploy_result(
    slug: String,
    repo_url: String,
    deploy_dir: String,
    pm2_name: String,
    server_host: &str,
    payload: String,
    failed: bool,
) -> Result<DeployResult, DeployError> {
    let steps = parse_steps(&payload);
    let port = parse_port(&payload);
    let success = !failed && deploy_succeeded(&steps);
    let local_url = port.map(|p| format!("http://{server_host}:{p}"));
    let message = if success {
        local_url
            .as_ref()
            .map(|url| format!("App running at {url}"))
            .unwrap_or_else(|| "Deploy finished — check PM2 logs if port is not detected yet.".into())
    } else if steps.iter().any(|step| !step.success) {
        steps
            .iter()
            .find(|step| !step.success)
            .map(|step| format!("Deploy failed at {} — {}", step.label, step.detail))
            .unwrap_or_else(|| "Deploy failed — review steps below.".into())
    } else {
        "Deploy failed — review steps below.".into()
    };

    Ok(DeployResult {
        app_name: slug,
        repo_url,
        deploy_dir: deploy_dir.replace("$HOME", "~"),
        pm2_name,
        success,
        steps,
        port,
        local_url,
        server_host: server_host.to_string(),
        message,
    })
}

fn parse_steps(payload: &str) -> Vec<DeployStep> {
    payload
        .lines()
        .filter_map(|line| {
            let rest = line.strip_prefix("MESH_STEP|")?;
            let parts: Vec<&str> = rest.splitn(3, '|').collect();
            if parts.len() < 2 {
                return None;
            }
            let status = parts[1];
            if status == "start" {
                return None;
            }
            Some(DeployStep {
                label: parts[0].to_string(),
                success: status == "ok",
                detail: parts.get(2).unwrap_or(&"").to_string(),
            })
        })
        .collect()
}

fn deploy_succeeded(steps: &[DeployStep]) -> bool {
    !steps.is_empty()
        && !steps.iter().any(|step| !step.success)
        && steps.iter().any(|step| step.label == "Done" && step.success)
}

fn parse_port(payload: &str) -> Option<u16> {
    payload
        .lines()
        .find_map(|line| line.strip_prefix("MESH_PORT|"))
        .and_then(|value| value.trim().parse().ok())
        .filter(|port| *port > 0)
}

fn validate_repo_url(url: &str) -> Result<String, DeployError> {
    let url = url.trim();
    if !url.starts_with("https://github.com/")
        && !url.starts_with("git@github.com:")
        && !url.starts_with("http://github.com/")
    {
        return Err(DeployError::InvalidRepo(
            "use a GitHub HTTPS or git@ URL".into(),
        ));
    }
    if url.contains(' ') {
        return Err(DeployError::InvalidRepo("URL cannot contain spaces".into()));
    }
    Ok(url.to_string())
}

fn validate_app_name(name: &str) -> Result<String, DeployError> {
    let name = name.trim().to_ascii_lowercase();
    if name.is_empty() || name.len() > 48 {
        return Err(DeployError::InvalidName(
            "name must be 1–48 characters".into(),
        ));
    }
    if !name
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '-')
    {
        return Err(DeployError::InvalidName(
            "use letters, numbers, and hyphens only".into(),
        ));
    }
    Ok(name)
}

fn slug_from_repo(url: &str) -> String {
    let trimmed = url.trim_end_matches('/').trim_end_matches(".git");
    let segment = trimmed.rsplit('/').next().unwrap_or("app");
    validate_app_name(segment).unwrap_or_else(|_| "app".into())
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "'\\''"))
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
    fn slug_from_github_url() {
        assert_eq!(
            slug_from_repo("https://github.com/acme/my-app.git"),
            "my-app"
        );
    }

    #[test]
    fn parses_deploy_steps() {
        let payload = "MESH_STEP|Clone|ok|Cloned\nMESH_STEP|Build|fail|npm error";
        let steps = parse_steps(payload);
        assert_eq!(steps.len(), 2);
        assert!(steps[0].success);
        assert!(!steps[1].success);
    }

    #[test]
    fn ignores_in_progress_start_steps() {
        let payload = "MESH_STEP|Prepare|start|Working\nMESH_STEP|Prepare|ok|Ready\nMESH_STEP|Clone|ok|Updated\nMESH_STEP|Done|ok|Complete";
        let steps = parse_steps(payload);
        assert_eq!(steps.len(), 3);
        assert!(deploy_succeeded(&steps));
    }

    #[test]
    fn deploy_body_includes_build_and_pm2_steps() {
        let body = build_deploy_body(
            DeployMode::Fresh {
                repo_url: "https://github.com/es-dev-s/Travio-server.git",
                build_command: Some("go build -o travio ."),
                start_command: "./travio",
                env_content: Some("DATABASE_URL=postgres://x\nJWT_SECRET=secret"),
            },
            "travio",
            "mesh-travio",
        );
        assert!(body.contains("MESH_STEP|Build|ok|Build finished"));
        assert!(body.contains("MESH_STEP|PM2|ok|Process started"));
        assert!(body.contains("base64 -d"));
        assert!(!body.contains("echo 'go build"));
    }
}
