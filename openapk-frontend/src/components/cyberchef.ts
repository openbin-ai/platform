/**
 * Builds CyberChef URL-fragment links so the user can drop into the hosted
 * tool with a recipe + input pre-loaded. Format reference:
 *
 *   https://gchq.github.io/CyberChef/#recipe=From_Base64('A',true,false)XOR(...)&input=<b64>
 *
 * - Operation names are written with underscores instead of spaces.
 * - Arg list is space-free, comma-separated. Strings use single quotes (escape
 *   embedded single quotes). Booleans/numbers are bare. Objects use {'k':v,...}.
 * - The whole recipe string is URL-encoded for the fragment.
 * - Input is base64-encoded UTF-8 (CyberChef expects this layout).
 */
export type CyberChefArg =
  | string
  | number
  | boolean
  | { [k: string]: CyberChefArg }
  | CyberChefArg[]

export type CyberChefOp = {
  op: string
  args: CyberChefArg[]
}

const CYBERCHEF_BASE = 'https://gchq.github.io/CyberChef/'

export function buildCyberChefUrl(recipe: CyberChefOp[], input: string): string {
  const recipeStr = recipe.map(op =>
    `${op.op.replace(/ /g, '_')}(${op.args.map(serializeArg).join(',')})`,
  ).join('')
  return `${CYBERCHEF_BASE}#recipe=${encodeURIComponent(recipeStr)}&input=${encodeURIComponent(toB64Utf8(input))}`
}

function serializeArg(a: CyberChefArg): string {
  if (typeof a === 'string') return `'${a.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`
  if (typeof a === 'boolean' || typeof a === 'number') return String(a)
  if (Array.isArray(a)) return `[${a.map(serializeArg).join(',')}]`
  if (a && typeof a === 'object') {
    const entries = Object.entries(a).map(([k, v]) => `'${k}':${serializeArg(v)}`)
    return `{${entries.join(',')}}`
  }
  return String(a)
}

/** UTF-8 safe base64. btoa() only handles latin-1, so encode → bytes → b64. */
function toB64Utf8(s: string): string {
  const bytes = new TextEncoder().encode(s)
  let bin = ''
  for (const b of bytes) bin += String.fromCharCode(b)
  return btoa(bin)
}
