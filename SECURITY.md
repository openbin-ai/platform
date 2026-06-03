# Security Policy

## Reporting a vulnerability

**Do not open a public GitHub issue for security problems.**

Email **`husam@openbin.ai`** with:

- A description of the issue and the impact
- Reproduction steps, ideally with a minimal PoC
- The affected commit / version / hosted surface (`openapk.ai`,
  `app.openbin.ai`, or self-hosted)

We acknowledge receipt within 72 hours and aim to patch critical issues
within 7 days. We don't currently run a paid bug bounty, but we credit
researchers in release notes if requested.

## Scope

In scope:

- The hosted services `openapk.ai`, `app.openbin.ai`, `api.openapk.ai`,
  `auth.openapk.ai`.
- Code in this repository: `core/`, `jadx-worker/`, `ghidra-worker/`,
  `openapk-frontend/`, `openbin-frontend/`, `openbin-landing/`, `shared/`.

Out of scope:

- DoS attacks against the hosted services.
- Reports that boil down to "the user pasted their LLM key into a phishing
  page" — the model in our threat document is byok where the user holds
  the key.
- Social engineering of project maintainers.
- Findings that depend on a misconfigured self-hosted deployment (e.g.
  using the default dev KEK in production — that's documented as wrong).

## Cryptographic notes

- LLM provider keys are encrypted at rest with **AES-256-GCM**, fresh
  12-byte IV per record, 128-bit auth tag. The master KEK is
  environment-injected (`OPENAPK_KEK_B64`) and never touches the
  database, the filesystem, or logs.
- Decrypted plaintext keys live in method scope only and are never cached.
- In production we plan to migrate `LlmCredentialEncryptionService` to a
  KMS-backed implementation; until then, operators must safeguard the
  KEK as carefully as the database itself — **losing the KEK irrevocably
  loses every stored credential**.

## Responsible-disclosure timeline

| Day | What we do |
| --- | --- |
| 0 | You report. We confirm receipt within 72 h. |
| 1-7 | We triage, write a fix, prepare a patched release. |
| 7-14 | We ship the fix to the hosted services and tag a release. |
| 14+ | We post a public advisory (CVE if applicable) crediting you. |

Critical issues may compress this timeline. We'll coordinate with you.
