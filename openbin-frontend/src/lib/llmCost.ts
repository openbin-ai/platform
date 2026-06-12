// USD per 1M tokens, by model id. Approximate -- providers tweak this
// occasionally; we only use it for the "you spent ~$X on this call" hint.
export const PRICING: Record<string, { in: number; out: number }> = {
  'claude-sonnet-4-6': { in: 3, out: 15 },
  'claude-haiku-4-5':  { in: 1, out: 5 },
  'claude-opus-4-7':   { in: 15, out: 75 },
  'gpt-5.1':           { in: 3, out: 15 },
  'gpt-5':             { in: 3, out: 15 },
  'gpt-5-mini':        { in: 0.6, out: 2.4 },
  'gpt-5-nano':        { in: 0.1, out: 0.4 },
  'gpt-4o':            { in: 2.5, out: 10 },
  'gpt-4o-mini':       { in: 0.15, out: 0.6 },
}

export function estimateCost(model: string, inTok: number, outTok: number): string {
  const p = PRICING[model]
  if (!p) return ''
  const cost = (inTok * p.in + outTok * p.out) / 1_000_000
  return cost < 0.01 ? `~$${cost.toFixed(4)}` : `~$${cost.toFixed(3)}`
}
