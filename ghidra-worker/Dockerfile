# syntax=docker/dockerfile:1.7

# ---------- Stage 1: download + unpack Ghidra ----------
FROM eclipse-temurin:21-jdk-jammy AS ghidra-fetch

ARG GHIDRA_VERSION=11.2.1
ARG GHIDRA_BUILD=20241105
# Optional: pin to a known-good sha256 of the release zip for reproducible builds.
# Look it up at https://github.com/NationalSecurityAgency/ghidra/releases and set
# --build-arg GHIDRA_SHA256=<hex>. Defaults to empty (no verification).
ARG GHIDRA_SHA256=

RUN apt-get update \
 && apt-get install -y --no-install-recommends curl unzip ca-certificates \
 && rm -rf /var/lib/apt/lists/* \
 && curl -fsSL -o /tmp/ghidra.zip \
        "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_${GHIDRA_VERSION}_build/ghidra_${GHIDRA_VERSION}_PUBLIC_${GHIDRA_BUILD}.zip" \
 && if [ -n "${GHIDRA_SHA256}" ]; then \
        echo "${GHIDRA_SHA256}  /tmp/ghidra.zip" | sha256sum -c - ; \
    fi \
 && unzip -q /tmp/ghidra.zip -d /opt \
 && mv "/opt/ghidra_${GHIDRA_VERSION}_PUBLIC" /opt/ghidra \
 && rm /tmp/ghidra.zip

# ---------- Stage 2: runtime ----------
FROM eclipse-temurin:21-jdk-jammy

# Python + multipart-friendly libs. file is handy for sniffing uploads in logs.
RUN apt-get update \
 && apt-get install -y --no-install-recommends \
        python3 python3-pip python3-venv \
        file libxrender1 libxtst6 libxi6 \
 && rm -rf /var/lib/apt/lists/*

ENV GHIDRA_HOME=/opt/ghidra \
    PATH=/opt/ghidra/support:/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1

COPY --from=ghidra-fetch /opt/ghidra /opt/ghidra

# Install Python deps into a venv so they don't fight system packages.
RUN python3 -m venv /opt/venv
COPY requirements.txt /app/requirements.txt
RUN /opt/venv/bin/pip install --no-cache-dir -r /app/requirements.txt

WORKDIR /app
COPY app/ /app/app/
COPY scripts/ /app/scripts/

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD python3 -c "import urllib.request, sys; sys.exit(0 if urllib.request.urlopen('http://localhost:8000/health', timeout=3).status == 200 else 1)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
