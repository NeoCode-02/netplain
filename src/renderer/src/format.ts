const PREFIX = ['', 'K', 'M', 'G', 'T']

function scale(n: number): [string, string] {
  let i = 0
  while (Math.abs(n) >= 1000 && i < PREFIX.length - 1) {
    n /= 1000
    i++
  }
  const s = n >= 100 || i === 0 ? Math.round(n).toString() : n.toFixed(1).replace(/\.0$/, '')
  return [s, PREFIX[i]]
}

/** Network speeds in bits per second, the unit internet plans and link speeds use: "3.4 Mbit/s". */
export function bits(bps: number): string {
  const [n, p] = scale(bps)
  return `${n} ${p}bit/s`
}

/** Amounts of data in decimal bytes: "1.2 GB". */
export function bytes(n: number): string {
  const [v, p] = scale(n)
  return `${v} ${p}B`
}

/** "192.168.0.102/24" → "192.168.0.102" */
export const addr = (cidr: string) => cidr.split('/')[0]
