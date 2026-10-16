import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import type { Alert, AlertKind, BlocklistInfo, Connections, Outage } from '../shared/types'
import { createBlocklist } from './blocklist'
import type { MonitorEvent } from './monitors'
import { dayKey } from './usage'

const KEEP = 300
const FIREHOL = 'https://raw.githubusercontent.com/firehol/blocklist-ipsets/master/firehol_level1.netset'
/** Certificate checks, connectivity probes and update downloads are plain HTTP by design (their content is signed). */
const BENIGN_HTTP = /ocsp|crl|pki|ctldl\.windowsupdate|windowsupdate\.com|msftconnecttest|msftncsi|connectivitycheck|captive|detectportal|digicert|sectigo|comodoca|globalsign|lencr|letsencrypt|apple\.com\/(bag|ocsp)/i

type Rules = Record<AlertKind, boolean>

function readJson<T>(file: string): T | null {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8')) as T
  } catch {
    return null
  }
}

function writeJson(file: string, v: unknown) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(v))
  fs.renameSync(`${file}.tmp`, file)
}

/**
 * Security signals. The first check only records what is already there (the baseline), so a new
 * install does not start with a pile of alerts about programs that were always there.
 */
export function createAlerts(dir: string, emit: (a: Alert) => void) {
  const file = path.join(dir, 'alerts.json')
  const seenFile = path.join(dir, 'seen.json')
  const fireholFile = path.join(dir, 'firehol_level1.netset')
  let list = readJson<Alert[]>(file) ?? []
  const seen = readJson<{ baseline: boolean; apps: string[]; ports: string[] }>(seenFile) ?? { baseline: false, apps: [], ports: [] }
  const apps = new Set(seen.apps)
  const ports = new Set(seen.ports)
  /** Plain-text and blocklist alerts are raised once per app and target per day. */
  const once = new Set<string>()
  let own = createBlocklist('')
  let firehol = fs.existsSync(fireholFile) ? createBlocklist(fs.readFileSync(fireholFile, 'utf8')) : null

  function push(rules: Rules, kind: AlertKind, app: string, detail: string) {
    if (!rules[kind]) return
    const a: Alert = { id: randomUUID(), at: Date.now(), kind, app, detail, read: false }
    list = [a, ...list].slice(0, KEEP)
    writeJson(file, list)
    emit(a)
  }
  const first = (key: string) => !once.has(key) && !!once.add(key)
  const info = (): BlocklistInfo => ({
    own: own.size,
    firehol: firehol?.size ?? null,
    fireholAt: firehol ? fs.statSync(fireholFile).mtimeMs : null
  })

  return {
    /** New apps online, new ports open to the network, and connections to blocked addresses. */
    connections(c: Connections, rules: Rules) {
      let changed = !seen.baseline
      for (const x of c.conns) {
        if (x.scope !== 'internet' || !x.remoteIp) continue
        const app = x.title ?? x.app
        // "PID 1234" names change every run; they would look new each time.
        if (!app.startsWith('PID ') && !apps.has(app)) {
          apps.add(app)
          changed = true
          if (seen.baseline) push(rules, 'newApp', app, x.host ?? x.remoteIp)
        }
        if ((own.has(x.remoteIp) || firehol?.has(x.remoteIp)) && first(`b|${app}|${x.remoteIp}|${dayKey(Date.now())}`)) push(rules, 'blocklist', app, x.remoteIp)
      }
      for (const x of c.listening) {
        if (x.scope === 'loopback') continue
        const app = x.title ?? x.app
        const key = `${x.localPort}|${app}`
        if (app.startsWith('PID ') || ports.has(key)) continue
        ports.add(key)
        changed = true
        if (seen.baseline) push(rules, 'exposed', app, String(x.localPort))
      }
      if (changed) {
        seen.baseline = true
        seen.apps = [...apps]
        seen.ports = [...ports]
        writeJson(seenFile, seen)
      }
    },

    /** A connection drop of a minute or more, told once it is over (detail: "cause|milliseconds"). */
    outage(rules: Rules, o: Outage) {
      if (o.end !== null && o.end - o.start >= 60_000) push(rules, 'outage', o.network ?? '', `${o.cause}|${o.end - o.start}`)
    },

    /** The monthly data limit: 80 % or 100 % used (detail: "step|used|limit" in bytes). */
    dataCap(rules: Rules, step: number, network: string | null, used: number, limit: number) {
      push(rules, 'dataCap', network ?? '', `${step}|${used}|${limit}`)
    },

    /** A watched site or server went down, came back, or its certificate runs out soon. */
    monitor(rules: Rules, [kind, detail]: MonitorEvent, target: string) {
      push(rules, kind, target, detail)
    },

    /** A program sent something readable by anyone on the way (HTTP, FTP, Telnet). */
    plaintext(rules: Rules, app: string, target: string) {
      if (BENIGN_HTTP.test(target)) return
      if (first(`p|${app}|${target}|${dayKey(Date.now())}`)) push(rules, 'plain', app, target)
    },

    setOwnBlocklist(text: string) {
      own = createBlocklist(text)
    },

    blocklistInfo: info,

    /** Downloads FireHOL level 1 (~100 KB, addresses of known attackers and malware hosts). */
    async updateFirehol(): Promise<BlocklistInfo> {
      const res = await fetch(FIREHOL).catch(() => null)
      const text = res?.ok ? await res.text() : ''
      const next = text.length < 5_000_000 ? createBlocklist(text) : null
      if (!next || next.size < 100) throw new Error('E_BLOCKLIST_DOWNLOAD')
      fs.mkdirSync(dir, { recursive: true })
      fs.writeFileSync(fireholFile, text)
      firehol = next
      return info()
    },

    removeFirehol(): BlocklistInfo {
      fs.rmSync(fireholFile, { force: true })
      firehol = null
      return info()
    },

    list: () => list,
    markRead() {
      list = list.map((a) => ({ ...a, read: true }))
      writeJson(file, list)
    },
    clear() {
      list = []
      writeJson(file, list)
    }
  }
}
