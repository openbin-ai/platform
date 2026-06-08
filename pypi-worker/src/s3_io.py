"""S3 helpers — thin wrappers around boto3 so handler.py stays readable.

Mirrors script-worker/src/s3-io.js: one client per Lambda container,
reused across invocations to avoid the cold-start handshake on every
warm invoke.
"""

import json
import boto3

_s3 = boto3.client("s3")


def download_to_file(bucket: str, key: str, dest_path: str) -> None:
    _s3.download_file(bucket, key, dest_path)


def upload_file(bucket: str, key: str, src_path: str, content_type: str) -> None:
    with open(src_path, "rb") as f:
        _s3.put_object(Bucket=bucket, Key=key, Body=f, ContentType=content_type)


def upload_json(bucket: str, key: str, obj) -> None:
    body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    _s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json")
