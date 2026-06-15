#!/usr/bin/env python3
"""
Diagnose intermittent 502 Bad Gateway for app.salesradar.live -> 127.0.0.1:3042.

Reads SSH credentials from ../.env, runs remote checks, and prints a structured report
with likely root cause and recommended fixes.

Usage:
  python scripts/diagnose_502_app.py
  python scripts/diagnose_502_app.py --domain app.salesradar.live --port 3042
  python scripts/diagnose_502_app.py --probes 30 --interval 0.2
"""

from __future__ import annotations

import argparse
import json
import re
import shlex
import sys
import textwrap
from dataclasses import dataclass, field
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

DEFAULT_DOMAIN = "app.salesradar.live"
DEFAULT_PORT = 3042
COMPARE_DOMAINS = (
    ("time.salesradar.live", 5666),
    ("salesradar.live", 3000),
)


@dataclass
class Finding:
    severity: str  # ok | warn | fail | info
    title: str
    detail: str = ""


@dataclass
class Report:
    domain: str
    port: int
    findings: list[Finding] = field(default_factory=list)

    def add(self, severity: str, title: str, detail: str = "") -> None:
        self.findings.append(Finding(severity, title, detail))


def load_env() -> dict[str, str]:
    values: dict[str, str] = {}
    if not ENV_PATH.exists():
        raise SystemExit(f"Missing {ENV_PATH}")
    for line in ENV_PATH.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def run(client: paramiko.SSHClient, command: str, timeout: int = 60) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(command, timeout=timeout)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return code, out, err


def section(title: str) -> None:
    print()
    print("=" * 72)
    print(title)
    print("=" * 72)


def print_finding(f: Finding) -> None:
    tag = f.severity.upper().ljust(4)
    line = f"[{tag}] {f.title}"
    if f.detail:
        line += f"\n       {f.detail.replace(chr(10), chr(10) + '       ')}"
    print(line)


def extract_nginx_block(config: str, domain: str) -> str:
    blocks = re.split(r"(?=^\s*server\s*\{)", config, flags=re.MULTILINE)
    for block in blocks:
        if re.search(rf"server_name\s+[^;]*\b{re.escape(domain)}\b", block):
            return block.strip()
    return ""


def parse_proxy_pass(block: str) -> str | None:
    match = re.search(r"proxy_pass\s+([^;]+);", block)
    return match.group(1).strip() if match else None


def find_pm2_for_port(pm2_json: list[dict], port: int) -> list[dict]:
    matches: list[dict] = []
    for proc in pm2_json:
        env = proc.get("pm2_env") or {}
        listen = env.get("axm_monitor") or {}
        port_hint = listen.get("port") or env.get("PORT") or env.get("env", {}).get("PORT")
        name = proc.get("name") or env.get("name") or "?"
        status = env.get("status") or "?"
        restarts = env.get("restart_time") or env.get("unstable_restarts") or 0
        pm_uptime = env.get("pm_uptime")
        exec_mode = env.get("exec_mode")
        pid = proc.get("pid") or env.get("pm_pid")
        monit = proc.get("monit") or {}

        # PM2 sometimes exposes listening port in axm_options or env
        env_port = None
        for key in ("PORT", "port", "APP_PORT"):
            val = (env.get("env") or {}).get(key) or env.get(key)
            if val and str(val).isdigit():
                env_port = int(val)

        listen_port = None
        if port_hint and str(port_hint).isdigit():
            listen_port = int(port_hint)
        elif env_port:
            listen_port = env_port

        if listen_port == port or str(port) in json.dumps(proc):
            matches.append(
                {
                    "name": name,
                    "status": status,
                    "pid": pid,
                    "restarts": restarts,
                    "exec_mode": exec_mode,
                    "pm_uptime": pm_uptime,
                    "cpu": monit.get("cpu"),
                    "memory": monit.get("memory"),
                    "script": env.get("pm_exec_path"),
                    "cwd": env.get("pm_cwd"),
                }
            )
    return matches


def probe_http(client: paramiko.SSHClient, url: str, host: str | None = None) -> tuple[int, str, float]:
    host_flag = f"-H 'Host: {host}'" if host else ""
    cmd = (
        f"curl -sS -o /tmp/mesh_probe_body -w '%{{http_code}}|%{{time_total}}' "
        f"{host_flag} {shlex.quote(url)} --max-time 8 2>/tmp/mesh_probe_err || true; "
        f"echo; head -c 120 /tmp/mesh_probe_body 2>/dev/null | tr '\\n' ' '; "
        f"echo; cat /tmp/mesh_probe_err 2>/dev/null"
    )
    code, out, err = run(client, cmd)
    if code != 0:
        return 0, err or "curl failed", 0.0
    lines = out.splitlines()
    status = 0
    elapsed = 0.0
    body = ""
    if lines:
        parts = lines[0].split("|", 1)
        if len(parts) == 2 and parts[0].isdigit():
            status = int(parts[0])
            try:
                elapsed = float(parts[1])
            except ValueError:
                elapsed = 0.0
    if len(lines) > 1:
        body = lines[1].strip()
    if len(lines) > 2 and lines[2].strip():
        body = (body + " ERR:" + lines[2].strip()).strip()
    return status, body, elapsed


def diagnose(
    client: paramiko.SSHClient,
    domain: str,
    port: int,
    probes: int,
    interval: float,
) -> Report:
    report = Report(domain=domain, port=port)

    # --- nginx config ---
    code, nginx_configs, err = run(
        client,
        "for f in /etc/nginx/sites-enabled/*; do [ -e \"$f\" ] && echo \"===$f===\" && cat \"$f\"; done",
    )
    if code != 0:
        report.add("fail", "Could not read nginx sites-enabled", err)
        return report

    block = extract_nginx_block(nginx_configs, domain)
    if not block:
        report.add("fail", f"No nginx server block found for {domain}")
        return report

    upstream = parse_proxy_pass(block) or ""
    report.add("info", "nginx server block found", textwrap.shorten(block.replace("\n", " "), 400))
    if f":{port}" not in upstream and str(port) not in upstream:
        report.add(
            "warn",
            f"proxy_pass ({upstream}) does not target port {port}",
            "Mesh UI may show a different port than nginx actually uses.",
        )
    else:
        report.add("ok", f"nginx proxy_pass targets port {port}", upstream)

    # --- nginx status ---
    code, out, _ = run(client, "systemctl is-active nginx")
    if out == "active":
        report.add("ok", "nginx service is active")
    else:
        report.add("fail", "nginx is not active", out)

    code, out, _ = run(client, "nginx -t 2>&1")
    if code == 0:
        report.add("ok", "nginx -t passes")
    else:
        report.add("fail", "nginx -t fails", out)

    # --- port listener ---
    code, out, _ = run(
        client,
        f"ss -ltnp '( sport = :{port} )' 2>/dev/null || ss -ltn | grep ':{port} '",
    )
    if out.strip():
        report.add("ok", f"Port {port} has a listener", out)
    else:
        report.add(
            "fail",
            f"Nothing listening on port {port} right now",
            "nginx returns 502 when upstream is down or refusing connections.",
        )

    code, out, _ = run(client, f"ss -ltnp | grep ':{port} ' || true")
    proc_line = out.strip()

    # --- PM2 ---
    code, pm2_out, err = run(
        client,
        r"""sh -lc 'export PATH="$HOME/.local/share/fnm/aliases/default/bin:$HOME/.nvm/versions/node/$(ls $HOME/.nvm/versions/node 2>/dev/null | sort -V | tail -1)/bin:$HOME/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"; pm2 jlist 2>/dev/null || echo "[]"'""",
    )
    pm2_list: list[dict] = []
    if pm2_out.startswith("["):
        try:
            pm2_list = json.loads(pm2_out)
        except json.JSONDecodeError:
            report.add("warn", "Could not parse PM2 JSON", pm2_out[:200])
    else:
        report.add("warn", "PM2 jlist returned unexpected output", err or pm2_out[:200])

    # Resolve PM2 process owning port via ss + pm2 pid map
    code, owner_out, _ = run(
        client,
        f"""sh -lc 'PID=$(ss -ltnp "( sport = :{port} )" 2>/dev/null | awk "NR>1 {{print \\$NF}}" | grep -oP "pid=\\K[0-9]+" | head -1); echo PID=$PID; if [ -n "$PID" ]; then ps -p "$PID" -o pid,cmd --no-headers 2>/dev/null; pm2 jlist 2>/dev/null | python3 -c "import json,sys; pid=int(sys.argv[1]); data=json.load(sys.stdin); hits=[p for p in data if (p.get(\\\"pid\\\") or (p.get(\\\"pm2_env\\\") or {{}}).get(\\\"pm_pid\\\"))==pid]; print(\\\"PM2_MATCH=\\\"+(hits[0].get(\\\"name\\\") if hits else \\\"none\\\"))" "$PID" 2>/dev/null; fi'""",
    )
    report.add("info", "Process bound to port", owner_out or "(none)")

    pm2_matches = find_pm2_for_port(pm2_list, port)
    online = [p for p in pm2_matches if p["status"] == "online"]
    offline = [p for p in pm2_matches if p["status"] != "online"]

    if pm2_matches:
        for p in pm2_matches:
            sev = "ok" if p["status"] == "online" else "fail"
            report.add(
                sev,
                f"PM2 app '{p['name']}' status={p['status']} restarts={p['restarts']}",
                f"pid={p['pid']} mode={p['exec_mode']} script={p.get('script')}",
            )
            if int(p.get("restarts") or 0) > 5:
                report.add(
                    "warn",
                    f"High restart count on '{p['name']}'",
                    "Crash loops cause intermittent 502 while PM2 restarts the process.",
                )
    else:
        report.add(
            "warn",
            f"No PM2 process clearly mapped to port {port}",
            "Backend may be started outside PM2 or port is set only at runtime.",
        )

    if not online and proc_line:
        report.add(
            "warn",
            "Port is open but no online PM2 match",
            "Process may not be PM2-managed; check manual node/systemd service.",
        )

    # --- direct backend vs nginx ---
    direct_status, direct_body, direct_time = probe_http(client, f"http://127.0.0.1:{port}/")
    if direct_status == 0:
        report.add("fail", f"Direct backend http://127.0.0.1:{port}/ unreachable", direct_body)
    elif direct_status >= 500:
        report.add("fail", f"Direct backend returns HTTP {direct_status}", direct_body)
    elif direct_status >= 400:
        report.add("warn", f"Direct backend returns HTTP {direct_status}", direct_body)
    else:
        report.add("ok", f"Direct backend returns HTTP {direct_status}", f"{direct_time:.3f}s body={direct_body[:80]}")

    nginx_status, nginx_body, nginx_time = probe_http(
        client, "http://127.0.0.1/", host=domain
    )
    if nginx_status == 502:
        report.add("fail", "nginx returns 502 for this domain right now", nginx_body)
    elif nginx_status >= 500:
        report.add("fail", f"nginx returns HTTP {nginx_status}", nginx_body)
    elif nginx_status >= 400:
        report.add("warn", f"nginx returns HTTP {nginx_status}", nginx_body)
    else:
        report.add("ok", f"nginx proxy returns HTTP {nginx_status}", f"{direct_time:.3f}s body={nginx_body[:80]}")

    if direct_status >= 200 and direct_status < 500 and nginx_status == 502:
        report.add(
            "fail",
            "Backend healthy but nginx still 502",
            "Check server_name mismatch, duplicate server blocks, or stale nginx workers.",
        )

    # --- burst probes (intermittency) ---
    probe_cmd = (
        f"for i in $(seq 1 {probes}); do "
        f"curl -s -o /dev/null -w '%{{http_code}}\\n' -H 'Host: {domain}' http://127.0.0.1/ --max-time 5; "
        f"sleep {interval}; done"
    )
    code, burst_out, _ = run(client, probe_cmd, timeout=max(120, probes * 3))
    codes = [line.strip() for line in burst_out.splitlines() if line.strip().isdigit()]
    if codes:
        from collections import Counter

        counts = Counter(codes)
        summary = ", ".join(f"{k}:{v}" for k, v in sorted(counts.items()))
        report.add("info", f"Burst probe ({probes} requests via nginx)", summary)
        if counts.get("502", 0) > 0 and counts.get("502", 0) < probes:
            report.add(
                "fail",
                "Intermittent 502 confirmed",
                f"{counts['502']}/{probes} requests returned 502 — typical of crash/restart or race at startup.",
            )
        elif counts.get("502", 0) == probes:
            report.add("fail", "Persistent 502 on all burst probes")
        elif counts.get("502", 0) == 0:
            report.add("ok", "No 502 in burst probe window", "Issue may be timing-dependent or external.")

    # --- nginx error log ---
    code, err_log, _ = run(
        client,
        f"grep -h '{domain}\\|upstream\\|connect() failed\\|refused\\|timed out' /var/log/nginx/error.log 2>/dev/null | tail -n 40",
    )
    if err_log.strip():
        recent_502 = [line for line in err_log.splitlines() if "502" in line or "upstream" in line.lower()]
        report.add(
            "info" if not recent_502 else "warn",
            "Recent nginx error.log lines",
            "\n".join(err_log.splitlines()[-15:]),
        )
        if any("connect() failed" in line or "Connection refused" in line for line in err_log.splitlines()):
            report.add(
                "fail",
                "nginx logged upstream connection refused",
                "Backend was not accepting connections when nginx tried to proxy.",
            )
        if any("timed out" in line.lower() for line in err_log.splitlines()):
            report.add(
                "warn",
                "nginx logged upstream timeout",
                "App may be hanging under load; consider proxy_read_timeout or app perf.",
            )
    else:
        report.add("info", "No matching nginx error.log entries (may need sudo)", "")

    # --- compare working domains ---
    section("Comparison with other proxies")
    for cmp_domain, cmp_port in COMPARE_DOMAINS:
        st, body, _ = probe_http(client, "http://127.0.0.1/", host=cmp_domain)
        code2, listen, _ = run(client, f"ss -ltn | grep ':{cmp_port} ' || echo DOWN")
        print(f"  {cmp_domain:28} nginx={st:3}  port {cmp_port}: {'up' if listen.strip() and 'DOWN' not in listen else 'DOWN'}")

    return report


def summarize(report: Report) -> None:
    section("Findings")
    for f in report.findings:
        print_finding(f)

    section("Likely cause & recommendations")
    fails = [f for f in report.findings if f.severity == "fail"]
    warns = [f for f in report.findings if f.severity == "warn"]

    if any("Intermittent 502" in f.title for f in fails):
        print(
            textwrap.dedent(
                """
                INTERMITTENT 502 — most common causes on this stack:
                  1. PM2 app on :3042 crashing or restarting (check pm2 logs <app> --lines 200)
                  2. App slow to bind after restart (nginx hits upstream before listen ready)
                  3. App listening on wrong interface (not 127.0.0.1) intermittently

                Recommended actions:
                  • pm2 logs <app-name> --err --lines 200
                  • pm2 describe <app-name>   (restart count, unstable restarts)
                  • curl -v http://127.0.0.1:3042/ when site shows 502
                  • Ensure app binds 0.0.0.0 or 127.0.0.1 consistently (PORT=3042)
                  • Add nginx proxy_connect_timeout / proxy_next_upstream if needed
                """
            ).strip()
        )
    elif any("Nothing listening" in f.title for f in fails):
        print(
            textwrap.dedent(
                """
                UPSTREAM DOWN — port 3042 is not listening:
                  • pm2 status — find the app that should use port 3042
                  • pm2 restart <app-name>
                  • Verify ecosystem config / .env PORT=3042
                """
            ).strip()
        )
    elif any("nginx returns 502" in f.title for f in fails):
        print(
            textwrap.dedent(
                """
                NGINX 502 NOW — upstream failure at probe time:
                  • Check direct: curl -H 'Host: app.salesradar.live' http://127.0.0.1/
                  • Check backend: curl http://127.0.0.1:3042/
                  • Tail errors: sudo tail -f /var/log/nginx/error.log
                """
            ).strip()
        )
    elif not fails and not warns:
        print("All checks passed during this probe window. If users still see 502:")
        print("  • Run with --probes 50 --interval 0.1 to catch rare flakes")
        print("  • Check Cloudflare SSL mode vs origin (502 body shows nginx — origin reached)")
        print("  • Correlate with deploy/restart times in pm2 logs")
    else:
        print("Review WARN items above; fix backend stability on port 3042 first.")

    if fails or warns:
        print(f"\nSummary: {len(fails)} failure(s), {len(warns)} warning(s)")


def main() -> int:
    parser = argparse.ArgumentParser(description="Diagnose 502 for app.salesradar.live")
    parser.add_argument("--domain", default=DEFAULT_DOMAIN)
    parser.add_argument("--port", type=int, default=DEFAULT_PORT)
    parser.add_argument("--probes", type=int, default=20, help="Burst HTTP probes via nginx")
    parser.add_argument("--interval", type=float, default=0.25, help="Seconds between burst probes")
    args = parser.parse_args()

    env = load_env()
    host = env.get("SSH_HOST")
    user = env.get("SSH_USER")
    password = env.get("SSH_PASSWORD")
    port_ssh = int(env.get("SSH_PORT", "22"))

    if not host or not user or not password:
        print("SSH_HOST, SSH_USER, and SSH_PASSWORD must be set in .env")
        return 1

    print(f"Mesh 502 diagnostic — {args.domain} -> 127.0.0.1:{args.port}")
    print(f"SSH: {user}@{host}:{port_ssh}")

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    try:
        client.connect(host, port=port_ssh, username=user, password=password, timeout=20)
    except Exception as exc:
        print(f"SSH connect failed: {exc}")
        return 1

    try:
        report = diagnose(client, args.domain, args.port, args.probes, args.interval)
    finally:
        client.close()

    summarize(report)
    fail_count = sum(1 for f in report.findings if f.severity == "fail")
    return 1 if fail_count else 0


if __name__ == "__main__":
    sys.exit(main())
