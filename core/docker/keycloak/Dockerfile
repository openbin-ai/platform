# syntax=docker/dockerfile:1.7
#
# OpenBin Keycloak — quay.io/keycloak/keycloak:26.6.2 + the `openbin`
# login theme + the realm export. Two-stage build:
#
#   1. builder — runs `kc.sh build` so the theme is picked up by Keycloak's
#      Quarkus augmentation phase (Keycloak 26 prefers built-time config
#      over runtime to keep startup tight on serverless platforms).
#   2. runtime — the production-mode Keycloak image with the prebuilt
#      augmentation directory and theme baked in.
#
# Runtime config still comes from env (KC_DB_URL, KC_HOSTNAME, etc.) —
# we never bake secrets in. Realm import is mounted at /opt/keycloak/data/import.

# Single-stage build. We deliberately skip `kc.sh build` + `--optimized`
# because the runtime task def carries env vars that don't perfectly match
# the build (`KC_HOSTNAME`, secret-injected DB URL, etc.). With --optimized
# any mismatch triggers a re-augmentation at startup that lands AFTER the
# ALB health check window expires, killing the task. Letting Keycloak
# augment at startup costs ~30s on cold-start but makes deploys robust to
# task-def edits without rebuilding the image.
FROM quay.io/keycloak/keycloak:26.6.2

# Theme directory: theme files MUST live under /opt/keycloak/themes/<name>/
# for kc.sh to register them at startup.
COPY themes/openbin /opt/keycloak/themes/openbin

# Realm export. --import-realm picks this up on first boot against an
# empty DB; on subsequent boots Keycloak detects the realm already exists
# and the import is a no-op.
COPY import/realm-openapk.json /opt/keycloak/data/import/realm-openapk.json

ENTRYPOINT ["/opt/keycloak/bin/kc.sh"]
CMD ["start", "--import-realm"]
