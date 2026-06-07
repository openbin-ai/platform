# fixtures/

Two synthetic NPM tarballs used by `test/smoke.js` (and useful for manual
RIE testing once they're uploaded to S3).

| Fixture | Expected findings |
|---|---|
| `benign-pkg` | Zero findings. A lodash-using utility, no install hooks. |
| `malicious-pkg` | At least one of: `secret-theft`, `fs-traversal`, `known-c2`, `net-exfil`, `eval-surface`, `spawn`, `entropy-blob`, `install-hook`. Composed from defanged patterns seen in real NPM supply-chain incidents. |

## Building

```bash
./build.sh
```

Produces `benign-pkg-1.0.0.tgz` and `malicious-pkg-1.0.0.tgz` in this
directory. The tarballs are not committed — re-run `build.sh` after
checkout.

## Why synthetic and not real samples?

- Reproducibility — the fixtures live in source control as plain JS.
- Safety — `malicious-pkg/install.js` uses a non-routable webhook URL
  and never actually transmits the harvested data, so checking it out
  on a developer laptop is harmless.
- Coverage — synthetic inputs let us touch every rule deterministically.
