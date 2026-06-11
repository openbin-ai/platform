#!/usr/bin/env bash
#
# dev.sh — bring up the full local dev stack.
#
# Spring Boot's docker-compose integration auto-starts the compose.yaml
# services (postgres, keycloak, ghidra-worker, jadx-worker) when the JVM
# launches, so this script just needs to launch:
#
#   - core               (Spring Boot, port 8081)   — also pulls up compose
#   - openapk-frontend   (Vite, port 5173)
#   - openbin-frontend   (Vite, port 5174)
#
# Logs from all three are tailed interleaved. Ctrl+C kills the lot and runs
# `docker compose down` as a belt-and-suspenders cleanup in case Spring Boot
# died before its own shutdown hook fired.
#
# Usage:
#   ./dev.sh              # start everything, tail logs, Ctrl+C to stop
#   ./dev.sh --no-tail    # start in background, don't tail (use for CI/scripts)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")" && pwd)"
LOG_DIR="$REPO_ROOT/.dev-logs"
PID_DIR="$REPO_ROOT/.dev-pids"
CORE_DIR="$REPO_ROOT/core"
OPENAPK_FRONTEND_DIR="$REPO_ROOT/openapk-frontend"
OPENBIN_FRONTEND_DIR="$REPO_ROOT/openbin-frontend"

# Java 21 — checked into all the Linux distros we test on. Override JAVA_HOME
# before invoking the script if you're on macOS or a non-Debian setup.
JAVA_HOME_DEFAULT="/usr/lib/jvm/java-21-openjdk-amd64"

# Colors (bash escapes; respected by terminal, no-ops in piped output).
C_RED=$'\033[0;31m'
C_GREEN=$'\033[0;32m'
C_YELLOW=$'\033[0;33m'
C_BLUE=$'\033[0;34m'
C_DIM=$'\033[2m'
C_RESET=$'\033[0m'

NO_TAIL=0
for arg in "$@"; do
  case "$arg" in
    --no-tail) NO_TAIL=1 ;;
    -h|--help)
      sed -n '3,20p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "${C_RED}unknown flag: $arg${C_RESET}" >&2
      exit 2
      ;;
  esac
done

log_info()  { printf '%s[dev]%s %s\n' "$C_BLUE"   "$C_RESET" "$*"; }
log_warn()  { printf '%s[dev]%s %s\n' "$C_YELLOW" "$C_RESET" "$*"; }
log_error() { printf '%s[dev]%s %s\n' "$C_RED"    "$C_RESET" "$*" >&2; }
log_ok()    { printf '%s[dev]%s %s\n' "$C_GREEN"  "$C_RESET" "$*"; }

# ---- preflight ------------------------------------------------------------

preflight() {
  if [[ -z "${JAVA_HOME:-}" ]]; then
    if [[ -d "$JAVA_HOME_DEFAULT" ]]; then
      export JAVA_HOME="$JAVA_HOME_DEFAULT"
      log_info "JAVA_HOME unset — defaulting to $JAVA_HOME"
    else
      log_error "JAVA_HOME unset and $JAVA_HOME_DEFAULT not present. Install JDK 21 or export JAVA_HOME."
      exit 1
    fi
  fi
  export PATH="$JAVA_HOME/bin:$PATH"

  if [[ -z "${OPENAPK_KEK_B64:-}" ]]; then
    log_warn "OPENAPK_KEK_B64 unset — falling back to the dev default key from application.yml."
    log_warn "Generate your own with:  export OPENAPK_KEK_B64=\"\$(openssl rand -base64 32)\""
  fi

  # Cloud JADX is sunset in prod (worker-disabled defaults true), but dev
  # runs the jadx-worker container from compose.yaml — re-enable it here so
  # local APK uploads decompile. Override by exporting it yourself.
  export OPENAPK_JADX_DISABLED="${OPENAPK_JADX_DISABLED:-false}"

  if ! command -v docker >/dev/null 2>&1; then
    log_error "docker not on PATH. Install Docker Engine."
    exit 1
  fi
  if ! docker info >/dev/null 2>&1; then
    log_error "docker daemon not reachable. Start Docker and re-run."
    exit 1
  fi

  # Only check ports dev.sh launches directly. The compose stack's ports
  # (5432 postgres, 8080 keycloak, 8000 ghidra, 8001 jadx, 9000/9001 minio)
  # are intentionally held by openapk-* containers that Spring Boot's compose
  # integration reuses — flagging those was a false positive when the stack
  # was already up. If a non-openapk process is squatting one of those ports,
  # Spring Boot's compose start will fail with a clear "failed to bind host
  # port" error.
  declare -A port_hint=(
    [5173]="openapk-frontend vite — kill with: lsof -ti :5173 | xargs -r kill"
    [5174]="openbin-frontend vite — kill with: lsof -ti :5174 | xargs -r kill"
    [8081]="another core may be running — find: lsof -i :8081 -P"
  )
  local conflict=0
  for port in 5173 5174 8081; do
    if ss -tln 2>/dev/null | awk '{print $4}' | grep -qE "[:.]$port$"; then
      log_error "port $port is already in use — ${port_hint[$port]}"
      conflict=1
    fi
  done
  if [[ "$conflict" -eq 1 ]]; then
    log_error "fix the port conflicts above, then re-run."
    log_error "tip: 'docker compose -f core/compose.yaml down --remove-orphans' clears half-up dev containers."
    exit 1
  fi

  mkdir -p "$LOG_DIR" "$PID_DIR"
}

# ---- starters -------------------------------------------------------------

# Bring up the full compose stack BEFORE Spring Boot starts. We can't rely
# on Spring Boot's compose lifecycle integration alone because it's all-or-
# nothing: if it sees any service from compose.yaml already running (eg a
# pre-started MinIO from manual S3 setup), it logs "skipping startup" and
# never brings up the others, leaving Spring Boot to crash against a
# nonexistent Postgres. Explicit `up -d` here makes the lifecycle a no-op.
start_compose_stack() {
  log_info "bringing up docker compose stack…"
  (cd "$CORE_DIR" && docker compose up -d) >"$LOG_DIR/compose.log" 2>&1 || {
    log_error "docker compose up failed — see $LOG_DIR/compose.log"
    exit 1
  }
  log_info "waiting for postgres to be ready (pg_isready)…"
  local attempts=0
  until docker exec openapk-postgres pg_isready -U openapk -d openapk -q 2>/dev/null; do
    attempts=$((attempts + 1))
    if [[ "$attempts" -gt 60 ]]; then
      log_error "postgres failed to become ready in 60s — see: docker logs openapk-postgres"
      exit 1
    fi
    sleep 1
  done
  log_ok "compose stack ready"
}

# Spring Boot core. compose stack is already up by this point so Spring
# Boot's compose integration logs "skipping startup" cleanly.
start_core() {
  log_info "starting core (Spring Boot, port 8081)…"
  (
    cd "$CORE_DIR"
    exec ./mvnw -q spring-boot:run
  ) >"$LOG_DIR/core.log" 2>&1 &
  echo $! > "$PID_DIR/core.pid"
  log_ok "core started (pid $(cat "$PID_DIR/core.pid")) — logs: $LOG_DIR/core.log"
}

start_vite() {
  local name="$1"
  local dir="$2"
  local port="$3"

  if [[ ! -d "$dir/node_modules" ]]; then
    log_info "installing $name deps…"
    (cd "$dir" && npm install) >"$LOG_DIR/$name-install.log" 2>&1
  fi

  log_info "starting $name (Vite, port $port)…"
  (
    cd "$dir"
    exec npm run dev
  ) >"$LOG_DIR/$name.log" 2>&1 &
  echo $! > "$PID_DIR/$name.pid"
  log_ok "$name started (pid $(cat "$PID_DIR/$name.pid")) — logs: $LOG_DIR/$name.log"
}

# ---- cleanup --------------------------------------------------------------

# Killed: parent goes down, then we kill children. Spring Boot's compose
# integration is supposed to run `compose down` on JVM exit, but if Spring
# crashes early the integration never registers the hook — so we do a
# defensive `compose down` ourselves at the end. Only when we actually
# launched services (STARTED=1) — otherwise a preflight bailout would
# tear down compose services the user pre-started outside dev.sh.
STARTED=0
cleanup() {
  echo
  log_info "shutting down…"

  for pidfile in "$PID_DIR"/*.pid; do
    [[ -e "$pidfile" ]] || continue
    local pid name
    pid=$(cat "$pidfile")
    name=$(basename "$pidfile" .pid)
    if kill -0 "$pid" 2>/dev/null; then
      log_info "  killing $name (pid $pid)"
      # SIGTERM first, give it a moment, then SIGKILL the process group.
      kill "$pid" 2>/dev/null || true
      ( sleep 5 && kill -0 "$pid" 2>/dev/null && kill -9 "$pid" 2>/dev/null ) &
    fi
    rm -f "$pidfile"
  done

  if [[ "$STARTED" -eq 1 ]]; then
    log_info "  docker compose down"
    (cd "$CORE_DIR" && docker compose down --remove-orphans) >/dev/null 2>&1 || true
  else
    log_info "  (skipping docker compose down — script aborted before starting services)"
  fi

  log_ok "all stopped"
}
trap cleanup EXIT INT TERM

# ---- main -----------------------------------------------------------------

preflight

log_info "logs → $LOG_DIR"
log_info "pids → $PID_DIR"
echo

STARTED=1
start_compose_stack
start_core
start_vite openapk-frontend "$OPENAPK_FRONTEND_DIR" 5173
start_vite openbin-frontend "$OPENBIN_FRONTEND_DIR" 5174

echo
log_ok "stack is coming up. URLs once ready:"
printf '  %sopenapk-frontend%s   http://localhost:5173/\n'  "$C_GREEN" "$C_RESET"
printf '  %sopenbin-frontend%s   http://localhost:5174/\n'  "$C_GREEN" "$C_RESET"
printf '  %score (Spring)%s      http://localhost:8081/actuator/health\n' "$C_GREEN" "$C_RESET"
printf '  %skeycloak admin%s     http://localhost:8080/admin   (admin / admin)\n' "$C_GREEN" "$C_RESET"
printf '  %sjadx-worker%s        http://localhost:8001/health\n' "$C_GREEN" "$C_RESET"
printf '  %sghidra-worker%s      http://localhost:8000/health\n' "$C_GREEN" "$C_RESET"
printf '  %sminio S3 api%s       http://localhost:9000   (S3-compatible)\n' "$C_GREEN" "$C_RESET"
printf '  %sminio console%s      http://localhost:9001   (minioadmin / minioadmin)\n' "$C_GREEN" "$C_RESET"
echo
log_info "Ctrl+C to stop everything."
echo

if [[ "$NO_TAIL" -eq 1 ]]; then
  log_info "running in background — tail logs manually from $LOG_DIR/"
  # Block on child PIDs so the trap still fires on signals.
  wait
else
  # Tail all three logs interleaved with a per-file prefix.
  tail -n 0 -F \
    "$LOG_DIR/core.log" \
    "$LOG_DIR/openapk-frontend.log" \
    "$LOG_DIR/openbin-frontend.log"
fi
