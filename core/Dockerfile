# syntax=docker/dockerfile:1.7
#
# OpenAPK core — Spring Boot 4 / Java 21 backend.
#
# Two-stage build:
#   1. builder — Temurin 21 JDK + the project's Maven wrapper. We prime the
#      dependency cache with pom.xml alone so changing a .java file doesn't
#      re-download Spring AI / AWS SDK every iteration.
#   2. runtime — Temurin 21 JRE. We extract Spring Boot's layered-jar so the
#      large dependency layer is cached independently of the small application
#      layer; bumping app code without bumping deps is a tiny image diff.
#
# Runtime contract (all overridable at `docker run` / ECS task-def time):
#   - server.port = 8081
#   - workspace dir = /var/openapk/workspace (writable as user `openapk`)
#   - JADX + Ghidra worker URLs come from OPENAPK_*_WORKER_URL env
#   - S3 backend, KEK, DB, JWT issuer, SES — all env-injected in prod
#   - spring.docker.compose disabled (no Docker socket in ECS tasks)
#

# ─── stage 1: build ────────────────────────────────────────────────────────
FROM eclipse-temurin:21-jdk-jammy AS builder
WORKDIR /build

# Maven wrapper + pom first — this layer is cached as long as deps don't change.
COPY .mvn .mvn
COPY mvnw pom.xml ./
RUN chmod +x mvnw \
 && ./mvnw -B -q dependency:go-offline

# Now copy sources and build the boot jar. Skip tests in the image build;
# tests run in CI before we ever tag an image.
COPY src ./src
RUN ./mvnw -B -q package -DskipTests \
 && cd target \
 && JAR=$(ls *.jar | grep -v '\-original\.jar$' | head -1) \
 && java -Djarmode=tools -jar "$JAR" extract --layers --launcher \
 && mv "${JAR%.jar}" extracted

# ─── stage 2: runtime ──────────────────────────────────────────────────────
FROM eclipse-temurin:21-jre-jammy

# tar + gzip: S3ProjectStorage shells out to tar for pack/unpack of src.tar.gz
# curl: HEALTHCHECK + handy for in-container debugging from `aws ecs execute-command`
# tini: PID 1 init so SIGTERM from ECS reaches the JVM cleanly (Spring's
#       shutdown hook runs Flyway/HikariCP teardown — without tini the kernel
#       sends SIGKILL after 30s instead).
RUN apt-get update \
 && apt-get install -y --no-install-recommends tar gzip curl tini ca-certificates \
 && rm -rf /var/lib/apt/lists/*

# Non-root user with a fixed high UID — avoids collisions with host UIDs when
# the workspace dir is bind-mounted in dev, and is the only user with write
# access to /var/openapk/workspace.
RUN groupadd --system --gid 10001 openapk \
 && useradd  --system --uid 10001 --gid 10001 --home /home/openapk --shell /usr/sbin/nologin --create-home openapk \
 && mkdir -p /var/openapk/workspace \
 && chown -R openapk:openapk /var/openapk

WORKDIR /app

# Copy the four extracted layers in cache-friendly order (most-stable first).
# Build re-runs after a code-only change only re-copy the small `application/` layer.
COPY --from=builder --chown=openapk:openapk /build/target/extracted/dependencies/          ./
COPY --from=builder --chown=openapk:openapk /build/target/extracted/spring-boot-loader/    ./
COPY --from=builder --chown=openapk:openapk /build/target/extracted/snapshot-dependencies/ ./
COPY --from=builder --chown=openapk:openapk /build/target/extracted/application/           ./

USER openapk

EXPOSE 8081

# JVM tuning:
#   MaxRAMPercentage=75 — let the JVM use 75% of the container's memory limit.
#     Spring Boot 4 + Spring AI + AWS SDK comfortably needs ~1 GiB resident;
#     ECS task memory of 2 GiB leaves headroom for tar subprocesses + Tomcat
#     buffers (200 MiB upload threshold).
#   G1GC — default on JDK 21, but pinned here so a future JDK bump doesn't
#     silently switch to ZGC and change the latency profile.
#   egd=/dev/./urandom — old Spring Security workaround; cheap to keep, costs
#     nothing on Linux 5.x.
ENV JAVA_OPTS="-XX:MaxRAMPercentage=75.0 -XX:+UseG1GC -Djava.security.egd=file:/dev/./urandom"
ENV OPENAPK_WORKSPACE_DIR=/var/openapk/workspace
ENV SPRING_DOCKER_COMPOSE_ENABLED=false

# Liveness probe — ECS will also hit /actuator/health on the target group;
# this directive is for `docker run` and as a belt-and-suspenders for ECS.
HEALTHCHECK --interval=30s --timeout=5s --start-period=60s --retries=3 \
  CMD curl -fsS http://localhost:8081/actuator/health/liveness | grep -q '"UP"' || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["sh", "-c", "exec java $JAVA_OPTS org.springframework.boot.loader.launch.JarLauncher"]
