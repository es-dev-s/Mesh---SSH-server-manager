#!/usr/bin/env python3
"""Verify Mesh OTA / R2 configuration without printing secrets."""

from __future__ import annotations

import hashlib
import hmac
import json
import os
import sys
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_dotenv(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.exists():
        return values
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        values[key.strip()] = value.strip()
    return values


def sign(key: bytes, msg: str) -> bytes:
    return hmac.new(key, msg.encode("utf-8"), hashlib.sha256).digest()


def aws_v4_headers(
    *,
    method: str,
    host: str,
    path: str,
    access_key: str,
    secret_key: str,
    region: str = "auto",
    service: str = "s3",
    payload_hash: str = "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
) -> dict[str, str]:
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    canonical_headers = f"host:{host}\nx-amz-content-sha256:{payload_hash}\nx-amz-date:{amz_date}\n"
    signed_headers = "host;x-amz-content-sha256;x-amz-date"
    canonical_request = "\n".join(
        [method, path, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/{region}/{service}/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    k_date = sign(("AWS4" + secret_key).encode(), date_stamp)
    k_region = sign(k_date, region)
    k_service = sign(k_region, service)
    k_signing = sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    return {
        "Host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": authorization,
    }


def check_public_manifest(url: str) -> tuple[bool, str]:
    try:
        with urllib.request.urlopen(url, timeout=15) as response:
            body = response.read().decode("utf-8")
        data = json.loads(body)
        version = data.get("version", "?")
        platforms = list((data.get("platforms") or {}).keys())
        return True, f"manifest OK — version {version}, platforms: {', '.join(platforms) or 'none'}"
    except urllib.error.HTTPError as error:
        return False, f"HTTP {error.code} for {url}"
    except Exception as error:  # noqa: BLE001
        return False, str(error)


def check_r2_object(account_id: str, bucket: str, key: str, access_key: str, secret_key: str) -> tuple[bool, str]:
    host = f"{account_id}.r2.cloudflarestorage.com"
    path = f"/{bucket}/{key}"
    headers = aws_v4_headers(
        method="HEAD",
        host=host,
        path=path,
        access_key=access_key,
        secret_key=secret_key,
    )
    request = urllib.request.Request(f"https://{host}{path}", method="HEAD", headers=headers)
    try:
        with urllib.request.urlopen(request, timeout=15) as response:
            size = response.headers.get("Content-Length", "?")
            return True, f"R2 object s3://{bucket}/{key} exists ({size} bytes)"
    except urllib.error.HTTPError as error:
        return False, f"R2 HEAD failed: HTTP {error.code} for s3://{bucket}/{key}"
    except Exception as error:  # noqa: BLE001
        return False, str(error)


def main() -> int:
    env = load_dotenv(ROOT / ".env")
    ok = True

    print("Mesh OTA verification\n")

    pubkey = env.get("TAURI_UPDATER_PUBKEY", "").strip()
    if pubkey:
        print(f"[ok] TAURI_UPDATER_PUBKEY set ({len(pubkey)} chars)")
    else:
        ok = False
        print("[fail] TAURI_UPDATER_PUBKEY missing — run: npx tauri signer generate -w .tauri/mesh.key")

    manifest_url = env.get("R2_UPDATE_MANIFEST_URL", "").strip()
    if manifest_url:
        passed, detail = check_public_manifest(manifest_url)
        print(f"[{'ok' if passed else 'fail'}] Public manifest: {detail}")
        ok = ok and passed
    else:
        print("[warn] R2_UPDATE_MANIFEST_URL not set — using private R2 credentials at runtime")

    account_id = env.get("R2_ACCOUNT_ID", "").strip()
    access_key = env.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = env.get("R2_SECRET_ACCESS_KEY", "").strip()
    bucket = env.get("R2_BUCKET", "").strip()
    manifest_key = env.get("R2_MANIFEST_KEY", "latest.json").strip()

    if all([account_id, access_key, secret_key, bucket]):
        passed, detail = check_r2_object(account_id, bucket, manifest_key, access_key, secret_key)
        print(f"[{'ok' if passed else 'fail'}] R2 credentials: {detail}")
        ok = ok and passed
    else:
        print("[fail] Incomplete R2 credentials in .env")

    if not manifest_url and not all([account_id, access_key, secret_key, bucket]):
        ok = False
        print("[fail] Set R2_UPDATE_MANIFEST_URL or full R2 credentials")

    print()
    if ok:
        print("All checks passed — rebuild the app, publish latest.json + installer to R2, then test OTA.")
        return 0
    print("Fix the items above before testing OTA.")
    return 1


if __name__ == "__main__":
    sys.exit(main())
