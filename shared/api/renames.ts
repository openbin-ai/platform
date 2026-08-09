// Client-side rename application.
//
// BIN and APK get renames substituted server-side on read. SCRIPT source
// goes straight from the S3 bundle to the browser and never passes through
// ProjectService.readFile, so the substitution has to happen here.
//
// Pure functions with no React/DOM dependency so they can be exercised
// directly (see renames.test.ts) — the first cut of this shipped a silent
// no-op because a scope tag didn't line up, which a two-line test would
// have caught.

/** One rename row — mirrors RenameDto on the backend. */
export type Rename = {
  id: string
  original: string
  suggested: string
  scope: string
  status: 'SUGGESTED' | 'APPLIED'
  sourcePath: string | null
}

/**
 * The renames that apply when displaying `filePath`.
 *
 * A row applies when it is APPLIED and either unscoped (project-wide) or
 * scoped to this file. Two scoped forms are accepted:
 *
 *   "lib/index.js"            — what `scope: 'symbol'` stores (current).
 *   "function:lib/index.js"   — what `scope: 'variable'` stores, because
 *                               the backend reads that scope as "belongs to
 *                               a decompiled function" and prefixes it.
 *
 * The second form only exists because the script view briefly sent
 * `scope: 'variable'`; those rows are still perfectly good renames, so they
 * are honoured rather than orphaned.
 */
export function renamesForFile(renames: Rename[], filePath: string | null): Rename[] {
  if (!filePath) return []
  const prefixed = `function:${filePath}`
  return renames.filter((r) => r.status === 'APPLIED'
    && (!r.sourcePath || r.sourcePath === filePath || r.sourcePath === prefixed))
}

/**
 * Substitute renames into source text.
 *
 * Word-boundary matching only, matching `RenameService.applyMapToContent`
 * on the server — it will also rewrite the identifier inside strings and
 * comments, which is the same imprecision the server already accepts.
 *
 * Longest originals first so renaming `a` can't chew through a longer name
 * that contains it, and every replacement is computed against the ORIGINAL
 * text positions in one pass per rename, so a rename whose replacement text
 * happens to equal another rename's original can't cascade.
 */
export function applyRenames(text: string, renames: Rename[]): string {
  if (renames.length === 0) return text
  const ordered = renames
    .filter((r) => r.original && r.suggested)
    .sort((a, b) => b.original.length - a.original.length)
  if (ordered.length === 0) return text

  const byOriginal = new Map<string, string>()
  for (const r of ordered) {
    // First writer wins, mirroring the server's dedup-by-original.
    if (!byOriginal.has(r.original)) byOriginal.set(r.original, r.suggested)
  }

  // Single alternation pass: each identifier is examined once, so chains
  // like {a→b, b→c} resolve to b and c, never a→b→c.
  //
  // Boundaries are spelled out rather than using \b, because \b is defined
  // over [A-Za-z0-9_] and therefore does NOT treat `$` as part of a word:
  // `\b$fn\b` never matches `$fn`, so every $-prefixed identifier silently
  // failed to rename. That matters a lot here — minified and obfuscated
  // JavaScript is full of `$`, `_`, and `_0x…` names, which is precisely
  // the code people open this view to read.
  //
  // The leading boundary is a captured character rather than a lookbehind
  // so this keeps working on older Safari (lookbehind only landed in 16.4).
  const alts = [...byOriginal.keys()].map(escapeRegExp).join('|')
  const pattern = new RegExp(`(^|[^A-Za-z0-9_$])(${alts})(?![A-Za-z0-9_$])`, 'g')
  return text.replace(pattern, (_m, pre: string, id: string) => pre + (byOriginal.get(id) ?? id))
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}
