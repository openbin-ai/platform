import { useMemo, useState } from 'react'

/**
 * Client-side string/number utility panel — base64, hex, int, URL, and a few
 * common text transforms — all computed live from a single input. No network,
 * no backend; everything runs in the browser. Shared verbatim by openbin and
 * openapk (see @shared alias), so it must not depend on either app's api/auth.
 *
 * UX: type/paste once at the top; every transform renders its result below at
 * once (CyberChef-lite). Transforms that can't apply to the current input show
 * a muted note instead of erroring the whole panel.
 */

type Result = { ok: true; value: string } | { ok: false; note: string }

const enc = new TextEncoder()
// Non-fatal so partially-valid byte sequences still show something useful.
const dec = new TextDecoder('utf-8', { fatal: false })

function bytesToHex(bytes: Uint8Array): string {
  let s = ''
  for (const b of bytes) s += b.toString(16).padStart(2, '0')
  return s
}

function normalizeHex(input: string): string {
  // Accept "0x"-prefixed, space/newline/colon-separated, mixed case.
  return input.trim().replace(/^0x/i, '').replace(/[\s:]+/g, '')
}

function hexToBytes(hexRaw: string): Uint8Array {
  const hex = normalizeHex(hexRaw)
  if (hex.length === 0 || hex.length % 2 !== 0 || /[^0-9a-fA-F]/.test(hex)) {
    throw new Error('not valid hex')
  }
  const out = new Uint8Array(hex.length / 2)
  for (let i = 0; i < out.length; i++) out[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16)
  return out
}

function base64Decode(input: string): string {
  // Tolerate URL-safe base64 and missing padding.
  let b64 = input.trim().replace(/-/g, '+').replace(/_/g, '/')
  const pad = b64.length % 4
  if (pad === 2) b64 += '=='
  else if (pad === 3) b64 += '='
  else if (pad === 1) throw new Error('not valid base64')
  const bin = atob(b64) // may throw on invalid chars
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  return dec.decode(bytes)
}

function base64Encode(input: string): string {
  const bytes = enc.encode(input)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}

function rot13(input: string): string {
  return input.replace(/[a-zA-Z]/g, c => {
    const base = c <= 'Z' ? 65 : 97
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base)
  })
}

/** Each transform: input string -> Result. Order = display order. */
const TRANSFORMS: { label: string; run: (s: string) => Result }[] = [
  {
    label: 'Base64 decode',
    run: s => { try { return { ok: true, value: base64Decode(s) } } catch { return { ok: false, note: 'not valid base64' } } },
  },
  {
    label: 'Base64 encode',
    run: s => ({ ok: true, value: base64Encode(s) }),
  },
  {
    label: 'Hex → text',
    run: s => { try { return { ok: true, value: dec.decode(hexToBytes(s)) } } catch { return { ok: false, note: 'not valid hex' } } },
  },
  {
    label: 'Text → hex',
    run: s => ({ ok: true, value: bytesToHex(enc.encode(s)) }),
  },
  {
    label: 'Hex → int (decimal)',
    run: s => {
      const h = normalizeHex(s)
      if (h.length === 0 || /[^0-9a-fA-F]/.test(h)) return { ok: false, note: 'not valid hex' }
      try { return { ok: true, value: BigInt('0x' + h).toString(10) } } catch { return { ok: false, note: 'not valid hex' } }
    },
  },
  {
    label: 'Int → hex',
    run: s => {
      const t = s.trim().replace(/[_,]/g, '')
      if (!/^-?\d+$/.test(t)) return { ok: false, note: 'not a decimal integer' }
      try {
        const n = BigInt(t)
        return { ok: true, value: (n < 0n ? '-0x' + (-n).toString(16) : '0x' + n.toString(16)) }
      } catch { return { ok: false, note: 'not a decimal integer' } }
    },
  },
  {
    label: 'URL decode',
    run: s => { try { return { ok: true, value: decodeURIComponent(s) } } catch { return { ok: false, note: 'not valid percent-encoding' } } },
  },
  {
    label: 'URL encode',
    run: s => ({ ok: true, value: encodeURIComponent(s) }),
  },
  {
    label: 'ROT13',
    run: s => ({ ok: true, value: rot13(s) }),
  },
  {
    label: 'Reverse',
    run: s => ({ ok: true, value: [...s].reverse().join('') }),
  },
  {
    label: 'UPPERCASE',
    run: s => ({ ok: true, value: s.toUpperCase() }),
  },
  {
    label: 'lowercase',
    run: s => ({ ok: true, value: s.toLowerCase() }),
  },
]

export function StringTools({ initialValue = '' }: { initialValue?: string }) {
  const [input, setInput] = useState(initialValue)
  const [copied, setCopied] = useState<string | null>(null)

  const results = useMemo(
    () => TRANSFORMS.map(t => ({ label: t.label, res: input === '' ? null : t.run(input) })),
    [input],
  )

  const charCount = [...input].length
  const byteCount = enc.encode(input).length

  async function copy(label: string, text: string) {
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
      setTimeout(() => setCopied(c => (c === label ? null : c)), 1200)
    } catch {
      /* clipboard blocked — user can select manually */
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-3 p-3">
      <div>
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">String tools</h3>
          {input !== '' && (
            <button onClick={() => setInput('')} className="text-[10px] text-zinc-500 hover:text-zinc-300">clear</button>
          )}
        </div>
        <textarea
          value={input}
          onChange={e => setInput(e.target.value)}
          placeholder="Paste text, base64, hex, or a number…"
          spellCheck={false}
          rows={4}
          className="w-full resize-y rounded border border-zinc-800 bg-zinc-950 px-2 py-1.5 font-mono text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-zinc-500 focus:outline-none"
        />
        <p className="mt-1 text-[10px] text-zinc-500">
          {charCount.toLocaleString()} char{charCount === 1 ? '' : 's'} · {byteCount.toLocaleString()} byte{byteCount === 1 ? '' : 's'} (UTF-8)
        </p>
      </div>

      <div className="min-h-0 flex-1 space-y-1.5 overflow-auto">
        {input === '' ? (
          <p className="px-1 text-xs text-zinc-600">Enter something above to see every conversion at once.</p>
        ) : (
          results.map(({ label, res }) => (
            <div key={label} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-[10px] font-medium uppercase tracking-wide text-zinc-500">{label}</span>
                {res && res.ok && res.value !== '' && (
                  <button
                    onClick={() => void copy(label, res.value)}
                    className="shrink-0 rounded border border-zinc-700 px-1.5 py-0.5 text-[10px] text-zinc-300 hover:bg-zinc-800"
                  >
                    {copied === label ? 'copied' : 'copy'}
                  </button>
                )}
              </div>
              {res && res.ok ? (
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-all font-mono text-[11px] leading-4 text-zinc-200">
                  {res.value === '' ? <span className="text-zinc-600">(empty)</span> : res.value}
                </pre>
              ) : (
                <p className="font-mono text-[11px] text-zinc-600">— {res?.note}</p>
              )}
            </div>
          ))
        )}
      </div>
    </div>
  )
}
