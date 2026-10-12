import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useAuth } from 'react-oidc-context'
import { useApi, ApiError } from '@shared/api/client'
import { Gravatar } from '@shared/components/Gravatar'
import {
  ctfApi,
  timeLeft,
  type ChallengeDetail,
  type ChallengeSummary,
  type CtfHome,
  type Leaderboard,
  type ResearcherOfTheWeek,
  type SolveRow,
  type SubmitResult,
} from '@shared/api/ctf'
import { Markdown } from '../components/Markdown'

/**
 * Weekly CTF. One route component for both /ctf (home: live challenge,
 * researcher of the week, leaderboard, archive) and /ctf/:slug (one
 * challenge). Reads are anonymous; the flag box asks for sign-in.
 */
export function Ctf() {
  const { slug } = useParams<{ slug?: string }>()
  return slug ? <ChallengePage slug={slug} /> : <CtfHomePage />
}

function CtfHomePage() {
  const api = useApi()
  const [home, setHome] = useState<CtfHome | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  const load = useCallback(() => {
    api<CtfHome>(ctfApi.home)
      .then(setHome)
      .catch((e: Error) => setError(e.message))
  }, [api])
  useEffect(() => { load() }, [load, tick])

  if (error) return <Page><Err>{error}</Err></Page>
  if (!home) return <Page><p className="text-sm text-zinc-500">Loading…</p></Page>

  return (
    <Page>
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold text-zinc-50 sm:text-3xl">Weekly CTF</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-400">
            One crackme a week. Fork it, reverse it here or with your own tools, submit the flag.
            First correct flag is Researcher of the Week.
          </p>
        </div>
        <Link to="/ctf#archive" className="text-sm text-amber-300 hover:underline">Past challenges</Link>
      </header>

      {home.live ? (
        <ChallengeCard challenge={home.live} onChanged={() => setTick((t) => t + 1)} />
      ) : (
        <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-6">
          <h2 className="text-lg font-semibold text-zinc-100">No challenge is live right now</h2>
          {home.upcoming ? (
            <p className="mt-2 text-sm text-zinc-300">
              Next up: <span className="text-zinc-100">{home.upcoming.title}</span> ({home.upcoming.kind}) opens{' '}
              <time dateTime={home.upcoming.startsAt}>{fmtDate(home.upcoming.startsAt)}</time>.
            </p>
          ) : (
            <p className="mt-2 text-sm text-zinc-400">The next one is announced on Discord. Past challenges below stay open for practice.</p>
          )}
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <LeaderboardPanel initial={home.leaderboard} />
        <ResearcherCard row={home.researcherOfTheWeek} />
      </div>

      <Archive recent={home.recent} />
    </Page>
  )
}

function ChallengePage({ slug }: { slug: string }) {
  const api = useApi()
  const [c, setC] = useState<ChallengeDetail | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    let cancelled = false
    api<ChallengeDetail>(ctfApi.challenge(slug))
      .then((d) => { if (!cancelled) setC(d) })
      .catch((e: Error) => { if (!cancelled) setError(e instanceof ApiError && e.status === 404 ? 'No such challenge.' : e.message) })
    return () => { cancelled = true }
  }, [api, slug, tick])

  return (
    <Page>
      <Link to="/ctf" className="text-sm text-zinc-400 hover:text-zinc-200">← Weekly CTF</Link>
      {error && <Err>{error}</Err>}
      {c && <ChallengeCard challenge={c} onChanged={() => setTick((t) => t + 1)} full />}
    </Page>
  )
}

// ---- pieces ----------------------------------------------------------------

function ChallengeCard({ challenge: c, onChanged, full }: { challenge: ChallengeDetail; onChanged: () => void; full?: boolean }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000)
    return () => clearInterval(id)
  }, [])
  const left = timeLeft(c.endsAt, now)

  return (
    <section className="overflow-hidden rounded-xl border border-amber-500/30 bg-linear-to-br from-amber-950/20 via-zinc-950 to-zinc-950 p-6 sm:p-7">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <KindBadge kind={c.kind} />
            {c.live ? (
              <span className="rounded border border-emerald-600/60 bg-emerald-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-emerald-300">live</span>
            ) : (
              <span className="rounded border border-zinc-600/60 bg-zinc-800/50 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-400">archive</span>
            )}
            <span className="font-mono text-[11px] text-zinc-500">{c.season}</span>
          </div>
          <h2 className="mt-2 text-xl font-semibold text-zinc-50 sm:text-2xl">
            {full ? c.title : <Link to={`/ctf/${c.slug}`} className="hover:underline">{c.title}</Link>}
          </h2>
          <p className="mt-1 text-sm text-zinc-400">
            {c.live && left ? <>Closes in <span className="font-mono text-zinc-200">{left}</span> · </> : null}
            {c.solveCount} {c.solveCount === 1 ? 'solve' : 'solves'} · {c.attemptCount} attempts
          </p>
        </div>
        {c.projectId && (
          <Link
            to={`/public/projects/${c.projectId}`}
            className="inline-flex items-center rounded-md bg-amber-500 px-3 py-1.5 text-sm font-medium text-black shadow-sm hover:bg-amber-400"
          >
            Open in OpenBin
          </Link>
        )}
      </div>

      <div className="mt-5 text-sm leading-relaxed text-zinc-200">
        <Markdown>{c.description || '_No description._'}</Markdown>
      </div>
      {c.projectId && (
        <p className="mt-3 text-xs text-zinc-500">
          Fork the project to get the binary, the listing and the decompiler in your own workspace, or download it from the project page.
        </p>
      )}

      <FlagForm challenge={c} onSolved={onChanged} />

      <Solves solves={c.solves} />
    </section>
  )
}

function FlagForm({ challenge: c, onSolved }: { challenge: ChallengeDetail; onSolved: () => void }) {
  const auth = useAuth()
  const api = useApi()
  const [flag, setFlag] = useState('')
  const [ai, setAi] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)

  if (!auth.isAuthenticated) {
    return (
      <div className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4 text-sm text-zinc-300">
        <button onClick={() => void auth.signinRedirect()} className="text-amber-300 hover:underline">Sign in</button>{' '}
        to submit a flag.
      </div>
    )
  }

  if (c.mine) {
    return (
      <div className="mt-5 rounded-lg border border-emerald-700/50 bg-emerald-950/30 p-4 text-sm text-emerald-200">
        <div>
          Solved{c.mine.rank === 1 ? ' with first blood' : c.mine.rank > 0 ? ` as #${c.mine.rank}` : ' after the window closed'}
          {' '}for <span className="font-mono">{c.mine.points}</span> points
          {c.mine.aiAssisted && <span className="ml-2 rounded border border-zinc-600 px-1 py-0.5 font-mono text-[10px] uppercase text-zinc-300">AI-assisted</span>}.
        </div>
        <WriteupForm slug={c.slug} current={c.mine.writeupProjectId} onSaved={onSolved} />
      </div>
    )
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!flag.trim() || busy) return
    setBusy(true); setMsg(null)
    try {
      const r = await api<SubmitResult>(ctfApi.submit(c.slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ flag, aiAssisted: ai }),
      })
      if (r.correct) {
        setMsg({ ok: true, text: r.firstBlood ? 'First blood. You are Researcher of the Week.' : `Correct. Rank #${r.rank}, ${r.points} points.` })
        setFlag('')
        onSolved()
      } else {
        setMsg({ ok: false, text: 'Wrong flag.' })
      }
    } catch (err) {
      const e = err as Error
      setMsg({ ok: false, text: e instanceof ApiError && e.status === 429 ? 'Too many attempts. Wait a few minutes.' : e.message })
    } finally {
      setBusy(false)
    }
  }

  return (
    <form onSubmit={submit} className="mt-5 rounded-lg border border-zinc-800 bg-zinc-950/60 p-4">
      <label className="block text-xs font-medium uppercase tracking-wide text-zinc-500">Flag</label>
      <div className="mt-2 flex flex-wrap gap-2">
        <input
          value={flag}
          onChange={(e) => setFlag(e.target.value)}
          placeholder={c.flagHint ?? 'openbin{...}'}
          spellCheck={false}
          autoComplete="off"
          className="min-w-0 flex-1 rounded-md border border-zinc-700 bg-zinc-900 px-3 py-2 font-mono text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-amber-500 focus:outline-none"
        />
        <button
          type="submit"
          disabled={busy || !flag.trim()}
          className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-black hover:bg-amber-400 disabled:opacity-50"
        >
          {busy ? 'Checking…' : 'Submit'}
        </button>
      </div>
      <label className="mt-3 flex items-center gap-2 text-xs text-zinc-400">
        <input type="checkbox" checked={ai} onChange={(e) => setAi(e.target.checked)} className="accent-amber-500" />
        I used AI assistance (BINNY or another model). Shown next to your solve.
      </label>
      {msg && <p className={`mt-3 text-sm ${msg.ok ? 'text-emerald-300' : 'text-rose-300'}`}>{msg.text}</p>}
      <p className="mt-2 text-[11px] text-zinc-600">Five attempts per ten minutes.</p>
    </form>
  )
}

function WriteupForm({ slug, current, onSaved }: { slug: string; current: string | null; onSaved: () => void }) {
  const api = useApi()
  const [projects, setProjects] = useState<{ id: string; name: string; publicReadAt: string | null }[] | null>(null)
  const [pick, setPick] = useState(current ?? '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    api<{ id: string; name: string; publicReadAt: string | null }[]>('/api/projects')
      .then(setProjects)
      .catch(() => setProjects([]))
  }, [api])

  async function save() {
    if (!pick || busy) return
    setBusy(true); setErr(null)
    try {
      await api(ctfApi.writeup(slug), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ projectId: pick }),
      })
      onSaved()
    } catch (e) {
      setErr((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const publicOnes = (projects ?? []).filter((p) => p.publicReadAt)
  return (
    <div className="mt-3 border-t border-emerald-800/40 pt-3 text-xs text-emerald-100/80">
      <div className="mb-1">
        {current ? (
          <>Writeup: <Link to={`/public/projects/${current}`} className="underline">open</Link>. Replace it below.</>
        ) : (
          <>Attach a writeup: pick one of your public projects (fork of the challenge with your report).</>
        )}
      </div>
      <div className="flex flex-wrap gap-2">
        <select
          value={pick}
          onChange={(e) => setPick(e.target.value)}
          className="rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1 text-xs text-zinc-100"
        >
          <option value="">{projects === null ? 'Loading…' : publicOnes.length ? 'Choose a public project' : 'No public projects yet'}</option>
          {publicOnes.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
        </select>
        <button onClick={() => void save()} disabled={!pick || busy} className="rounded-md border border-emerald-600/60 px-2 py-1 text-xs text-emerald-200 hover:bg-emerald-900/40 disabled:opacity-50">
          {busy ? 'Saving…' : 'Attach'}
        </button>
      </div>
      {err && <p className="mt-1 text-rose-300">{err}</p>}
    </div>
  )
}

function Solves({ solves }: { solves: SolveRow[] }) {
  if (solves.length === 0) {
    return <p className="mt-5 text-sm text-zinc-500">No solves yet. First blood is open.</p>
  }
  return (
    <div className="mt-5">
      <h3 className="text-xs font-medium uppercase tracking-wide text-zinc-500">Solves</h3>
      <ol className="mt-2 divide-y divide-zinc-800/80 rounded-lg border border-zinc-800">
        {solves.map((s) => (
          <li key={s.userId} className={`flex items-center gap-3 px-3 py-2 text-sm ${s.rank === 1 ? 'bg-amber-950/30' : ''}`}>
            <span className="w-8 shrink-0 font-mono text-xs text-zinc-500">{s.rank > 0 ? `#${s.rank}` : '—'}</span>
            <Gravatar emailMd5={s.emailMd5} size={24} />
            <Link to={`/u/${s.userId}`} className="min-w-0 flex-1 truncate text-zinc-100 hover:underline">{s.displayName}</Link>
            {s.rank === 1 && <span className="rounded border border-amber-600/60 bg-amber-900/30 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-amber-300">first blood</span>}
            {s.aiAssisted && <span className="rounded border border-zinc-600 px-1 py-0.5 font-mono text-[10px] uppercase text-zinc-400">AI</span>}
            {s.writeupProjectId && <Link to={`/public/projects/${s.writeupProjectId}`} className="text-xs text-amber-300 hover:underline">writeup</Link>}
            <span className="font-mono text-xs text-zinc-400">{s.points} pts</span>
            <time dateTime={s.solvedAt} className="hidden font-mono text-[11px] text-zinc-500 sm:block">{fmtDateTime(s.solvedAt)}</time>
          </li>
        ))}
      </ol>
    </div>
  )
}

function LeaderboardPanel({ initial }: { initial: Leaderboard }) {
  const api = useApi()
  const [scope, setScope] = useState<'week' | 'season' | 'all'>(initial.scope)
  const [board, setBoard] = useState<Leaderboard>(initial)
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (scope === initial.scope) { setBoard(initial); return }
    let cancelled = false
    setLoading(true)
    api<Leaderboard>(ctfApi.leaderboard(scope))
      .then((b) => { if (!cancelled) setBoard(b) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [api, scope, initial])

  const tabs = useMemo(() => [
    ['week', 'This week'], ['season', `Season ${board.scope === 'season' && board.season ? board.season : ''}`.trim()], ['all', 'All time'],
  ] as const, [board])

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-900/40 p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-semibold text-zinc-100">Leaderboard</h2>
        <div className="flex gap-1 rounded-md border border-zinc-800 p-0.5">
          {tabs.map(([k, label]) => (
            <button
              key={k}
              onClick={() => setScope(k)}
              className={`rounded px-2 py-1 text-xs ${scope === k ? 'bg-amber-500 text-black' : 'text-zinc-400 hover:text-zinc-100'}`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <p className="mt-4 text-sm text-zinc-500">Loading…</p>
      ) : board.rows.length === 0 ? (
        <p className="mt-4 text-sm text-zinc-500">Nobody on the board yet.</p>
      ) : (
        <ol className="mt-4 divide-y divide-zinc-800/80">
          {board.rows.map((r) => (
            <li key={r.userId} className="flex items-center gap-3 py-2 text-sm">
              <span className="w-6 shrink-0 font-mono text-xs text-zinc-500">{r.position}</span>
              <Gravatar emailMd5={r.emailMd5} size={24} />
              <Link to={`/u/${r.userId}`} className="min-w-0 flex-1 truncate text-zinc-100 hover:underline">{r.displayName}</Link>
              {r.firstBloods > 0 && <span className="font-mono text-[11px] text-amber-300" title="first bloods">{r.firstBloods}×🩸</span>}
              <span className="font-mono text-xs text-zinc-400">{r.solves} {r.solves === 1 ? 'solve' : 'solves'}</span>
              <span className="w-16 text-right font-mono text-sm text-zinc-100">{r.points}</span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}

function ResearcherCard({ row }: { row: ResearcherOfTheWeek | null }) {
  return (
    <section className="rounded-xl border border-amber-500/30 bg-zinc-900/40 p-5">
      <h2 className="text-xs font-medium uppercase tracking-wide text-amber-300">Researcher of the Week</h2>
      {row ? (
        <div className="mt-3 flex items-center gap-3">
          <Gravatar emailMd5={row.solver.emailMd5} size={48} />
          <div className="min-w-0">
            <Link to={`/u/${row.solver.userId}`} className="block truncate text-lg font-semibold text-zinc-50 hover:underline">{row.solver.displayName}</Link>
            <p className="text-xs text-zinc-400">
              First blood on <Link to={`/ctf/${row.challengeSlug}`} className="text-zinc-200 hover:underline">{row.challengeTitle}</Link>
              {row.aiAssisted ? ' (AI-assisted)' : ''} · {fmtDateTime(row.solvedAt)}
            </p>
          </div>
        </div>
      ) : (
        <p className="mt-3 text-sm text-zinc-500">Nobody yet. The first correct flag takes it.</p>
      )}
    </section>
  )
}

function Archive({ recent }: { recent: ChallengeSummary[] }) {
  const api = useApi()
  const [all, setAll] = useState<ChallengeSummary[] | null>(null)
  const rows = all ?? recent
  return (
    <section id="archive" className="scroll-mt-20">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-semibold text-zinc-100">Past challenges</h2>
        {!all && recent.length >= 8 && (
          <button onClick={() => api<ChallengeSummary[]>(ctfApi.archive).then(setAll)} className="text-sm text-amber-300 hover:underline">Show all</button>
        )}
      </div>
      {rows.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-500">Nothing yet.</p>
      ) : (
        <ul className="mt-3 grid gap-3 sm:grid-cols-2">
          {rows.map((c) => (
            <li key={c.id} className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
              <div className="flex items-center gap-2">
                <KindBadge kind={c.kind} />
                {c.live && <span className="rounded border border-emerald-600/60 px-1.5 py-0.5 font-mono text-[10px] uppercase text-emerald-300">live</span>}
                <span className="ml-auto font-mono text-[11px] text-zinc-500">{fmtDate(c.startsAt)}</span>
              </div>
              <Link to={`/ctf/${c.slug}`} className="mt-2 block font-medium text-zinc-100 hover:underline">{c.title}</Link>
              <p className="mt-1 text-xs text-zinc-400">
                {c.solveCount} {c.solveCount === 1 ? 'solve' : 'solves'}
                {c.firstBlood && <> · first blood <Link to={`/u/${c.firstBlood.userId}`} className="text-zinc-200 hover:underline">{c.firstBlood.displayName}</Link></>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

function KindBadge({ kind }: { kind: string }) {
  return (
    <span className="rounded border border-zinc-700 bg-zinc-800/60 px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider text-zinc-300">
      {kind === 'APK' ? 'android' : 'native'}
    </span>
  )
}

function Page({ children }: { children: React.ReactNode }) {
  return <div className="mx-auto max-w-5xl space-y-8 px-6 py-8">{children}</div>
}

function Err({ children }: { children: React.ReactNode }) {
  return <p className="rounded-md border border-rose-800/60 bg-rose-950/40 p-3 text-sm text-rose-200">{children}</p>
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function fmtDateTime(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}
