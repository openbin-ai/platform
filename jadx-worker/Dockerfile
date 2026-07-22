# syntax=docker/dockerfile:1.7

# ---------- Stage 1: download + unpack JADX ----------
# Pinned to the same version core/pom.xml uses today so the CLI output matches
# the library output byte-for-byte during the cutover. Bump in lockstep with
# the core pom and re-test before changing.
FROM eclipse-temurin:21-jdk-jammy AS jadx-fetch

ARG JADX_VERSION=1.5.5
# Optional: pin to a known-good sha256 of the release zip for reproducible
# builds. Look it up at https://github.com/skylot/jadx/releases and set
# --build-arg JADX_SHA256=<hex>. Defaults to empty (no verification).
ARG JADX_SHA256=

# Acquire::Retries hardens apt against flaky GitHub-runner ↔ Ubuntu-mirror
# connections — a single dropped download otherwise kills the build. curl
# retries the jadx zip download the same way.
RUN apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL --retry 5 --retry-all-errors -o /tmp/jadx.zip \
        "https://github.com/skylot/jadx/releases/download/v${JADX_VERSION}/jadx-${JADX_VERSION}.zip" \
 && if [ -n "${JADX_SHA256}" ]; then \
        echo "${JADX_SHA256}  /tmp/jadx.zip" | sha256sum -c - ; \
    fi \
 && mkdir -p /opt/jadx \
 && unzip -q /tmp/jadx.zip -d /opt/jadx \
 && chmod +x /opt/jadx/bin/jadx /opt/jadx/bin/jadx-gui \
 && rm /tmp/jadx.zip

# ---------- Stage 2: runtime ----------
# JRE is enough at runtime (no compilation), and shaves ~150MB off the image.
FROM eclipse-temurin:21-jre-jammy

# Python for the FastAPI wrapper, plus the few host utilities we actually use:
#   - tar / gzip: stream the decompiled tree back to core
#   - prlimit (util-linux): per-request memory + CPU ceilings on the JADX
#     subprocess so a malicious APK can't OOM the worker container
#   - file: handy for sniffing uploads in logs
RUN apt-get -o Acquire::Retries=5 update \
 && apt-get -o Acquire::Retries=5 install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        tar gzip util-linux file \
 && rm -rf /var/lib/apt/lists/*

ENV JADX_HOME=/opt/jadx \
    PATH=/opt/jadx/bin:/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

COPY --from=jadx-fetch /opt/jadx /opt/jadx

# Install Python deps into a venv so they don't fight system packages.
RUN python3 -m venv /opt/venv
COPY requirements.txt /app/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY app/ /app/app/

# Non-root user. The JADX subprocess runs as this user too — combined with
# the prlimit caps inside main.py, that's our containment story for a hostile
# APK. Container is the trust boundary.
RUN useradd --system --uid 10001 --home /app --shell /usr/sbin/nologin jadx \
 && chown -R jadx:jadx /app /opt/jadx
USER jadx

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
