import { useEffect, useState } from 'react'
import { API_BASE } from '../api/client'

/**
 * Three live numbers from GET /api/public/stats on the shared backend:
 * registered researchers, how many made an authenticated call in the last
 * five minutes, and public community reports. The API caches for a minute;
 * the strip shows exact figures, no rounding, because a real number is
 * more convincing than "7k+".
 *
 * The strip reserves its height before the fetch resolves and renders
 * nothing on failure. A row of zeros would say the opposite of what this
 * strip is for.
 *
 * openbin-landing/src/components/LiveStats.tsx is the same component with
 * the API base hardcoded (the static site has no runtime config). Keep the
 * two in step.
 */
const STATS_URL = `${API_BASE}/api/public/stats`

type Stats = { users: number; online: number; publicReports: number }

export function LiveStats() {
  const [stats, setStats] = useState<Stats | null>(null)

  useEffect(() => {
    const ctl = new AbortController()
    fetch(STATS_URL, { signal: ctl.signal })
      .then(r => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Stats) => setStats(s))
      .catch(() => {})
    return () => ctl.abort()
  }, [])

  return (
    <dl
      aria-live="polite"
      className="mt-10 flex min-h-[4.5rem] flex-wrap items-center justify-center gap-x-10 gap-y-4"
    >
      {stats && (
        <>
          <Stat value={stats.users} label="researchers" />
          <Stat value={stats.online} label="online now" live />
          <Stat value={stats.publicReports} label="public reports" />
        </>
      )}
    </dl>
  )
}

function Stat({ value, label, live }: { value: number; label: string; live?: boolean }) {
  const shown = useCountUp(value)
  return (
    <div className="flex flex-col items-center">
      <dd className="order-1 font-mono text-3xl font-semibold tabular-nums tracking-tight text-zinc-50 sm:text-4xl">
        {shown.toLocaleString('en-US')}
      </dd>
      <dt className="order-2 mt-1 flex items-center gap-1.5 font-mono text-xs uppercase tracking-[0.2em] text-zinc-400">
        {live && (
          <span className="relative flex h-2 w-2" aria-hidden>
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75 motion-reduce:hidden" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
        )}
        {label}
      </dt>
    </div>
  )
}

/** Ramps 0 → target over ~1.2s with ease-out; jumps straight there under prefers-reduced-motion. */
function useCountUp(target: number, ms = 1200) {
  // Reduced motion: start at the target so there is no ramp to skip. The
  // Stat only mounts once the fetch has resolved, so target never changes.
  const [n, setN] = useState(() => (prefersReducedMotion() ? target : 0))
  useEffect(() => {
    if (prefersReducedMotion()) return
    let raf = 0
    const start = performance.now()
    const tick = (now: number) => {
      const t = Math.min(1, (now - start) / ms)
      const eased = 1 - Math.pow(1 - t, 3)
      setN(Math.round(target * eased))
      if (t < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, ms])
  return n
}

function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
