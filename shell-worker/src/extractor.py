"""Extract shell uploads into a working directory.

Same shape as pypi-worker/extractor.py, but the single-file path drops the
input under a fixed name based on the extension so the handler can route
to PowerShell or POSIX rules without re-sniffing.
"""

import gzip
import os
import shutil
import tarfile
import zipfile


MAX_EXTRACT_BYTES = 50 * 1024 * 1024
MAX_ENTRIES = 5000


def extract(input_path: str, dest_dir: str, original_name: str | None) -> dict:
    os.makedirs(dest_dir, exist_ok=True)
    with open(input_path, "rb") as f:
        magic = f.read(4)

    if magic[:2] == b"\x1f\x8b":
        return _extract_tar_gz(input_path, dest_dir)
    if magic[:2] == b"\x50\x4b":
        return _extract_zip(input_path, dest_dir)
    return _extract_single(input_path, dest_dir, original_name)


def _extract_tar_gz(input_path: str, dest_dir: str) -> dict:
    count = 0
    total = 0
    with gzip.open(input_path, "rb") as gz, tarfile.open(fileobj=gz, mode="r|") as tar:
        for member in tar:
            if count >= MAX_ENTRIES:
                raise RuntimeError(f"tar has more than {MAX_ENTRIES} entries")
            if member.size and member.size > MAX_EXTRACT_BYTES:
                raise RuntimeError(f"entry {member.name} exceeds {MAX_EXTRACT_BYTES}B")
            total += member.size or 0
            if total > MAX_EXTRACT_BYTES:
                raise RuntimeError("total extracted size exceeds cap")
            target = os.path.join(dest_dir, member.name)
            if not _is_inside(dest_dir, target):
                raise RuntimeError(f"path traversal: {member.name}")
            if member.isdir():
                os.makedirs(target, exist_ok=True)
            elif member.isreg():
                os.makedirs(os.path.dirname(target), exist_ok=True)
                fobj = tar.extractfile(member)
                if fobj is not None:
                    with open(target, "wb") as out:
                        shutil.copyfileobj(fobj, out)
            count += 1
    return {"entryCount": count, "format": "tar.gz"}


def _extract_zip(input_path: str, dest_dir: str) -> dict:
    count = 0
    total = 0
    with zipfile.ZipFile(input_path) as zf:
        for info in zf.infolist():
            if count >= MAX_ENTRIES:
                raise RuntimeError(f"zip has more than {MAX_ENTRIES} entries")
            total += info.file_size
            if total > MAX_EXTRACT_BYTES:
                raise RuntimeError("total extracted size exceeds cap")
            target = os.path.join(dest_dir, info.filename)
            if not _is_inside(dest_dir, target):
                raise RuntimeError(f"path traversal: {info.filename}")
            if info.is_dir():
                os.makedirs(target, exist_ok=True)
                continue
            os.makedirs(os.path.dirname(target), exist_ok=True)
            try:
                with zf.open(info) as src, open(target, "wb") as dst:
                    shutil.copyfileobj(src, dst)
            except RuntimeError as e:
                if "encrypted" in str(e).lower():
                    raise RuntimeError("Entry encrypted; unzip locally and reupload as folder")
                raise
            count += 1
    return {"entryCount": count, "format": "zip"}


def _extract_single(input_path: str, dest_dir: str, original_name: str | None) -> dict:
    # Preserve the original extension so the handler's per-file language
    # picker still routes correctly. Default to `.sh` when the upload had
    # no name (drag-and-drop without a Content-Disposition).
    ext = ".sh"
    if original_name:
        lower = original_name.lower()
        for cand in (".ps1", ".psm1", ".sh", ".bash", ".zsh", ".fish"):
            if lower.endswith(cand):
                ext = cand
                break
    target = os.path.join(dest_dir, f"script{ext}")
    shutil.copyfile(input_path, target)
    return {"entryCount": 1, "format": "single-file"}


def _is_inside(parent: str, child: str) -> bool:
    p = os.path.realpath(parent)
    c = os.path.realpath(child)
    try:
        return os.path.commonpath([p, c]) == p
    except ValueError:
        return False
