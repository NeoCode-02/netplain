/** IPv4 address → unsigned 32-bit number, or null. */
function v4(ip: string): number | null {
  const p = ip.split('.')
  if (p.length !== 4 || p.some((x) => !/^\d{1,3}$/.test(x) || Number(x) > 255)) return null
  return p.reduce((n, x) => n * 256 + Number(x), 0)
}

/**
 * A set of IPv4 addresses and CIDR ranges ("1.2.3.4", "10.0.0.0/8", "# comments"), as in FireHOL's
 * .netset files or a list typed by the user. Lookups are a binary search over merged ranges.
 * ponytail: IPv4 only; the public lists are IPv4 too.
 */
export function createBlocklist(text: string) {
  const ranges: [number, number][] = []
  for (const line of text.split(/\r?\n/)) {
    const s = line.replace(/#.*/, '').trim()
    if (!s) continue
    const [ip, bits = '32'] = s.split('/')
    const start = v4(ip)
    const b = Number(bits)
    if (start === null || !Number.isInteger(b) || b < 0 || b > 32) continue
    const size = 2 ** (32 - b)
    const base = start - (start % size)
    ranges.push([base, base + size - 1])
  }
  ranges.sort((a, b) => a[0] - b[0])
  const merged: [number, number][] = []
  for (const r of ranges) {
    const last = merged.at(-1)
    if (last && r[0] <= last[1] + 1) last[1] = Math.max(last[1], r[1])
    else merged.push([...r])
  }
  return {
    size: merged.length,
    has(ip: string): boolean {
      const n = v4(ip)
      if (n === null) return false
      let lo = 0
      let hi = merged.length - 1
      while (lo <= hi) {
        const mid = (lo + hi) >> 1
        if (n < merged[mid][0]) hi = mid - 1
        else if (n > merged[mid][1]) lo = mid + 1
        else return true
      }
      return false
    }
  }
}
