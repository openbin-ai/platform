"""Extract PyPI uploads into a working directory.

Three accepted shapes, dispatched by magic bytes (the Spring layer doesn't
trust file extensions either — same convention as script-worker/extract.js):

1. **sdist tarball** (`.tar.gz`, magic `1f 8b`) — standard PyPI source
   distribution. Top-level dir is usually `pkg-1.2.3/`.
2. **wheel** (`.whl` = zip, magic `50 4b`) — installed-as-is binary
   distribution. Holds `pkg-1.2.3.dist-info/METADATA` + the package tree.
3. **single .py** file — loose script analysis. Wrapped into a synthetic
   `lib/index.py` so the rest of the pipeline doesn't special-case it.

Path-traversal guard refuses any entry whose canonical path escapes the
extraction root.
"""

import gzip
import os
import shutil
import tarfile
import zipfile


MAX_EXTRACT_BYTES = 200 * 1024 * 1024
MAX_ENTRIES = 5000


def extract(input_path: str, dest_dir: str) -> dict:
    os.makedirs(dest_dir, exist_ok=True)
    with open(input_path, "rb") as f:
        magic = f.read(4)

    if magic[:2] == b"\x1f\x8b":
        return _extract_tar_gz(input_path, dest_dir)
    if magic[:2] == b"\x50\x4b":
        return _extract_zip(input_path, dest_dir)
    return _extract_single_py(input_path, dest_dir)


def _extract_tar_gz(input_path: str, dest_dir: str) -> dict:
    entry_count = 0
    extracted_bytes = 0
    with gzip.open(input_path, "rb") as gz:
        with tarfile.open(fileobj=gz, mode="r|") as tar:
            for member in tar:
                if entry_count >= MAX_ENTRIES:
                    raise RuntimeError(f"tarball has more than {MAX_ENTRIES} entries")
                if member.size and member.size > MAX_EXTRACT_BYTES:
                    raise RuntimeError(f"entry {member.name} exceeds {MAX_EXTRACT_BYTES}B")
                extracted_bytes += member.size or 0
                if extracted_bytes > MAX_EXTRACT_BYTES:
                    raise RuntimeError(f"total extracted size exceeds {MAX_EXTRACT_BYTES}B")
                # Path traversal guard — refuse anything that resolves outside dest_dir.
                target = os.path.join(dest_dir, member.name)
                if not _is_inside(dest_dir, target):
                    raise RuntimeError(f"path traversal attempt: {member.name}")
                if member.isdir():
                    os.makedirs(target, exist_ok=True)
                elif member.isreg():
                    os.makedirs(os.path.dirname(target), exist_ok=True)
                    fobj = tar.extractfile(member)
                    if fobj is not None:
                        with open(target, "wb") as out:
                            shutil.copyfileobj(fobj, out)
                entry_count += 1
    return {"entryCount": entry_count, "format": "tar.gz"}


def _extract_zip(input_path: str, dest_dir: str) -> dict:
    entry_count = 0
    extracted_bytes = 0
    with zipfile.ZipFile(input_path) as zf:
        for info in zf.infolist():
            if entry_count >= MAX_ENTRIES:
                raise RuntimeError(f"zip has more than {MAX_ENTRIES} entries")
            extracted_bytes += info.file_size
            if extracted_bytes > MAX_EXTRACT_BYTES:
                raise RuntimeError(f"total extracted size exceeds {MAX_EXTRACT_BYTES}B")
            target = os.path.join(dest_dir, info.filename)
            if not _is_inside(dest_dir, target):
                raise RuntimeError(f"path traversal attempt: {info.filename}")
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                with zf.open(info) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            except RuntimeError as e:
                # zipfile raises RuntimeError for encrypted entries — surface
                # it with a message Spring can map to a friendlier 400.
                if "encrypted" in str(e).lower():
                    raise RuntimeError("Entry encrypted; unzip locally and reupload as folder")
                raise
            entry_count += 1
    return {"entryCount": entry_count, "format": "zip"}


def _extract_single_py(input_path: str, dest_dir: str) -> dict:
    lib_dir = os.path.join(dest_dir, "lib")
    os.makedirs(lib_dir, exist_ok=True)
    shutil.copyfile(input_path, os.path.join(lib_dir, "index.py"))
    return {"entryCount": 1, "format": "single-py"}


def _is_inside(parent: str, child: str) -> bool:
    parent_abs = os.path.realpath(parent)
    child_abs = os.path.realpath(child)
    try:
        return os.path.commonpath([parent_abs, child_abs]) == parent_abs
    except ValueError:
        return False
