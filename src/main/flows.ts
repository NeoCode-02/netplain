import type { AppTraffic, Packet, Place, Proc } from '../shared/types'
import { scope } from './connections'

/** pid bucket for traffic whose program could not be found (closed before the next socket refresh, ICMP…). */
export const UNKNOWN = -1

interface Flow {
  transport: Packet['transport']
  localPort: number
  remoteIp: string
  rx: number
  tx: number
  last: number
  /** Server name seen in the flow itself (TLS/QUIC hello or HTTP Host). */
  name: string | null
  pid: number | null
}

interface Bytes {
  rx: number
  tx: number
  ip: string
}

type PerPid = Map<number, Map<string, Bytes>>

const IDLE = 120_000
const MAX_NAMES = 50_000

function bump(into: PerPid, pid: number, place: string, ip: string, rx: number, tx: number) {
  let places = into.get(pid)
  if (!places) into.set(pid, (places = new Map()))
  const b = places.get(place)
  if (b) {
    b.rx += rx
    b.tx += tx
  } else places.set(place, { rx, tx, ip })
}

/** Packets → flows (one per local port + remote end) → bytes per program and place. */
export function createTraffic() {
  const flows = new Map<string, Flow>()
  /** IP → name from DNS answers this computer received. */
  const names = new Map<string, string>()
  /** Flows that went quiet, already folded per program and place. */
  const retired: PerPid = new Map()
  let local = new Set<string>()
  let since: number | null = null
  let rx = 0
  let tx = 0

  const placeOf = (f: Flow) => f.name ?? names.get(f.remoteIp) ?? f.remoteIp

  return {
    setLocal(ips: string[]) {
      local = new Set(ips)
    },

    /** Names the OS resolved before the capture started; names seen on the wire win. */
    learn(hosts: Map<string, string>) {
      for (const [ip, name] of hosts) if (!names.has(ip)) names.set(ip, name)
    },

    /** Returns true when the packet started a new flow (its program is not known yet). */
    add(p: Packet): boolean {
      since ??= p.t
      if (p.dnsQuery && p.dnsAnswers.length) {
        if (names.size > MAX_NAMES) names.clear()
        for (const ip of p.dnsAnswers) names.set(ip, p.dnsQuery)
      }
      const out = local.has(p.src)
      if (!out && !local.has(p.dst)) return false
      const remoteIp = out ? p.dst : p.src
      const localPort = (out ? p.sport : p.dport) ?? 0
      const key = `${p.transport}|${localPort}|${remoteIp}|${(out ? p.dport : p.sport) ?? 0}`
      let f = flows.get(key)
      const fresh = !f
      if (!f) flows.set(key, (f = { transport: p.transport, localPort, remoteIp, rx: 0, tx: 0, last: p.t, name: null, pid: null }))
      if (out) {
        f.tx += p.len
        tx += p.len
      } else {
        f.rx += p.len
        rx += p.len
      }
      f.last = p.t
      f.name ??= p.sni ?? p.host
      return fresh
    },

    /** Gives flows without an owner the program that has their local port open right now; returns the pids it found. */
    resolve(owner: (transport: 'tcp' | 'udp', port: number) => number | null): number[] {
      const found: number[] = []
      for (const f of flows.values())
        if (f.pid === null && f.transport !== 'other') {
          f.pid = owner(f.transport, f.localPort)
          if (f.pid !== null) found.push(f.pid)
        }
      return found
    },

    /** Folds flows quiet for two minutes into the per-program totals, so memory stays flat. */
    prune(now: number) {
      for (const [k, f] of flows)
        if (now - f.last > IDLE) {
          bump(retired, f.pid ?? UNKNOWN, placeOf(f), f.remoteIp, f.rx, f.tx)
          flows.delete(k)
        }
    },

    /** Bytes per program and place since the capture started. */
    perPid(): PerPid {
      const out: PerPid = new Map()
      for (const [pid, places] of retired) for (const [place, b] of places) bump(out, pid, place, b.ip, b.rx, b.tx)
      for (const f of flows.values()) bump(out, f.pid ?? UNKNOWN, placeOf(f), f.remoteIp, f.rx, f.tx)
      return out
    },

    totals: () => ({ rx, tx, since }),

    reset() {
      flows.clear()
      retired.clear()
      since = null
      rx = 0
      tx = 0
    }
  }
}

type Lookup = (ip: string) => { country: string | null; org: string | null }
export type Prev = Map<string, { rx: number; tx: number }>

/**
 * Per-program view for the UI: programs with the same name are one app; rates are the change since
 * the previous view `dt` seconds ago.
 */
export function summarize(perPid: PerPid, procs: Map<number, Proc>, geo: Lookup, prev: Prev, dt: number): { apps: AppTraffic[]; next: Prev } {
  const apps = new Map<string, AppTraffic & { byPlace: Map<string, Place> }>()
  for (const [pid, places] of perPid) {
    const p = procs.get(pid)
    const key = pid === UNKNOWN ? '?' : (p?.title ?? p?.name ?? `PID ${pid}`)
    let a = apps.get(key)
    if (!a) apps.set(key, (a = { key, app: p?.name ?? key, title: p?.title ?? null, path: p?.path ?? null, rx: 0, tx: 0, rxRate: 0, txRate: 0, places: [], byPlace: new Map() }))
    for (const [name, b] of places) {
      a.rx += b.rx
      a.tx += b.tx
      const pl = a.byPlace.get(name)
      if (pl) {
        pl.rx += b.rx
        pl.tx += b.tx
      } else a.byPlace.set(name, { name, ip: b.ip, rx: b.rx, tx: b.tx, org: null, country: null })
    }
  }
  const next: Prev = new Map()
  const list = [...apps.values()].map(({ byPlace, ...a }) => {
    const before = prev.get(a.key)
    next.set(a.key, { rx: a.rx, tx: a.tx })
    const places = [...byPlace.values()]
      .sort((x, y) => y.rx + y.tx - (x.rx + x.tx))
      .slice(0, 8)
      .map((pl) => (scope(pl.ip) === 'internet' ? { ...pl, ...geo(pl.ip) } : pl))
    return {
      ...a,
      places,
      rxRate: before && dt > 0 ? (Math.max(0, a.rx - before.rx) * 8) / dt : 0,
      txRate: before && dt > 0 ? (Math.max(0, a.tx - before.tx) * 8) / dt : 0
    }
  })
  return { apps: list.sort((x, y) => y.rx + y.tx - (x.rx + x.tx)), next }
}
