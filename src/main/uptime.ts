import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import dns from 'node:dns/promises'
import net from 'node:net'
import path from 'node:path'
import type { Outage, OutageCause, QualityPoint, Snapshot, Uptime } from '../shared/types'
import { readJson, writeJson } from './store'
import { connect } from './tools'

/** Every 15 s while all is well (one TCP handshake, ~200 bytes: under 40 MB a month); every 5 s once a check fails. */
const SLOW = 15_000
const FAST = 5000
/** Longer without checks (sleep, a stuck process) is not counted as an outage. */
const GAP = 60_000
const DAY = 86_400_000
const KEEP = 500

/** One round of checks. */
export interface Check {
  at: number
  /** The adapter the internet goes through is connected. */
  adapter: boolean
  /** The router answered some check at least once (some ignore them all). */
  routerKnown: boolean
  /** ms, or null when it did not answer. */
  router: number | null
  internet: number | null
  /** null when there was no DNS server to ask. */
  dns: boolean | null
  network: string | null
}

const RANK: Record<OutageCause, number> = { adapter: 0, router: 1, provider: 2, dns: 3 }

/** What is broken, nearest to this computer first; null when the internet works. */
export function causeOf(c: Pick<Check, 'adapter' | 'routerKnown' | 'router' | 'internet' | 'dns'>): OutageCause | null {
  if (c.internet !== null && c.dns !== false) return null
  if (!c.adapter) return 'adapter'
  if (c.routerKnown && c.router === null) return 'router'
  return c.internet === null ? 'provider' : 'dns'
}

/** `ping` with one probe: Windows says "TTL=" only on a real reply (also in other languages). */
export function parsePingOnce(text: string, windows: boolean): number | null {
  if (windows) {
    if (!/TTL=/i.test(text)) return null
    const m = /[=<]\s*(\d+)\s*(?:ms|мс)/i.exec(text)
    return m ? Math.max(1, Number(m[1])) : 1
  }
  const m = /time[=<]([\d.]+)/.exec(text)
  return m ? Number(m[1]) : null
}

export function pingOnce(host: string): Promise<number | null> {
  const win = process.platform === 'win32'
  const args = win ? ['-n', '1', '-w', '1000', host] : ['-c', '1', process.platform === 'darwin' ? '-t' : '-W', '1', host]
  return new Promise((resolve) =>
    execFile('ping', args, { timeout: 3000, windowsHide: true, env: { ...process.env, LC_ALL: 'C' } }, (_e, out) => resolve(parsePingOnce(String(out ?? ''), win)))
  )
}

/** ms until a TCP connection is accepted; null when it is not. */
export async function knock(host: string, port: number, timeout: number): Promise<number | null> {
  const { ms, code } = await connect(host, port, timeout)
  return code === null ? ms : null
}

/**
 * The log: turns checks into outages (two failed checks in a row start one, the first good check ends it)
 * and one-minute quality points. Persisted in `dir`.
 */
export function createLog(dir: string, onEnd: (o: Outage) => void) {
  const outFile = path.join(dir, 'outages.json')
  const ptsFile = path.join(dir, 'quality.json')
  let outages = readJson<Outage[]>(outFile, [])
  let points = readJson<QualityPoint[]>(ptsFile, [])
  // An outage still open in the file was cut short by a crash; it ended when the app stopped.
  for (const o of outages) if (o.end === null) o.end = points.at(-1)?.at ?? o.start
  let open: Outage | null = null
  let failing: { since: number; cause: OutageCause; count: number } | null = null
  let last: Check | null = null
  let minute = { at: 0, n: 0, fails: 0, inet: [0, 0], router: [0, 0] }

  const save = () => {
    writeJson(outFile, outages)
    writeJson(ptsFile, points)
  }
  const flush = () => {
    if (!minute.n) return
    const avg = ([sum, n]: number[]) => (n ? Math.round(sum / n) : null)
    points.push({ at: minute.at, internet: avg(minute.inet), router: avg(minute.router), loss: minute.fails / minute.n })
    points = points.filter((p) => p.at > minute.at - DAY)
    minute = { at: 0, n: 0, fails: 0, inet: [0, 0], router: [0, 0] }
  }
  const close = (at: number) => {
    if (open) {
      open.end = at
      onEnd(open)
      open = null
      save()
    }
    failing = null
  }

  return {
    record(c: Check) {
      // A long silence (sleep, a stuck process) is not an outage: whatever was open ended with the last check.
      if (last && c.at - last.at > GAP) close(last.at)
      last = c
      const m = c.at - (c.at % 60_000)
      if (m !== minute.at) {
        flush()
        minute.at = m
      }
      minute.n++
      if (c.internet === null) minute.fails++
      else minute.inet = [minute.inet[0] + c.internet, minute.inet[1] + 1]
      if (c.router !== null) minute.router = [minute.router[0] + c.router, minute.router[1] + 1]

      const cause = causeOf(c)
      if (cause === null) return close(c.at)
      if (!failing) failing = { since: c.at, cause, count: 0 }
      failing.count++
      if (RANK[cause] < RANK[failing.cause]) failing.cause = cause
      if (!open && failing.count >= 2) {
        open = { id: randomUUID(), start: failing.since, end: null, cause: failing.cause, network: c.network }
        outages = [open, ...outages].slice(0, KEEP)
        save()
      } else if (open && RANK[failing.cause] < RANK[open.cause]) {
        open.cause = failing.cause
        save()
      }
    },
    /** The computer goes to sleep or checking stops: an open outage ends now. */
    pause: (at: number) => close(at),
    /** Something failed lately: check more often. */
    unsteady: () => failing !== null,
    save: () => {
      flush()
      save()
    },
    view: (): Pick<Uptime, 'points' | 'outages' | 'now'> => ({
      points,
      outages,
      now: last && { at: last.at, internet: last.internet, router: last.router, routerKnown: last.routerKnown, dns: last.dns }
    })
  }
}

interface Deps {
  dir: string
  snapshot: () => Snapshot | null
  on: () => boolean
  onEnd: (o: Outage) => void
}

/** Checks the router, the internet (1.1.1.1 or 8.8.8.8 on port 443) and DNS, every 15 s or 5 s. */
export function createUptime(d: Deps) {
  const log = createLog(d.dir, d.onEnd)
  let gateway: string | null = null
  /** How this router answers: ping, or a TCP port (some ignore ping); null until it has answered once. */
  let via: 'ping' | number | null = null
  let resumeAt = 0
  let flip = false
  let stopped = false
  let timer: ReturnType<typeof setTimeout> | undefined

  /** One handshake with 1.1.1.1 or 8.8.8.8 in turn; the other is tried only when that one fails. */
  async function internet(): Promise<number | null> {
    flip = !flip
    const [a, b] = flip ? ['1.1.1.1', '8.8.8.8'] : ['8.8.8.8', '1.1.1.1']
    return (await knock(a, 443, 2500)) ?? knock(b, 443, 2500)
  }

  /**
   * The router's own answer time. An open port first: routers often answer ping late (measured here: ping
   * 158 ms, a handshake on port 80 1.8 ms). Asked twice, the faster counts: the first wakes a dozing Wi-Fi
   * radio, which alone can add 150–800 ms.
   */
  async function router(gw: string): Promise<number | null> {
    if (via === null) {
      const open = await Promise.all([53, 80, 443].map((p) => knock(gw, p, 1500).then((v) => [p, v] as const)))
      via = open.find(([, v]) => v !== null)?.[0] ?? ((await pingOnce(gw)) !== null ? 'ping' : null)
      if (via === null) return null
    }
    const once = () => (via === 'ping' ? pingOnce(gw) : knock(gw, via as number, 1500))
    const [a, b] = [await once(), await once()]
    return a === null && b === null ? null : Math.min(a ?? Infinity, b ?? Infinity)
  }

  async function lookup(servers: string[]): Promise<boolean | null> {
    const usable = servers.filter((s) => net.isIP(s) && !/^fe80:/i.test(s))
    if (!usable.length) return null
    const r = new dns.Resolver({ timeout: 2000, tries: 1 })
    r.setServers(usable)
    return r.resolve4('www.microsoft.com').then((a) => a.length > 0, () => false)
  }

  async function tick() {
    if (!d.on() || Date.now() < resumeAt) return
    const snap = d.snapshot()
    const a = snap?.adapters.find((x) => x.id === snap.defaultId && x.up) ?? null
    if ((a?.gateway ?? null) !== gateway) {
      gateway = a?.gateway ?? null
      via = null
    }
    // In this order: the local checks wake the Wi-Fi radio, so the one internet handshake is timed warm.
    const r = gateway ? await router(gateway) : null
    const ok = a ? await lookup(a.dns) : null
    const inet = await internet()
    log.record({ at: Date.now(), adapter: !!a, routerKnown: via !== null, router: r, internet: inet, dns: ok, network: a?.wifi?.ssid || a?.name || null })
  }
  // One check at a time; the next is planned when this one is done.
  const loop = (wait: number) => {
    timer = setTimeout(
      () =>
        void tick()
          .catch(console.error)
          .finally(() => !stopped && loop(log.unsteady() ? FAST : SLOW)),
      wait
    )
  }
  loop(3000)

  return {
    /** Sleep, or checking switched off: nothing is checked, and an open outage ends. */
    pause() {
      log.pause(Date.now())
    },
    /** After waking up the network needs a moment to come back; that is not an outage. */
    resume() {
      resumeAt = Date.now() + 20_000
    },
    save: log.save,
    view: (): Uptime => ({ on: d.on(), ...log.view() }),
    stop() {
      stopped = true
      clearTimeout(timer)
      log.save()
    }
  }
}
