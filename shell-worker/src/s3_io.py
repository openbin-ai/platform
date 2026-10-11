"""S3 helpers — copy of pypi-worker/src/s3_io.py. Kept duplicated rather
than factored into a shared layer because (a) Lambda layers add a deploy
hop and (b) the file is 20 LOC and changes monthly at most."""

import json
import os

import boto3
from botocore.config import Config

# Self-hosted installs point the worker at MinIO through AWS_ENDPOINT_URL.
# Path-style addressing is required there: bucket subdomains do not resolve
# inside a Docker network. Unset means real S3 with the SDK defaults.
_ENDPOINT = os.environ.get("AWS_ENDPOINT_URL") or None
_s3 = (
    boto3.client("s3", endpoint_url=_ENDPOINT, config=Config(s3={"addressing_style": "path"}))
    if _ENDPOINT
    else boto3.client("s3")
)


def download_to_file(bucket: str, key: str, dest_path: str) -> None:
    _s3.download_file(bucket, key, dest_path)


def upload_file(bucket: str, key: str, src_path: str, content_type: str) -> None:
    with open(src_path, "rb") as f:
        _s3.put_object(Bucket=bucket, Key=key, Body=f, ContentType=content_type)


def upload_json(bucket: str, key: str, obj) -> None:
    body = json.dumps(obj, separators=(",", ":")).encode("utf-8")
    _s3.put_object(Bucket=bucket, Key=key, Body=body, ContentType="application/json")
