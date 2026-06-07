#!/usr/bin/env bash
# Build the fixture tarballs for the smoke test. Re-runnable, idempotent.
#
# Output:
#   fixtures/benign-pkg-1.0.0.tgz
#   fixtures/malicious-pkg-1.0.0.tgz
#
# Each is a real npm-style tarball (single `package/` root after extract).
set -euo pipefail
cd "$(dirname "$0")"

for src in benign-pkg malicious-pkg; do
  out="${src}-1.0.0.tgz"
  echo "[fixtures] building $out"
  rm -f "$out"
  # NPM convention: wrap source in a single `package/` directory inside the
  # tarball. The worker's tar-extract uses strip=1 so it's identical to a
  # real `npm pack` output.
  tar -czf "$out" --transform "s|^$src|package|" "$src"
done

echo "[fixtures] done."
ls -la *.tgz
