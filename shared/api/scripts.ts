// Types + endpoint paths for SCRIPT projects (malicious-NPM analyzer).
// Mirrors the Java mappings in ScriptAnalysisController + the worker JSON
// schema in script-worker/README.md (v1).

export type Severity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'INFO'

export const SEVERITY_ORDER: Severity[] = ['CRITICAL', 'HIGH', 'MEDIUM', 'INFO']

export type ScriptFindingsResponse = {
  schemaVersion: number
  analyzedAt: string
  durationMs?: number
  summary: ScriptFindingsSummary
  findings: ScriptFinding[]
}

export type ScriptEcosystem = 'npm' | 'pypi' | 'shell'

export type ScriptFindingsSummary = {
  fileCount: number
  tarballEntryCount: number
  findingCount: number
  countsBySeverity: Partial<Record<Severity, number>>
  // Jackson serializes the Java record field "pkg" back as "package" so
  // we match the JSON-side name here too — the field is keyword-safe in
  // TS but not in Java, hence the asymmetry.
  package: ScriptPackageInfo
  deobfuscatedFileCount: number
  // Added in JS-2 (pypi-worker). Optional because findings persisted
  // before the field existed default to undefined; treat undefined as 'npm'.
  ecosystem?: ScriptEcosystem
}

export type ScriptPackageInfo = {
  found: boolean
  name?: string | null
  version?: string | null
  description?: string | null
  maintainerCount?: number | null
  dependencyCount?: number | null
  hasInstallHook?: boolean | null
  installHooks?: ScriptInstallHook[] | null
  parseError?: string | null
}

export type ScriptInstallHook = {
  key: string    // "preinstall" | "install" | "postinstall"
  script: string
}

export type ScriptFinding = {
  id: string
  rule: string
  severity: Severity
  file: string
  line: number
  column: number
  message: string
  snippet: string
  remediation: string
  evidence: Record<string, unknown>
  deobfuscated: boolean
}

export const SCRIPT_PATHS = {
  upload: '/api/projects/script',
  findings: (projectId: string) => `/api/projects/script/${projectId}/findings`,
  bundleUrl: (projectId: string) => `/api/projects/script/${projectId}/bundle-url`,
  askStream: (projectId: string) => `/api/projects/script/${projectId}/ask/stream`,
  deobfuscate: (projectId: string) => `/api/projects/script/${projectId}/deobfuscate`,
} as const

// --- on-demand deobfuscation --------------------------------------------

/**
 * Engines the analyst can run against a single file, on demand. This is
 * separate from the conservative pass that runs at upload time.
 *
 *  auto          — worker runs the plausible engines and keeps whichever
 *                  scores most readable (it reports what it tried).
 *  obfuscator-io — ben-sb/obfuscator-io-deobfuscator, specialised for
 *                  obfuscator.io string arrays + control-flow flattening.
 *  generic       — ben-sb/js-deobfuscator, broader but less targeted.
 *  caesar        — Caesar-over-fromCharCode decoder for the common NPM
 *                  dropper shape.
 */
export type DeobfuscateEngine = 'auto' | 'obfuscator-io' | 'generic' | 'caesar'

export const DEOBFUSCATE_ENGINES: { id: DeobfuscateEngine; label: string; hint: string }[] = [
  { id: 'auto', label: 'Auto', hint: 'Try each engine and keep the most readable result' },
  { id: 'obfuscator-io', label: 'obfuscator.io', hint: 'String arrays, control-flow flattening, anti-tamper' },
  { id: 'generic', label: 'General JS', hint: 'Broader deobfuscator, less obfuscator.io-specific' },
  { id: 'caesar', label: 'Caesar decode', hint: 'Caesar-shift over fromCharCode — the common NPM dropper' },
]

/** Extensions the JS engines can do anything with. */
const JS_EXTENSIONS = ['.js', '.mjs', '.cjs', '.ts', '.jsx', '.tsx']

export function isDeobfuscatable(path: string): boolean {
  const lower = path.toLowerCase()
  return JS_EXTENSIONS.some((ext) => lower.endsWith(ext))
}

export type DeobfuscateAttempt = {
  engine: string
  used: boolean
  score: number | null
  durationMs?: number
  error?: string
}

/** Mirrors DeobfuscateResponse on the backend. */
export type DeobfuscateResult = {
  engine: string
  used: boolean
  source: string
  note: string
  error?: string | null
  score?: number | null
  baselineScore?: number | null
  looksObfuscated?: boolean | null
  truncated: boolean
  durationMs?: number | null
  attempts?: DeobfuscateAttempt[] | null
}

/** Mirrors AskScriptRequest on the backend. */
export type AskScriptBody = {
  filePath: string
  fileContent: string
  deobfuscated: boolean
  question: string
  credentialId: string
  model?: string
  priorTurns?: Array<{ role: 'user' | 'assistant'; content: string }>
}
