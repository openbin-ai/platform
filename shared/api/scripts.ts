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
} as const
