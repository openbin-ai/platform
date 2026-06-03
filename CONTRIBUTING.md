# Contributing to OpenAPK / OpenBin

Thanks for your interest. This monorepo holds two products that share a
backend:

| | OpenAPK | OpenBin |
| --- | --- | --- |
| Surface | Android RE — APK / DEX / smali / Java | Native RE — ELF / PE / Mach-O |
| Frontend | `openapk-frontend/` | `openbin-frontend/` |
| Worker | `jadx-worker/` | `ghidra-worker/` |
| Backend (shared) | `core/` | `core/` |
| Landing | `openapk-frontend/src/pages/Landing.tsx` | `openbin-landing/` |
| Shared code | `shared/` | `shared/` |

The whole runtime stack is **AGPL-3.0-or-later** licensed. Deployment
configs and ops scripts (anything `infra/`-ish) are intentionally **not**
in this repo — those live in a private operator repo.

## License & Contributor Agreement

By submitting a pull request you agree:

1. Your contribution is licensed under **AGPL-3.0-or-later** (the same
   license as the rest of the project; see [LICENSE](LICENSE)).
2. You grant the project maintainers permission to **relicense your
   contribution under a commercial license** for users who cannot accept
   AGPL terms (typically enterprises with copyleft-incompatible policies).
   This is what keeps the project sustainable; without it, accepting any
   external PR would lock the entire codebase into AGPL-only forever.

We use [**CLA Assistant**](https://cla-assistant.io) — when you open your
first PR, a bot will leave a one-click sign link. Sign once, you're good
for all future PRs. Until you sign, your PR won't be merged.

For trivial fixes (typos, comment clarifications, one-line bugfixes
clearly attributable to the existing codebase) maintainers may choose to
apply the change manually and credit you — no CLA needed in that case.

## Reporting bugs

- **Found a bug?** Open an issue with: what you ran, what happened, what
  you expected, and a minimal repro if possible. Stack traces help.
- **Security vulnerability?** See [SECURITY.md](SECURITY.md). Do **not**
  open a public issue.

## Feature requests

Open an issue describing the use case first. Big changes ("let's swap the
queue", "let's add a graph database") deserve a short discussion before
code. Small additions to existing flows ("the report editor needs an X
button") just need an issue + a PR.

We're an early-stage project with a small core team. Speed-to-launch is
the priority, so requests that delay launch will be deferred even if
they're good ideas.

## Dev setup

See [README.md](README.md) for the one-time-setup section. The TL;DR:

```bash
# generate a master encryption key
export OPENAPK_KEK_B64="$(openssl rand -base64 32)"

# terminal 1 - backend (boots Postgres + Keycloak + MinIO via compose)
cd core
export JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64
./mvnw spring-boot:run

# terminal 2 - one of the frontends
cd openapk-frontend   # or openbin-frontend
npm install
npm run dev
```

## Code style

- **Backend** (Spring Boot 4 / Java 21): no formal formatter; match
  surrounding style. Logger over `System.out`. Use the existing
  `ProjectStorage` / `MediaService` abstractions instead of touching the
  filesystem or S3 directly.
- **Frontend** (React 19 + Vite + Tailwind v4): match the existing
  pattern in the file you're editing. No new state libraries — `useState`
  + `useEffect` + `useMemo` are the whole vocabulary.
- **Tests**: backend integration tests use Testcontainers — see
  `core/src/test/`. Don't mock the database.

## Pull request checklist

- [ ] Branch is rebased on `master`.
- [ ] Backend changes: `./mvnw test` passes.
- [ ] Frontend changes: `npm run build` passes for the affected app.
- [ ] If you added or removed an env var, the README is updated.
- [ ] CLA signed (the bot will check).

## Where to find people

- Issues + Discussions on this repo.
- Security disclosures: `husam@openbin.ai`.
