import fs from 'node:fs'
import path from 'node:path'
import type { Adapter, AdapterKind, NetworkUse, Snapshot, Traffic, Usage, UsageRange, UsageRow } from '../shared/types'

type Pair = [rx: number, tx: number]

interface Entry {
  name: string
  path: string | null
  kind?: AdapterKind
  /** 24 hours of [rx, tx] bytes. */
  hours: Pair[]
}

/** One file per local day: data/usage/2026-10-14.json */
interface Day {
  date: string
  adapters: Record<string, Entry>
  apps: Record<string, Entry>
  /** Internet traffic per network (Wi-Fi name, or adapter for cable/mobile); absent in files from before it. */
  networks?: Record<string, Entry>
}

const pad = (n: number) => String(n).padStart(2, '0')
export const dayKey = (t: number) => {
  const d = new Date(t)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}
const dayStart = (t: number) => new Date(new Date(t).setHours(0, 0, 0, 0)).getTime()
const empty = (date: string): Day => ({ date, adapters: {}, apps: {} })
const hours = (): Pair[] => Array.from({ length: 24 }, () => [0, 0])
/** The network an adapter is on: its Wi-Fi by name, else the adapter itself (cable, mobile). */
export const networkOf = (a: Pick<Adapter, 'kind' | 'name' | 'wifi'>) => (a.wifi?.ssid ? { key: `wifi:${a.wifi.ssid}`, name: a.wifi.ssid } : { key: `${a.kind}:${a.name}`, name: a.name })

/** Traffic that leaves this computer; virtual adapters (VMs, WSL) only carry it locally. */
const INTERNET: AdapterKind[] = ['wifi', 'ethernet', 'cellular', 'bluetooth']

export function createUsage(dir: string, keepDays = 90) {
  const file = (date: string) => path.join(dir, `${date}.json`)
  const read = (date: string): Day | null => {
    try {
      return JSON.parse(fs.readFileSync(file(date), 'utf8')) as Day
    } catch {
      return null
    }
  }

  let day = read(dayKey(Date.now())) ?? empty(dayKey(Date.now()))
  let dirty = false
  const lastAdapters = new Map<string, Pair>()
  const lastApps = new Map<string, Pair>()
  let since: number | null = null

  function save() {
    if (!dirty) return
    fs.mkdirSync(dir, { recursive: true })
    const f = file(day.date)
    fs.writeFileSync(`${f}.tmp`, JSON.stringify(day))
    fs.renameSync(`${f}.tmp`, f)
    dirty = false
  }

  function add(group: 'adapters' | 'apps' | 'networks', key: string, e: Omit<Entry, 'hours'>, rx: number, tx: number, t: number) {
    if (dayKey(t) !== day.date) {
      save()
      day = read(dayKey(t)) ?? empty(dayKey(t))
    }
    const entry = ((day[group] ??= {})[key] ??= { ...e, hours: hours() })
    Object.assign(entry, e)
    const h = entry.hours[new Date(t).getHours()]
    h[0] += rx
    h[1] += tx
    dirty = true
  }

  /** The change of each counter since last time; a counter that went down was reset, so that step is skipped. */
  function delta(last: Map<string, Pair>, key: string, rx: number, tx: number): Pair | null {
    const p = last.get(key)
    last.set(key, [rx, tx])
    if (!p || rx < p[0] || tx < p[1]) return null
    return [rx - p[0], tx - p[1]]
  }

  /** Every day from the day of `from` to the day of `now`; noon steps over daylight-saving jumps. */
  function span(from: number, now: number): Day[] {
    const out: Day[] = []
    for (let t = dayStart(from) + 12 * 3_600_000; dayKey(t) <= dayKey(now); t += 86_400_000) {
      const date = dayKey(t)
      out.push(date === day.date ? day : (read(date) ?? empty(date)))
    }
    return out
  }

  function rows(group: Record<string, Entry>[]): UsageRow[] {
    const out = new Map<string, UsageRow>()
    for (const g of group)
      for (const [key, e] of Object.entries(g)) {
        const r = out.get(key) ?? { key, name: e.name, path: e.path, rx: 0, tx: 0 }
        for (const [rx, tx] of e.hours) {
          r.rx += rx
          r.tx += tx
        }
        out.set(key, r)
      }
    return [...out.values()].filter((r) => r.rx + r.tx > 0).sort((a, b) => b.rx + b.tx - (a.rx + a.tx))
  }

  return {
    /** Adapter byte counters from a snapshot (works without Wireshark). */
    adapters(snap: Snapshot) {
      for (const a of snap.adapters) {
        const d = delta(lastAdapters, a.id, a.rx, a.tx)
        if (!d || !(d[0] || d[1])) continue
        add('adapters', a.id, { name: a.name, path: null, kind: a.kind }, d[0], d[1], snap.at)
        if (INTERNET.includes(a.kind)) {
          const n = networkOf(a)
          add('networks', n.key, { name: n.name, path: null, kind: a.kind }, d[0], d[1], snap.at)
        }
      }
    },

    /** Bytes (in + out) on one network, or all networks when `network` is '', from the day of `from` to now. */
    used(network: string, from: number, now = Date.now()): number {
      let sum = 0
      for (const d of span(from, now))
        for (const [key, e] of Object.entries(d.networks ?? {})) if (!network || key === network) for (const [rx, tx] of e.hours) sum += rx + tx
      return sum
    },

    /** Networks used in the last `days` days, most used first (to pick one for a data limit). */
    networks(now = Date.now(), days = 35): NetworkUse[] {
      return rows(span(now - days * 86_400_000, now).map((d) => d.networks ?? {})).map((r) => ({ key: r.key, name: r.name, bytes: r.rx + r.tx }))
    },

    /** Per-app totals from the traffic watch; they restart with every capture. */
    apps(view: Traffic) {
      if (view.since !== since) {
        since = view.since
        lastApps.clear()
      }
      for (const a of view.apps) {
        // Totals count from the start of the capture, so an app seen for the first time starts at 0.
        const [rx0, tx0] = lastApps.get(a.key) ?? [0, 0]
        lastApps.set(a.key, [a.rx, a.tx])
        if (a.rx < rx0 || a.tx < tx0 || a.rx + a.tx === rx0 + tx0) continue
        add('apps', a.key, { name: a.title ?? a.app, path: a.path }, a.rx - rx0, a.tx - tx0, Date.now())
      }
    },

    save,

    /** Deletes days older than `keepDays`. */
    prune(now = Date.now()) {
      const oldest = dayKey(now - keepDays * 86_400_000)
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) if (/^\d{4}-\d\d-\d\d\.json$/.test(f) && f.slice(0, 10) < oldest) fs.rmSync(path.join(dir, f), { force: true })
    },

    query(range: UsageRange, now = Date.now()): Usage {
      const days = range === 'day' ? 1 : range === 'week' ? 7 : 30
      const list: Day[] = []
      for (let i = days - 1; i >= 0; i--) {
        // Noon steps over daylight-saving jumps when walking back day by day.
        const date = dayKey(dayStart(now) + 12 * 3_600_000 - i * 86_400_000)
        list.push(date === day.date ? day : (read(date) ?? empty(date)))
      }
      const internet = (d: Day) => Object.values(d.adapters).filter((e) => e.kind && INTERNET.includes(e.kind))
      const sum = (es: Entry[], h?: number): Pair =>
        es.reduce<Pair>(
          (acc, e) => {
            for (const [i, [rx, tx]] of e.hours.entries())
              if (h === undefined || h === i) {
                acc[0] += rx
                acc[1] += tx
              }
            return acc
          },
          [0, 0]
        )
      const points =
        range === 'day'
          ? Array.from({ length: 24 }, (_, h) => {
              const [rx, tx] = sum(internet(list[0]), h)
              return { at: dayStart(now) + h * 3_600_000, rx, tx }
            })
          : list.map((d) => {
              const [rx, tx] = sum(internet(d))
              return { at: new Date(`${d.date}T00:00:00`).getTime(), rx, tx }
            })
      const total = points.reduce<Pair>((a, p) => [a[0] + p.rx, a[1] + p.tx], [0, 0])
      return { range, points, apps: rows(list.map((d) => d.apps)), adapters: rows(list.map((d) => d.adapters)), rx: total[0], tx: total[1] }
    }
  }
}
