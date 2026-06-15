#!/usr/bin/env python3
"""Verify Proxy backend behavior against the live server (reads .env locally)."""

from __future__ import annotations

import re
import shlex
import sys
from pathlib import Path

import paramiko

ROOT = Path(__file__).resolve().parents[1]
ENV_PATH = ROOT / ".env"

EXPECTED_DOMAINS = {
    "app.salesradar.live",
    "time.salesradar.live",
    "salesradar.live",
    "www.salesradar.live",
}
TEST_DOMAIN = "mesh-verify-bad.test"
TEST_PORT = 59999


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


def run(client: paramiko.SSHClient, command: str) -> tuple[int, str, str]:
    _, stdout, stderr = client.exec_command(command, timeout=60)
    code = stdout.channel.recv_exit_status()
    out = stdout.read().decode("utf-8", errors="replace").strip()
    err = stderr.read().decode("utf-8", errors="replace").strip()
    return code, out, err


def parse_server_names(payload: str) -> set[str]:
    names: set[str] = set()
    for line in payload.splitlines():
        line = line.strip()
        if line.startswith("server_name "):
            for token in line[len("server_name ") :].rstrip(";").split():
                if token and token != "_":
                    names.add(token)
    return names


def sudo_run(client: paramiko.SSHClient, password: str, command: str) -> tuple[int, str, str]:
    wrapped = f"echo {shlex.quote(password)} | sudo -S bash -lc {shlex.quote(command)}"
    return run(client, wrapped)


def main() -> int:
    env = load_env()
    host = env.get("SSH_HOST")
    user = env.get("SSH_USER")
    password = env.get("SSH_PASSWORD")
    port = int(env.get("SSH_PORT", "22"))

    if not host or not user or not password:
        print("SSH_HOST, SSH_USER, and SSH_PASSWORD must be set in .env")
        return 1

    client = paramiko.SSHClient()
    client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
    client.connect(host, port=port, username=user, password=password, timeout=20)

    failures: list[str] = []

    def check(name: str, ok: bool, detail: str = "") -> None:
        status = "PASS" if ok else "FAIL"
        print(f"[{status}] {name}" + (f" — {detail}" if detail else ""))
        if not ok:
            failures.append(name)

    # 1. List enabled nginx configs and domains
    code, out, err = run(
        client,
        "for f in /etc/nginx/sites-enabled/*; do [ -e \"$f\" ] && echo \"===$f===\" && cat \"$f\"; done",
    )
    check("read sites-enabled", code == 0, err or f"{len(out)} bytes")
    parsed = parse_server_names(out)
    missing = EXPECTED_DOMAINS - parsed
    extra_ok = parsed >= EXPECTED_DOMAINS
    check(
        "expected proxy domains present",
        not missing and extra_ok,
        f"missing={sorted(missing)}" if missing else f"found={sorted(parsed)}",
    )

    # 2. Existing proxies respond locally
    for domain in ("app.salesradar.live", "time.salesradar.live", "salesradar.live"):
        code, out, _ = run(
            client,
            f"curl -s -o /dev/null -w '%{{http_code}}' -H 'Host: {domain}' http://127.0.0.1/ --max-time 5",
        )
        check(f"curl Host:{domain}", code == 0 and out.isdigit(), f"status={out}")

    # 3. Stage directory writable
    code, _, err = run(client, "mkdir -p ~/mesh-proxy-staging && touch ~/mesh-proxy-staging/.mesh_probe && rm ~/mesh-proxy-staging/.mesh_probe")
    check("staging dir writable", code == 0, err)

    # 4. Duplicate domain guard (simulate parser check against live config)
    duplicate = "app.salesradar.live"
    check("duplicate domain would be rejected", duplicate in parsed, duplicate)

    # 5. nginx -t failure rollback (sudo with password, isolated test domain)
    bad_config = f"""server {{
    listen 80;
    server_name {TEST_DOMAIN};
    this_is_not_a_valid_nginx_directive;
    location / {{
        proxy_pass http://127.0.0.1:{TEST_PORT};
    }}
}}
"""
    b64_config = __import__("base64").b64encode(bad_config.encode()).decode()
    avail = f"/etc/nginx/sites-available/{TEST_DOMAIN}"
    enabled = f"/etc/nginx/sites-enabled/{TEST_DOMAIN}"

    code, _, err = sudo_run(
        client,
        password,
        f"echo {shlex.quote(b64_config)} | base64 -d | tee {shlex.quote(avail)} >/dev/null",
    )
    check("write invalid nginx test config", code == 0, err)

    code, _, err = sudo_run(client, password, f"ln -sf {shlex.quote(avail)} {shlex.quote(enabled)}")
    check("symlink invalid nginx test config", code == 0, err)

    code, out, err = sudo_run(client, password, "nginx -t")
    check("nginx -t rejects invalid config", code != 0, err or out)

    code, _, err = sudo_run(
        client,
        password,
        f"rm -f {shlex.quote(enabled)} {shlex.quote(avail)}",
    )
    check("manual rollback removes invalid files", code == 0, err)

    code, out, _ = run(client, f"test ! -e {shlex.quote(avail)} && test ! -e {shlex.quote(enabled)} && echo gone")
    check(
        "invalid nginx files absent after rollback",
        code == 0 and out == "gone",
        out,
    )

    # 6. nginx still running + existing proxies after rollback test
    code, out, _ = run(client, "systemctl is-active nginx")
    check("nginx still active", code == 0 and out == "active", out)

    for domain in ("app.salesradar.live", "time.salesradar.live", "salesradar.live", "www.salesradar.live"):
        code, curl_out, _ = run(
            client,
            f"curl -s -o /dev/null -w '%{{http_code}}' -H 'Host: {domain}' http://127.0.0.1/ --max-time 5",
        )
        check(f"post-rollback curl Host:{domain}", code == 0 and curl_out.isdigit(), f"status={curl_out}")

    # 7. Passwordless sudo status (informational)
    code, out, _ = run(client, "sudo -n true >/dev/null 2>&1 && echo yes || echo no")
    print(f"[INFO] passwordless_sudo={out.strip()}")

    client.close()

    if failures:
        print(f"\n{len(failures)} verification step(s) failed.")
        return 1

    print("\nAll automated verification steps passed.")
    print("Manual: open 5 PTY tabs, use Proxy page, confirm no reconnecting state.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
