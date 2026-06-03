import { useCallback, useEffect, useState } from 'react'
import { useApi } from '../api/client'

type IntentFilter = {
  actions: string[]
  categories: string[]
  dataSchemes: string[]
  priority: number | null
}

type ManifestComponent = {
  kind: 'application' | 'activity' | 'service' | 'receiver' | 'provider'
  className: string
  exported: boolean
  enabled: boolean
  permission: string
  intentFilters: IntentFilter[]
  authorities: string[]
  file: string | null
  line: number | null
}

type AndroidManifestInfo = {
  packageName: string
  versionCode: number | null
  versionName: string
  minSdk: number | null
  targetSdk: number | null
  permissions: string[]
  definedPermissions: string[]
  application: ManifestComponent | null
  activities: ManifestComponent[]
  services: ManifestComponent[]
  receivers: ManifestComponent[]
  providers: ManifestComponent[]
}

/**
 * AndroidManifest.xml view. Surfaces the four Android component types
 * (activity / service / receiver / provider) with their effective exported
 * flag, intent filters, permission gate, and a jump-to-class link when the
 * component's class is in the symbol index.
 *
 * Dangerous permissions are flagged in the header — they are the things a
 * researcher wants to eyeball first when triaging an APK.
 */
export function EntryPoints({
  projectId,
  onOpenFile,
}: {
  projectId: string
  onOpenFile: (file: string, line: number) => void
}) {
  const api = useApi()
  const [info, setInfo] = useState<AndroidManifestInfo | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [exportedOnly, setExportedOnly] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      setInfo(await api<AndroidManifestInfo>(`/api/projects/${projectId}/manifest`))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setLoading(false)
    }
  }, [api, projectId])

  useEffect(() => { void load() }, [load])

  if (loading && info === null) {
    return <p className="p-3 text-xs text-zinc-500">Loading manifest…</p>
  }

  if (error) {
    return (
      <div className="space-y-2 p-3">
        <div className="rounded border border-red-900/60 bg-red-950/40 px-2 py-1 text-[11px] text-red-300">{error}</div>
        <button
          onClick={() => void load()}
          className="rounded border border-zinc-700 px-2 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!info) return null

  const dangerous = info.permissions.filter(isDangerous)
  const visibleFilter = (c: ManifestComponent) => !exportedOnly || c.exported

  return (
    <div className="space-y-3 p-3">
      <div className="rounded border border-zinc-800 bg-zinc-950/60 p-3">
        <div className="flex items-baseline justify-between gap-2">
          <p className="font-mono text-sm text-zinc-100">{info.packageName || '(no package)'}</p>
          <div className="flex items-center gap-2 text-[10px] text-zinc-400">
            <label className="flex items-center gap-1" title="Hide non-exported components">
              <input type="checkbox" className="h-3 w-3" checked={exportedOnly} onChange={e => setExportedOnly(e.target.checked)} />
              exported only
            </label>
            <button
              onClick={() => void load()}
              disabled={loading}
              title="Re-read AndroidManifest.xml"
              className="text-zinc-400 hover:text-zinc-200 disabled:opacity-40"
            >
              {loading ? '…' : '↻'}
            </button>
          </div>
        </div>
        <p className="mt-1 text-[11px] text-zinc-400">
          v{info.versionName ?? '?'} ({info.versionCode ?? '?'}) ·
          {' '}min SDK {info.minSdk ?? '?'} · target {info.targetSdk ?? '?'}
        </p>
        {info.application?.className && (
          <p className="mt-1 font-mono text-[11px] text-zinc-400">
            Application: {info.application.file ? (
              <button
                onClick={() => onOpenFile(info.application!.file!, info.application!.line ?? 1)}
                className="text-purple-300 hover:underline"
              >
                {info.application.className}
              </button>
            ) : info.application.className}
          </p>
        )}
      </div>

      {(info.permissions.length > 0 || info.definedPermissions.length > 0) && (
        <details className="rounded border border-zinc-800 bg-zinc-950/60" open={dangerous.length > 0}>
          <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-zinc-300">
            Permissions ({info.permissions.length}{dangerous.length > 0 && <span className="text-red-300"> · {dangerous.length} dangerous</span>})
          </summary>
          <ul className="space-y-0.5 px-3 py-2 font-mono text-[10px]">
            {info.permissions.map(p => (
              <li key={p} className={isDangerous(p) ? 'text-red-300' : 'text-zinc-400'}>
                {isDangerous(p) && <span className="mr-1">⚠</span>}
                {p}
              </li>
            ))}
            {info.definedPermissions.length > 0 && (
              <>
                <li className="mt-2 text-[10px] uppercase tracking-wide text-zinc-500">Defines:</li>
                {info.definedPermissions.map(p => (
                  <li key={`def-${p}`} className="text-zinc-300">{p}</li>
                ))}
              </>
            )}
          </ul>
        </details>
      )}

      <ComponentSection title="Activities" components={info.activities.filter(visibleFilter)} totalCount={info.activities.length} onOpenFile={onOpenFile} />
      <ComponentSection title="Services" components={info.services.filter(visibleFilter)} totalCount={info.services.length} onOpenFile={onOpenFile} />
      <ComponentSection title="Receivers" components={info.receivers.filter(visibleFilter)} totalCount={info.receivers.length} onOpenFile={onOpenFile} />
      <ComponentSection title="Providers" components={info.providers.filter(visibleFilter)} totalCount={info.providers.length} onOpenFile={onOpenFile} />
    </div>
  )
}

function ComponentSection({
  title, components, totalCount, onOpenFile,
}: {
  title: string
  components: ManifestComponent[]
  totalCount: number
  onOpenFile: (file: string, line: number) => void
}) {
  if (totalCount === 0) return null
  return (
    <details className="rounded border border-zinc-800 bg-zinc-950/60" open>
      <summary className="cursor-pointer px-2 py-1 text-[11px] font-medium text-zinc-300">
        {title} ({components.length}{components.length !== totalCount && ` / ${totalCount}`})
      </summary>
      {components.length === 0 ? (
        <p className="px-3 py-2 text-[10px] text-zinc-500">All filtered out by "exported only".</p>
      ) : (
        <ul className="space-y-1 px-2 py-2">
          {components.map(c => (
            <ComponentRow key={`${c.kind}:${c.className}:${c.file}`} component={c} onOpenFile={onOpenFile} />
          ))}
        </ul>
      )}
    </details>
  )
}

function ComponentRow({
  component,
  onOpenFile,
}: {
  component: ManifestComponent
  onOpenFile: (file: string, line: number) => void
}) {
  const c = component
  const simple = c.className.includes('.') ? c.className.substring(c.className.lastIndexOf('.') + 1) : c.className
  return (
    <li className="rounded border border-zinc-800/70 bg-black/30 p-2">
      <div className="flex items-baseline gap-2">
        {c.exported
          ? <span title="exported=true (callable from other apps)" className="shrink-0 rounded border border-amber-800 bg-amber-900/40 px-1 text-[9px] uppercase text-amber-300">exported</span>
          : <span title="exported=false (internal)" className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 text-[9px] uppercase text-zinc-500">internal</span>}
        {!c.enabled && <span className="shrink-0 rounded border border-zinc-700 bg-zinc-900 px-1 text-[9px] uppercase text-zinc-500">disabled</span>}
        {c.file ? (
          <button
            onClick={() => onOpenFile(c.file!, c.line ?? 1)}
            className="min-w-0 flex-1 truncate text-left font-mono text-[11px] text-purple-300 hover:underline"
            title={`${c.file}:${c.line ?? 1}`}
          >
            {simple} <span className="text-zinc-500">— {c.className}</span>
          </button>
        ) : (
          <span title="not found in symbol index" className="min-w-0 flex-1 truncate font-mono text-[11px] text-zinc-400">
            {simple} <span className="text-zinc-600">— {c.className}</span>
          </span>
        )}
      </div>
      {c.permission && (
        <p className="mt-1 font-mono text-[10px] text-zinc-400">
          permission: <span className="text-zinc-200">{c.permission}</span>
        </p>
      )}
      {c.authorities.length > 0 && (
        <p className="mt-1 font-mono text-[10px] text-zinc-400">
          authorities: <span className="text-zinc-200">{c.authorities.join(', ')}</span>
        </p>
      )}
      {c.intentFilters.length > 0 && (
        <ul className="mt-1 space-y-0.5 font-mono text-[10px]">
          {c.intentFilters.map((f, i) => (
            <li key={i} className="text-zinc-400">
              <span className="text-zinc-500">filter{f.priority != null ? ` (priority=${f.priority})` : ''}:</span>{' '}
              {f.actions.map(a => <span key={a} className="ml-1 rounded border border-sky-800 bg-sky-900/30 px-1 text-sky-300">{shortAction(a)}</span>)}
              {f.categories.map(cat => <span key={cat} className="ml-1 rounded border border-zinc-700 bg-zinc-900 px-1 text-zinc-400">{shortAction(cat)}</span>)}
              {f.dataSchemes.map(d => <span key={d} className="ml-1 rounded border border-emerald-800 bg-emerald-900/30 px-1 text-emerald-300">{d}</span>)}
            </li>
          ))}
        </ul>
      )}
    </li>
  )
}

const DANGEROUS_PERMS = new Set([
  'android.permission.READ_SMS',
  'android.permission.RECEIVE_SMS',
  'android.permission.SEND_SMS',
  'android.permission.READ_CONTACTS',
  'android.permission.WRITE_CONTACTS',
  'android.permission.READ_CALL_LOG',
  'android.permission.WRITE_CALL_LOG',
  'android.permission.READ_PHONE_STATE',
  'android.permission.RECORD_AUDIO',
  'android.permission.CAMERA',
  'android.permission.ACCESS_FINE_LOCATION',
  'android.permission.ACCESS_COARSE_LOCATION',
  'android.permission.ACCESS_BACKGROUND_LOCATION',
  'android.permission.READ_EXTERNAL_STORAGE',
  'android.permission.WRITE_EXTERNAL_STORAGE',
  'android.permission.SYSTEM_ALERT_WINDOW',
  'android.permission.BIND_DEVICE_ADMIN',
  'android.permission.BIND_ACCESSIBILITY_SERVICE',
  'android.permission.PACKAGE_USAGE_STATS',
  'android.permission.REQUEST_INSTALL_PACKAGES',
])

function isDangerous(perm: string): boolean {
  return DANGEROUS_PERMS.has(perm)
}

function shortAction(s: string): string {
  // Trim the boilerplate android.intent.action / category prefix so the chip
  // shows "MAIN" instead of "android.intent.action.MAIN".
  return s.replace(/^android\.intent\.(action|category)\./, '')
          .replace(/^android\.app\.action\./, '')
          .replace(/^android\.provider\./, '')
}
