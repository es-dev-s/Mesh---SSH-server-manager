#!/usr/bin/env python3
"""Upload latest.json + installer to Cloudflare R2 for Mesh OTA."""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import mimetypes
import os
import sys
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


def aws_v4_request(
    *,
    method: str,
    host: str,
    path: str,
    access_key: str,
    secret_key: str,
    body: bytes | None = None,
    content_type: str | None = None,
) -> urllib.request.Request:
    payload = body or b""
    payload_hash = hashlib.sha256(payload).hexdigest()
    now = datetime.now(timezone.utc)
    amz_date = now.strftime("%Y%m%dT%H%M%SZ")
    date_stamp = now.strftime("%Y%m%d")
    headers = {
        "host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
    }
    if content_type:
        headers["content-type"] = content_type
    canonical_headers = "".join(f"{key}:{value}\n" for key, value in sorted(headers.items()))
    signed_headers = ";".join(sorted(headers.keys()))
    canonical_request = "\n".join(
        [method, path, "", canonical_headers, signed_headers, payload_hash]
    )
    credential_scope = f"{date_stamp}/auto/s3/aws4_request"
    string_to_sign = "\n".join(
        [
            "AWS4-HMAC-SHA256",
            amz_date,
            credential_scope,
            hashlib.sha256(canonical_request.encode()).hexdigest(),
        ]
    )
    k_date = sign(("AWS4" + secret_key).encode(), date_stamp)
    k_region = sign(k_date, "auto")
    k_service = sign(k_region, "s3")
    k_signing = sign(k_service, "aws4_request")
    signature = hmac.new(k_signing, string_to_sign.encode(), hashlib.sha256).hexdigest()
    authorization = (
        f"AWS4-HMAC-SHA256 Credential={access_key}/{credential_scope}, "
        f"SignedHeaders={signed_headers}, Signature={signature}"
    )
    req_headers = {
        "Host": host,
        "x-amz-content-sha256": payload_hash,
        "x-amz-date": amz_date,
        "Authorization": authorization,
    }
    if content_type:
        req_headers["Content-Type"] = content_type
    return urllib.request.Request(
        f"https://{host}{path}",
        data=payload if method in {"PUT", "POST"} else None,
        method=method,
        headers=req_headers,
    )


def put_object(account_id: str, bucket: str, key: str, body: bytes, access_key: str, secret_key: str) -> None:
    host = f"{account_id}.r2.cloudflarestorage.com"
    path = f"/{bucket}/{key}"
    content_type = mimetypes.guess_type(key)[0] or "application/octet-stream"
    request = aws_v4_request(
        method="PUT",
        host=host,
        path=path,
        access_key=access_key,
        secret_key=secret_key,
        body=body,
        content_type=content_type,
    )
    with urllib.request.urlopen(request, timeout=60):
        return


def main() -> int:
    parser = argparse.ArgumentParser(description="Publish Mesh OTA artifacts to R2")
    parser.add_argument("--installer", required=True, help="Path to signed .exe/.msi installer")
    parser.add_argument("--version", required=True, help="Release version, e.g. 0.1.1")
    parser.add_argument("--signature", required=True, help="Minisign signature for the installer")
    args = parser.parse_args()

    env = load_dotenv(ROOT / ".env")
    account_id = env.get("R2_ACCOUNT_ID", "").strip()
    access_key = env.get("R2_ACCESS_KEY_ID", "").strip()
    secret_key = env.get("R2_SECRET_ACCESS_KEY", "").strip()
    bucket = env.get("R2_BUCKET", "").strip()
    manifest_key = env.get("R2_MANIFEST_KEY", "latest.json").strip()
    public_base = env.get("R2_PUBLIC_BASE_URL", "").strip().rstrip("/")

    if not all([account_id, access_key, secret_key, bucket]):
        print("Missing R2 credentials in .env", file=sys.stderr)
        return 1

    installer_path = Path(args.installer)
    if not installer_path.is_file():
        print(f"Installer not found: {installer_path}", file=sys.stderr)
        return 1

    object_key = installer_path.name
    installer_bytes = installer_path.read_bytes()
    put_object(account_id, bucket, object_key, installer_bytes, access_key, secret_key)
    print(f"Uploaded s3://{bucket}/{object_key}")

    if not public_base:
        public_base = input("Enter R2 public base URL (e.g. https://pub-xxx.r2.dev): ").strip().rstrip("/")

    manifest = {
        "version": args.version,
        "notes": f"Mesh {args.version}",
        "pub_date": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "platforms": {
            "windows-x86_64": {
                "signature": args.signature,
                "url": f"{public_base}/{object_key}",
            }
        },
    }
    manifest_bytes = json.dumps(manifest, indent=2).encode("utf-8")
    put_object(account_id, bucket, manifest_key, manifest_bytes, access_key, secret_key)
    print(f"Uploaded s3://{bucket}/{manifest_key}")
    print(f"Public manifest URL: {public_base}/{manifest_key}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
