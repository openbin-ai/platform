// Format-aware extractor. The Spring controller doesn't gatekeep on
// filename — anything the analyst drops gets streamed up. We sniff the
// first few magic bytes and dispatch:
//
//   1f 8b ..        → gzip (assume tar.gz, NPM tarball)
//   50 4b 03 04     → zip (Datadog extract, GitHub download, manual zip)
//   anything else   → treat as a single JS file
//
// All paths land at the same shape: a `package/`-style root in destDir,
// optionally containing a package.json. Path-traversal guard refuses any
// entry whose normalized path escapes destDir.

const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const tar = require('tar');
const StreamZip = require('node-stream-zip');

async function extract(inputPath, destDir) {
  await fsp.mkdir(destDir, { recursive: true });
  const fmt = await sniffFormat(inputPath);

  if (fmt === 'tar.gz') {
    return { format: fmt, ...(await extractTarGz(inputPath, destDir)) };
  }
  if (fmt === 'zip') {
    return { format: fmt, ...(await extractZip(inputPath, destDir)) };
  }
  return { format: 'single-js', ...(await stageSingleJs(inputPath, destDir)) };
}

async function sniffFormat(filePath) {
  const fh = await fsp.open(filePath, 'r');
  try {
    const buf = Buffer.alloc(4);
    await fh.read(buf, 0, 4, 0);
    if (buf[0] === 0x1f && buf[1] === 0x8b) return 'tar.gz';
    if (buf[0] === 0x50 && buf[1] === 0x4b && buf[2] === 0x03 && buf[3] === 0x04) return 'zip';
    return 'single-js';
  } finally {
    await fh.close();
  }
}

async function extractTarGz(inputPath, destDir) {
  const entries = [];
  await tar.x({
    file: inputPath,
    cwd: destDir,
    strip: 1,
    filter: (entryPath) => isInside(destDir, entryPath) && entries.push(entryPath) > 0,
  });
  return { entryCount: entries.length };
}

async function extractZip(inputPath, destDir) {
  const zip = new StreamZip.async({ file: inputPath });
  let entryCount = 0;
  try {
    // Inspect entries first to compute the common leading prefix. Both
    // Datadog and GitHub wrap content under a single root dir; npm pack
    // uses `package/`. We strip whatever it is so the rest of the pipeline
    // sees a stable layout.
    const entries = await zip.entries();
    const names = Object.keys(entries);
    const commonRoot = computeCommonRoot(names);
    for (const [name, entry] of Object.entries(entries)) {
      if (entry.isDirectory) continue;
      const rel = commonRoot ? name.slice(commonRoot.length) : name;
      if (!rel) continue;
      if (!isInside(destDir, rel)) continue;
      const out = path.join(destDir, rel);
      await fsp.mkdir(path.dirname(out), { recursive: true });
      await zip.extract(name, out);
      entryCount++;
    }
  } finally {
    await zip.close();
  }
  return { entryCount };
}

// Single .js file path: write it to lib/index.js under a synthetic package
// root so the analyzer's directory walk + finding paths still make sense.
// No package.json means the install-hook rule won't fire — that's correct.
async function stageSingleJs(inputPath, destDir) {
  const libDir = path.join(destDir, 'lib');
  await fsp.mkdir(libDir, { recursive: true });
  await fsp.copyFile(inputPath, path.join(libDir, 'index.js'));
  return { entryCount: 1 };
}

function isInside(destDir, entryPath) {
  const resolved = path.resolve(destDir, entryPath);
  const root = path.resolve(destDir);
  return resolved === root || resolved.startsWith(root + path.sep);
}

// Compute the common leading directory of all entries, e.g. "package/"
// for an npm pack zip, or "@scope-pkg-1.0.0/" for a Datadog sample. Returns
// "" when entries don't share a single root.
function computeCommonRoot(names) {
  if (names.length === 0) return '';
  const firstSlash = names[0].indexOf('/');
  if (firstSlash < 0) return '';
  const candidate = names[0].slice(0, firstSlash + 1);
  for (const n of names) {
    if (!n.startsWith(candidate)) return '';
  }
  return candidate;
}

module.exports = { extract, sniffFormat };
