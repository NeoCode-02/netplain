import type { Connections, Hop, Traffic } from '../../shared/types'

/** An address in a country: what talks to it and who runs it. */
export interface Spot {
  ip: string
  /** Host name when known, else the IP. */
  name: string
  app: string
  org: string | null
}

/** Everything going between this computer and one country. */
export interface CountryFlow {
  country: string
  /** Bytes received from / sent to it since the capture started; null without Wireshark. */
  rx: number | null
  tx: number | null
  /** Open connections now, and how many of them the other side started. */
  conns: number
  inbound: number
  spots: Spot[]
}

/**
 * Connections and captured traffic, by country. A connection is inbound when it arrived on a port this
 * computer listens on (someone else started it); bytes come from the traffic watch when it runs.
 */
export function byCountry(c: Connections | null, traffic: Traffic | null): CountryFlow[] {
  const out = new Map<string, CountryFlow & { seen: Set<string> }>()
  const flow = (country: string) => {
    let f = out.get(country)
    if (!f) out.set(country, (f = { country, rx: null, tx: null, conns: 0, inbound: 0, spots: [], seen: new Set() }))
    return f
  }
  const spot = (f: CountryFlow & { seen: Set<string> }, s: Spot) => {
    if (f.seen.has(s.ip)) return
    f.seen.add(s.ip)
    f.spots.push(s)
  }
  const listening = new Set((c?.listening ?? []).map((x) => x.localPort))
  for (const x of c?.conns ?? []) {
    if (x.scope !== 'internet' || !x.country || !x.remoteIp) continue
    const f = flow(x.country)
    f.conns++
    if (listening.has(x.localPort)) f.inbound++
    spot(f, { ip: x.remoteIp, name: x.host ?? x.remoteIp, app: x.title ?? x.app, org: x.org })
  }
  for (const a of traffic?.state === 'on' ? traffic.apps : []) {
    for (const p of a.places) {
      if (!p.country) continue
      const f = flow(p.country)
      f.rx = (f.rx ?? 0) + p.rx
      f.tx = (f.tx ?? 0) + p.tx
      spot(f, { ip: p.ip, name: p.name, app: a.title ?? a.app, org: p.org })
    }
  }
  const size = (f: CountryFlow) => (f.rx ?? 0) + (f.tx ?? 0) || f.conns
  return [...out.values()].map(({ seen: _, ...f }) => f).sort((a, b) => size(b) - size(a) || a.country.localeCompare(b.country))
}

/** One country a route passes through, with the routers seen there. */
export interface Stop {
  country: string
  hops: { n: number; ip: string; org: string | null; ms: number | null }[]
}

/**
 * A traceroute as countries in order: routers in the same country in a row are one stop; silent hops and
 * those without a location (the home network, private provider ranges) are left out.
 */
export function routeOf(hops: Hop[]): Stop[] {
  const stops: Stop[] = []
  for (const h of hops) {
    if (!h.ip || !h.country) continue
    const last = stops.at(-1)
    const hop = { n: h.n, ip: h.ip, org: h.org, ms: h.ms }
    if (last?.country === h.country) last.hops.push(hop)
    else stops.push({ country: h.country, hops: [hop] })
  }
  return stops
}
