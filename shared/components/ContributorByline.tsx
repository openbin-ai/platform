import { Gravatar } from './Gravatar'
import type { Contributor } from '@shared/api/community'

// A report's contributor byline: LEAD first, then contributors, as gravatar
// chips with names and a LEAD badge. Renders nothing when empty so the caller
// can fall back to the legacy single-author line (older reports have no
// snapshotted byline). Accent matches the product (purple = openbin,
// amber = openapk).
export function ContributorByline({
  contributors,
  accent = 'purple',
  size = 22,
}: {
  contributors: Contributor[]
  accent?: 'purple' | 'amber'
  size?: number
}) {
  if (!contributors || contributors.length === 0) return null
  const leadCls =
    accent === 'amber'
      ? 'text-amber-300 border-amber-700/50 bg-amber-950/30'
      : 'text-purple-300 border-purple-700/50 bg-purple-950/30'
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {contributors.map((c, i) => (
        <span
          key={(c.userId ?? c.displayName) + ':' + i}
          className="inline-flex items-center gap-1.5 rounded-full border border-zinc-800 bg-zinc-900/60 py-0.5 pl-0.5 pr-2"
          title={c.credit === 'LEAD' ? `${c.displayName} — lead` : c.displayName}
        >
          {c.isBot ? (
            <span
              className="inline-flex items-center justify-center rounded-full bg-zinc-700"
              style={{ width: size, height: size, fontSize: size * 0.55 }}
            >
              🤖
            </span>
          ) : (
            <Gravatar emailMd5={c.emailMd5} size={size} />
          )}
          <span className="text-xs text-zinc-200">{c.displayName}</span>
          {c.credit === 'LEAD' && (
            <span className={`rounded border px-1 text-[9px] font-medium uppercase tracking-wide ${leadCls}`}>
              lead
            </span>
          )}
        </span>
      ))}
    </div>
  )
}
