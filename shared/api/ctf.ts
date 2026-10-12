// Weekly CTF wire types. Reads live under /api/public/ctf (anonymous ok),
// writes under /api/ctf (signed in).

export type CtfKind = 'BIN' | 'APK'

export type Solver = { userId: string; displayName: string; emailMd5: string }

export type SolveRow = Solver & {
  solvedAt: string
  rank: number // 1 = first blood, 0 = solved after the window closed
  points: number
  aiAssisted: boolean
  writeupProjectId: string | null
}

export type MySolve = {
  solvedAt: string
  rank: number
  points: number
  aiAssisted: boolean
  writeupProjectId: string | null
}

export type ChallengeSummary = {
  id: string
  slug: string
  title: string
  kind: CtfKind
  startsAt: string
  endsAt: string
  season: string
  live: boolean
  solveCount: number
  firstBlood: Solver | null
}

export type ChallengeDetail = {
  id: string
  slug: string
  title: string
  description: string
  kind: CtfKind
  projectId: string | null
  flagHint: string | null
  startsAt: string
  endsAt: string
  season: string
  live: boolean
  started: boolean
  solveCount: number
  attemptCount: number
  solves: SolveRow[]
  mine: MySolve | null
}

export type Upcoming = { slug: string; title: string; kind: CtfKind; startsAt: string; endsAt: string }

export type ResearcherOfTheWeek = {
  solver: Solver
  challengeSlug: string
  challengeTitle: string
  solvedAt: string
  aiAssisted: boolean
}

export type LeaderboardRow = Solver & { position: number; points: number; solves: number; firstBloods: number }

export type Leaderboard = { scope: 'week' | 'season' | 'all'; season: string | null; rows: LeaderboardRow[] }

export type CtfHome = {
  live: ChallengeDetail | null
  upcoming: Upcoming | null
  researcherOfTheWeek: ResearcherOfTheWeek | null
  leaderboard: Leaderboard
  recent: ChallengeSummary[]
}

export type SubmitResult = { correct: boolean; rank: number | null; points: number | null; firstBlood: boolean }

export type CtfUserStats = { points: number; solves: number; firstBloods: number }

export const ctfApi = {
  home: '/api/public/ctf',
  archive: '/api/public/ctf/challenges',
  challenge: (slug: string) => `/api/public/ctf/challenges/${encodeURIComponent(slug)}`,
  leaderboard: (scope: string, season?: string) =>
    `/api/public/ctf/leaderboard?scope=${scope}${season ? `&season=${encodeURIComponent(season)}` : ''}`,
  submit: (slug: string) => `/api/ctf/challenges/${encodeURIComponent(slug)}/submit`,
  writeup: (slug: string) => `/api/ctf/challenges/${encodeURIComponent(slug)}/writeup`,
}

/** "3d 4h" / "12m" style remaining time; empty once past. */
export function timeLeft(iso: string, now: number = Date.now()): string {
  const ms = new Date(iso).getTime() - now
  if (ms <= 0) return ''
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440)
  const h = Math.floor((m % 1440) / 60)
  const mm = m % 60
  if (d > 0) return `${d}d ${h}h`
  if (h > 0) return `${h}h ${mm}m`
  return `${mm}m`
}
