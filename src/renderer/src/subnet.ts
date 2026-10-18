/** IPv4/IPv6 subnet arithmetic on bigints, so both versions share one path. */
export type Subnet = {
  v: 4 | 6
  prefix: number
  network: string
  first: string
  last: string
  broadcast: string | null
  /** Usable hosts (IPv4) or addresses (IPv6). */
  hosts: bigint
  mask: string | null
  wildcard: string | null
}

const v4 = (s: string): bigint | null => {
  const p = s.split('.')
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null
  return p.reduce((a, x) => (a << 8n) | BigInt(x), 0n)
}

const v6 = (s: string): bigint | null => {
  // A trailing dotted IPv4 ("::ffff:1.2.3.4") is the last two groups.
  const tail = /(\d+\.\d+\.\d+\.\d+)$/.exec(s)
  if (tail) {
    const n = v4(tail[1])
    if (n === null) return null
    s = s.slice(0, -tail[1].length) + `${(n >> 16n).toString(16)}:${(n & 0xffffn).toString(16)}`
  }
  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] ? halves[0].split(':') : []
  const rest = halves[1] ? halves[1].split(':') : []
  const gap = 8 - head.length - rest.length
  if (halves.length === 1 ? gap !== 0 : gap < 1) return null
  const groups = [...head, ...Array<string>(halves.length === 2 ? gap : 0).fill('0'), ...rest]
  if (groups.some((g) => !/^[0-9a-f]{1,4}$/i.test(g))) return null
  return groups.reduce((a, g) => (a << 16n) | BigInt(`0x${g}`), 0n)
}

const show4 = (n: bigint) => [24n, 16n, 8n, 0n].map((s) => (n >> s) & 255n).join('.')

/** RFC 5952: lower case, no leading zeros, the longest run of two or more zero groups as "::". */
const show6 = (n: bigint) => {
  const g = Array.from({ length: 8 }, (_, i) => Number((n >> BigInt(112 - 16 * i)) & 0xffffn))
  let at = -1
  let len = 1
  for (let i = 0; i < 8; i++) {
    let j = i
    while (j < 8 && g[j] === 0) j++
    if (j - i > len) [at, len] = [i, j - i]
    i = j
  }
  const hex = g.map((x) => x.toString(16))
  return at < 0 ? hex.join(':') : `${hex.slice(0, at).join(':')}::${hex.slice(at + len).join(':')}`
}

const parse = (s: string): { v: 4 | 6; n: bigint } | null => {
  const a = v4(s)
  if (a !== null) return { v: 4, n: a }
  const b = s.includes(':') ? v6(s) : null
  return b === null ? null : { v: 6, n: b }
}

/** "192.168.1.10/24", "192.168.1.10 255.255.255.0" or "2001:db8::1/64"; null when it isn't one. */
export function subnet(input: string): Subnet | null {
  const [addr, size, extra] = input.trim().split(/\s*\/\s*|\s+/)
  if (!addr || !size || extra !== undefined) return null
  const ip = parse(addr)
  if (!ip) return null
  const bits = ip.v === 4 ? 32 : 128
  let prefix = /^\d{1,3}$/.test(size) ? Number(size) : -1
  if (prefix < 0 && ip.v === 4) {
    // A dotted mask must be ones, then zeros.
    const bin = v4(size)?.toString(2).padStart(32, '0')
    if (bin && /^1*0*$/.test(bin)) prefix = bin.includes('0') ? bin.indexOf('0') : 32
  }
  if (prefix < 0 || prefix > bits) return null
  const full = (1n << BigInt(bits)) - 1n
  const span = (1n << BigInt(bits - prefix)) - 1n
  const network = ip.n & (full ^ span)
  const top = network | span
  const show = ip.v === 4 ? show4 : show6
  if (ip.v === 6) return { v: 6, prefix, network: show(network), first: show(network), last: show(top), broadcast: null, hosts: span + 1n, mask: null, wildcard: null }
  // /31 links have two usable ends (RFC 3021); /32 is one host.
  const edge = prefix >= 31
  return {
    v: 4,
    prefix,
    network: show(network),
    first: show(edge ? network : network + 1n),
    last: show(edge ? top : top - 1n),
    broadcast: edge ? null : show(top),
    hosts: edge ? span + 1n : span - 1n,
    mask: show(full ^ span),
    wildcard: show(span)
  }
}

/** Whether `ip` lies in the subnet; null when it isn't an address of the same version. */
export function contains(s: Subnet, ip: string): boolean | null {
  const a = parse(ip.trim())
  if (!a || a.v !== s.v) return null
  const b = subnet(`${ip.trim()}/${s.prefix}`)
  return b !== null && b.network === s.network
}
