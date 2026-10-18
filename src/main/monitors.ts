import { randomUUID } from 'node:crypto'
import http from 'node:http'
import https from 'node:https'
import net from 'node:net'
import path from 'node:path'
import type { TLSSocket } from 'node:tls'
import type { MonitorKind, MonitorState } from '../shared/types'
import { connect, isHost } from './tools'
import { pingOnce } from './uptime'
import { readJson, writeJson } from './store'

const MAX = 50
const DAY = 86_400_000
/** After one failed check the next comes this soon, so a down site is confirmed within a minute. */
const RETRY = 30_000
/** Certificate warnings at these many days left (each once). */
const CERT_DAYS = [0, 1, 3, 7, 14]

export interface Result {
  ms: number | null
  status: number | null
  error: string | null
  certDays: number | null
}

/** Stored with what the next check needs: failures in a row, when they began, the last certificate warning. */
export type Stored = MonitorState & { fails: number; failAt: number | null; certWarned: number | null }

export type MonitorEvent = ['monitorDown' | 'monitorUp' | 'certExpiry', string]

/** "host:port" (an IPv6 host in brackets) → its parts, or null. */
export function hostPort(s: string): { host: string; port: number } | null {
  const m = /^(\[[0-9a-f:.]+\]|[^:\s[\]]+):(\d{1,5})$/i.exec(s.trim())
  if (!m) return null
  const host = m[1].replace(/^\[|\]$/g, '')
  const port = Number(m[2])
  return (isHost(host) || net.isIPv6(host)) && port > 0 && port < 65536 ? { host, port } : null
}

/** The target in the form its kind needs ("example.com" becomes "https://example.com/"), or null. */
export function cleanTarget(kind: MonitorKind, raw: string): string | null {
  const s = raw.trim()
  if (!s || s.length > 2048) return null
  if (kind === 'tcp') return hostPort(s) ? s : null
  if (kind === 'ping') return isHost(s) ? s : null
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(s) ? s : `https://${s}`)
    return (u.protocol === 'https:' || u.protocol === 'http:') && u.hostname ? u.href : null
  } catch {
    return null
  }
}

/** One GET: the time to the answer's headers, its status, and the certificate's days left; the body is not read. */
export function httpCheck(url: string, timeout = 10_000): Promise<Result> {
  return new Promise((resolve) => {
    const u = new URL(url)
    const t0 = performance.now()
    let settled = false
    const finish = (r: Result) => {
      if (settled) return
      settled = true
      req.destroy()
      resolve(r)
    }
    const req = (u.protocol === 'https:' ? https : http).request(u, { method: 'GET', timeout, agent: false, headers: { 'user-agent': 'Netplain uptime check', accept: '*/*' } }, (res) => {
      const ms = Math.max(1, Math.round(performance.now() - t0))
      const cert = (res.socket as TLSSocket).getPeerCertificate?.()
      const certDays = cert?.valid_to ? Math.floor((Date.parse(cert.valid_to) - Date.now()) / DAY) : null
      const status = res.statusCode ?? null
      res.resume()
      finish({ ms, status, certDays, error: status !== null && status < 400 ? null : `HTTP ${status}` })
    })
    req.on('timeout', () => finish({ ms: null, status: null, certDays: null, error: 'E_TIMEOUT' }))
    req.on('error', (e: NodeJS.ErrnoException) => finish({ ms: null, status: null, certDays: null, error: e.code ?? 'E_NETWORK' }))
    req.end()
  })
}

/** A TCP handshake, with why it failed (refused, no such name, no answer). */
export async function tcpCheck(host: string, port: number, timeout = 5000): Promise<Result> {
  const { ms, code } = await connect(host, port, timeout)
  return { ms: code === null ? ms : null, status: null, certDays: null, error: code }
}

async function run(kind: MonitorKind, target: string): Promise<Result> {
  if (kind === 'http') return httpCheck(target)
  if (kind === 'tcp') {
    const { host, port } = hostPort(target)!
    return tcpCheck(host, port)
  }
  // Two tries: a single lost ping is not a dead host.
  const ms = (await pingOnce(target)) ?? (await pingOnce(target))
  return { ms, status: null, certDays: null, error: ms === null ? 'E_NO_PING' : null }
}

/**
 * Applies one check. Two failures in a row mark it down (from the first one); the first good check marks it
 * up again. Alerts: down and back up (not for a newly added one), and the certificate at 14/7/3/1/0 days.
 */
export function apply(m: Stored, r: Result, now: number): MonitorEvent[] {
  const events: MonitorEvent[] = []
  Object.assign(m, { checked: now, ms: r.ms, status: r.status, error: r.error })
  m.history = [...m.history.filter((h) => h.at > now - DAY), { at: now, ms: r.error ? null : r.ms }]
  if (r.error === null) {
    if (m.up === false) events.push(['monitorUp', String(now - (m.since ?? now))])
    if (m.up !== true) m.since = now
    m.up = true
    m.fails = 0
    m.failAt = null
    if (r.certDays !== null) {
      m.certDays = r.certDays
      const step = CERT_DAYS.find((d) => r.certDays! <= d) ?? null
      if (step !== null && step !== m.certWarned) events.push(['certExpiry', String(r.certDays)])
      m.certWarned = step
    }
  } else {
    m.fails++
    m.failAt ??= now
    if (m.fails >= 2 && m.up !== false) {
      if (m.up === true) events.push(['monitorDown', r.error])
      m.up = false
      m.since = m.failAt
    }
  }
  return events
}

/** The user's sites and servers, each checked every 1 or 5 minutes. */
export function createMonitors(dir: string, tell: (e: MonitorEvent, target: string) => void) {
  const file = path.join(dir, 'monitors.json')
  let list = readJson<Stored[]>(file, [])
  let dirty = false
  const running = new Set<string>()

  const save = () => {
    if (!dirty) return
    writeJson(file, list)
    dirty = false
  }

  async function check(m: Stored) {
    if (running.has(m.id)) return
    running.add(m.id)
    try {
      const r = await run(m.kind, m.target)
      // Removed while it was being checked.
      if (!list.includes(m)) return
      for (const e of apply(m, r, Date.now())) tell(e, m.target)
      dirty = true
    } finally {
      running.delete(m.id)
    }
  }

  const timer = setInterval(() => {
    const now = Date.now()
    for (const m of list) if (m.checked === null || now - m.checked >= (m.fails === 1 ? RETRY : m.every * 1000)) void check(m).catch(console.error)
  }, 5000)

  const view = (): MonitorState[] => list.map(({ fails: _f, failAt: _a, certWarned: _c, ...m }) => m)

  return {
    list: view,
    async add(kind: MonitorKind, raw: string, every: 60 | 300): Promise<MonitorState[]> {
      const target = cleanTarget(kind, raw)
      if (!target) throw new Error('E_MONITOR_TARGET')
      if (list.length >= MAX) throw new Error('E_MONITOR_MAX')
      if (list.some((m) => m.kind === kind && m.target === target)) throw new Error('E_MONITOR_EXISTS')
      const m: Stored = { id: randomUUID(), kind, target, every, up: null, ms: null, status: null, error: null, certDays: null, since: null, checked: null, history: [], fails: 0, failAt: null, certWarned: null }
      list = [...list, m]
      dirty = true
      await check(m)
      save()
      return view()
    },
    remove(id: string): MonitorState[] {
      list = list.filter((m) => m.id !== id)
      dirty = true
      save()
      return view()
    },
    async checkNow(id: string): Promise<MonitorState[]> {
      const m = list.find((x) => x.id === id)
      if (m) await check(m)
      return view()
    },
    save,
    stop() {
      clearInterval(timer)
      save()
    }
  }
}
