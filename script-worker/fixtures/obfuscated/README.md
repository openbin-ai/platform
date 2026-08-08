# Deobfuscation engine fixtures (`obfuscated/`)

Inputs for `test/engines.test.js`. These are **real** obfuscator output, not
hand-written lookalikes — the engines match on exact wrapper shapes, so an
approximation would pass tests that production traffic fails.

| File | What it is |
|---|---|
| `plain.js` | The unobfuscated source everything else is generated from. Credential theft + HTTPS exfil. |
| `string-array.js` | `plain.js` run through [javascript-obfuscator] with `stringArray` + `stringArrayThreshold: 1`. |
| `caesar-dropper.js` | Synthetic Caesar-shift-over-`fromCharCode` dropper — the dominant NPM supply-chain shape (Shai-Hulud, lottiefiles, the Red Hat campaign). Generated, not captured, so no live malware sits in the repo. |

Regenerate the obfuscator.io sample with:

```sh
npx javascript-obfuscator plain.js --output string-array.js \
  --compact true --string-array true --string-array-threshold 1
```

Note `caesar-dropper.js` needs **more than 100** char codes in its numeric
array: the detector in `src/deobfuscator.js` ignores shorter arrays to avoid
false-positives on ordinary constant tables.

[javascript-obfuscator]: https://github.com/javascript-obfuscator/javascript-obfuscator
