# OpenAPK / OpenBin

The collaborative platform for security research. Two products, one
backend, one open-source repo:

- **OpenAPK** ([openapk.ai](https://openapk.ai)) — Android RE: APK upload,
  JADX decompile, source navigation, agentic Q&A, MAR / VRR reports.
- **OpenBin** ([openbin.ai](https://openbin.ai) /
  [app.openbin.ai](https://app.openbin.ai)) — Native RE: ELF / PE / Mach-O
  via Ghidra, same agentic stack, same report flow.

Bring-your-own LLM key (Anthropic, OpenAI, AWS Bedrock). Self-hostable.
Source-available under AGPL-3.0 — see [License](#license) below.

## Status

**Slice 1 — Auth + BYOK key vault** is implemented.

Slices still to come: APK upload + JADX decompile → static pre-scan + AI hotspot guidance → AI-assisted file work → MAR report builder + screenshot/annotate → IoC extraction + crypto auto-recreate.

## Architecture

```
openapk-frontend  (Vite + React 19 + Tailwind 4 + react-oidc-context)
        │  Bearer JWT
        ▼
core              (Spring Boot 4 + Spring Security OAuth2 Resource Server)
        │  JDBC
        ▼
Postgres 16       (app data: users, encrypted credentials)

Keycloak 26       (OIDC issuer; realm imported on first start)
```

Ports: Postgres `5432`, Keycloak `8080`, Spring Boot `8081`, Vite `5173`.

## One-time setup

1. **Install JDK 21** (OpenJDK is fine).
2. **Generate a 32-byte master encryption key** for at-rest credential storage:
   ```bash
   export OPENAPK_KEK_B64="$(openssl rand -base64 32)"
   ```
   Add this to your shell profile so it persists. **If you lose this key, you lose access to every stored credential.**
3. **Stop any standalone Keycloak you have running** (port 8080 must be free for compose).

## Run

The Spring Boot app auto-starts the `compose.yaml` stack (Postgres + Keycloak) on launch.

```bash
# Terminal 1 — backend
cd core
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
export OPENAPK_KEK_B64="..."   # 32 bytes base64
./mvnw spring-boot:run

# Terminal 2 — frontend
cd openapk-frontend
npm install
npm run dev
```

Open <http://localhost:5173/>.

On first load the app redirects you to Keycloak. Self-registration is enabled in the dev realm — click "Register", create an account, and you'll land back on the dashboard. Then open **API Keys**, add a credential, and click **Test** to verify the round-trip to your provider.

Keycloak admin console: <http://localhost:8080/admin> (admin / admin — dev only).

## What's where

- `core/compose.yaml` — Postgres + Keycloak (with realm import volume mount)
- `core/docker/keycloak/import/realm-openapk.json` — checked-in realm export with the `openapk-frontend` public PKCE client
- `core/src/main/resources/application.yml` — Spring Boot config (port 8081, JWT issuer URI, KEK env binding)
- `core/src/main/resources/db/migration/V1__init.sql` — `users` + `llm_credentials` tables
- `core/src/main/java/ai/openapk/core/auth/` — `User` entity, JIT provisioning service
- `core/src/main/java/ai/openapk/core/credentials/` — encryption service, payload codec, REST controller, per-provider test runner
- `openapk-frontend/src/auth/` — OIDC config + `RequireAuth` guard
- `openapk-frontend/src/api/client.ts` — `useApi()` hook that injects the Bearer token
- `openapk-frontend/src/pages/ApiKeys.tsx` — add/test/delete UI

## Storage backend

Project bytes (uploaded APKs, JADX decompile output, report media) live in
one of two places:

| backend | source of truth | survives task recycle? | use case |
|---------|-----------------|------------------------|----------|
| `fs`    | local workspace dir | only if the host is preserved | local dev — default |
| `s3`    | S3 bucket; workspace dir is a per-task LRU cache | yes | prod / ECS |

Switch backends with `OPENAPK_STORAGE_BACKEND=s3` plus the bucket config
below. The same `ProjectStorage` interface is used either way — the 20+
services that walk source trees are unchanged.

### Prod env vars (only when `backend=s3`)

| var | required | meaning |
|---|---|---|
| `OPENAPK_STORAGE_BACKEND` | yes (`s3`) | switches to S3 |
| `OPENAPK_S3_BUCKET` | yes | bucket name; must exist before boot |
| `OPENAPK_S3_REGION` | default `us-east-1` | bucket region |
| `OPENAPK_S3_PREFIX` | optional | key prefix to share one bucket across envs |
| `OPENAPK_S3_ENDPOINT` | optional | override for MinIO etc.; leave blank for real AWS |
| `OPENAPK_STORAGE_CACHE_MIN_FREE_PCT` | default `20` | local cache eviction threshold |
| `OPENAPK_PRESIGNED_TTL` | default `PT15M` | TTL for media presigned URLs |

Credentials come from the default AWS chain (`AWS_ACCESS_KEY_ID` +
`AWS_SECRET_ACCESS_KEY` env, or the ECS task role in prod). No app-level
secret wiring.

### Local prod-parity testing with MinIO

`core/compose.yaml` ships a MinIO service alongside Postgres + Keycloak so
you can exercise the S3 code path locally. One-time bucket creation (the
`until` loop is so we don't race MinIO's 2-3s startup):

```bash
docker compose -f core/compose.yaml up -d minio
until docker exec openapk-minio mc alias set local http://localhost:9000 minioadmin minioadmin 2>/dev/null; do
  sleep 1
done
docker exec openapk-minio mc mb local/openapk-dev
```

Then run with the S3 backend wired up:

```bash
export OPENAPK_STORAGE_BACKEND=s3
export OPENAPK_S3_BUCKET=openapk-dev
export OPENAPK_S3_ENDPOINT=http://localhost:9000
export OPENAPK_S3_REGION=us-east-1
export AWS_ACCESS_KEY_ID=minioadmin
export AWS_SECRET_ACCESS_KEY=minioadmin
./dev.sh
```

MinIO console: <http://localhost:9001/> (minioadmin / minioadmin).

## Credential encryption notes

- AES-256-GCM, fresh 12-byte IV per record, 128-bit auth tag.
- Master KEK lives in `OPENAPK_KEK_B64` only — never in DB, never on disk, never logged.
- Decrypted plaintext keys never leave method scope and are not cached.
- Future work: swap `LlmCredentialEncryptionService` for a KMS-backed implementation in production.

## Bedrock test path

Saving a Bedrock credential works in slice 1. The **Test** button reports "skipped (slice 1.5)" — Bedrock requires SigV4 signing via the AWS SDK, which lands when we wire actual analysis in slice 3.

## License

OpenAPK and OpenBin are licensed under the **GNU Affero General Public
License v3.0 or later** (AGPL-3.0-or-later). See [LICENSE](LICENSE) for
the full text.

### What that means in practice

- **You can run, modify, and self-host** this code freely. No license fee.
- **You can publish your modifications** — but if you do, they must be
  under AGPL-3.0-or-later too (copyleft).
- **If you run a modified version as a public service**, AGPL §13
  requires you to make the source of your modifications available to your
  users. This is the clause that distinguishes AGPL from GPL and is the
  whole point: a hosted fork must contribute back.
- **Commercial / non-AGPL licensing is available** for organisations
  whose internal policies don't allow copyleft. Email
  [husam@openbin.ai](mailto:husam@openbin.ai).

### What's in this repo vs not

- **In**: the entire runtime — `core/`, `jadx-worker/`, `ghidra-worker/`,
  `openapk-frontend/`, `openbin-frontend/`, `openbin-landing/`, `shared/`,
  the dev compose stack, the migration scripts. Everything you need to
  stand up your own instance.
- **Not in**: operator-specific deployment configs (`infra/`), task-def
  overlays, Aurora endpoints, secret ARNs, ECR push scripts with embedded
  account IDs. Those are not the product — they're an operations concern
  for the hosted instance and intentionally live in a separate private
  repo.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). TL;DR:

- We use a Contributor License Agreement (CLA) via
  [CLA Assistant](https://cla-assistant.io). One click on your first PR.
- The CLA allows us to dual-license your contribution for enterprise
  customers — without it, accepting any external PR would lock the
  project into AGPL-only forever.
- Security issues: don't open a public issue. See [SECURITY.md](SECURITY.md).

## Trademarks

"OpenAPK" and "OpenBin" are trademarks of the project authors. The code
is AGPL — the names are not. Forks are welcome under a different name.

