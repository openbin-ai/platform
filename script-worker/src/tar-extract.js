// Extract a .tgz to a target dir with a path-traversal guard. NPM tarballs
// conventionally wrap everything under a single `package/` dir, but we
// don't rely on that — we strip whatever leading component the tarball
// uses and refuse any entry whose normalized path escapes the dest root.

const tar = require('tar');
const path = require('node:path');
const fs = require('node:fs/promises');

async function extract(tarballPath, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const seenEntries = [];
  await tar.x({
    file: tarballPath,
    cwd: destDir,
    strip: 1,
    filter: (entryPath) => {
      // Refuse anything whose joined path resolves outside destDir.
      const resolved = path.resolve(destDir, entryPath);
      if (!resolved.startsWith(path.resolve(destDir) + path.sep) &&
          resolved !== path.resolve(destDir)) {
        return false;
      }
      seenEntries.push(entryPath);
      return true;
    },
  });
  return { entryCount: seenEntries.length };
}

module.exports = { extract };
