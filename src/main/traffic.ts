import { execFile, spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { CaptureState, Packet, PacketBatch, PacketDetail, Proc, Snapshot, Traffic } from '../shared/types'
import { createCapture, filterError, parseDetail } from './capture'
import type { Collector } from './collectors/common'
import { run } from './exec'
import { createTraffic, summarize, type Prev } from './flows'
import { findTshark } from './tshark'

interface Deps {
  collector: Collector
  /** Cached process list; `freshProcesses` reads it again now. */
  processes: () => Promise<Proc[]>
  freshProcesses: () => Promise<Proc[]>
  /** IP → name from the OS DNS cache, for flows that started before the capture saw their lookup. */
  hosts: () => Promise<Map<string, string>>
  geo: (ip: string) => { country: string | null; org: string | null }
  publish: (t: Traffic) => void
  /** Folder for capture files; emptied when the app starts. */
  dir: string
  /** A program sent something unencrypted (HTTP request, FTP or Telnet connection). */
  plaintext: (app: string, target: string) => void
}

/** Packets kept for the packet list; the file keeps all of them. */
const KEEP = 5000
const BATCH = 2000

/** Watches the adapter the internet goes through with tshark and turns packets into per-app traffic. */
export function createTrafficWatch(deps: Deps, enabled: boolean) {
  const traffic = createTraffic()
  /** Every process seen this session, so traffic of programs that already quit keeps its name. */
  const known = new Map<number, Proc>()
  let state: CaptureState = 'off'
  let adapterId: string | null = null
  let prev: Prev = new Map()
  let prevAt = 0
  let busy = false
  let view: Traffic = { state, adapterId, since: null, apps: [], rx: 0, tx: 0 }
  let rows: Packet[] = []
  let session = 0
  /** Unencrypted requests, handled on the next tick when their program is known. */
  const plain: Packet[] = []

  const publish = () => {
    view = { ...view, state, adapterId }
    deps.publish(view)
  }
  const setState = (s: CaptureState) => {
    state = s
    publish()
  }

  /**
   * Matches new flows to the program holding their local port. Runs right after a flow starts, because
   * short-lived programs (curl, updaters) may be gone by the next tick; a pid not seen before gets the
   * process list read again at once, while it still runs.
   */
  async function resolveNow() {
    const sockets = await deps.collector.sockets()
    const owners = new Map<string, number>()
    // pid 0 is Windows' placeholder for closed sockets (TIME_WAIT), not an owner.
    for (const s of sockets) if (s.pid) owners.set(`${s.proto}|${s.localPort}`, s.pid)
    const found = traffic.resolve((transport, port) => owners.get(`${transport}|${port}`) ?? null)
    if (found.some((pid) => !known.has(pid))) for (const p of await deps.freshProcesses()) known.set(p.pid, p)
  }
  let soon: NodeJS.Timeout | undefined
  const onPacket = (p: Packet) => {
    rows.push(p)
    if (rows.length > KEEP + 1000) rows = rows.slice(-KEEP)
    if ((p.host || (p.transport === 'tcp' && (p.dport === 21 || p.dport === 23) && /\[SYN\]/.test(p.info))) && plain.length < 100) plain.push(p)
    if (traffic.add(p) && !soon)
      soon = setTimeout(() => {
        soon = undefined
        resolveNow().catch(console.error)
      }, 150)
  }

  let tshark: string | null = null
  let capture: ReturnType<typeof createCapture> | null = null
  const find = () => {
    tshark = findTshark()
    capture = tshark
      ? createCapture(tshark, deps.dir, {
          packet: onPacket,
          state: setState,
          session: () => {
            session++
            rows = []
          }
        })
      : null
    if (!capture) state = 'missing'
  }
  find()
  view = { ...view, state }

  async function tick() {
    if (busy || state !== 'on') return
    busy = true
    try {
      for (const p of await deps.processes()) known.set(p.pid, p)
      traffic.learn(await deps.hosts())
      await resolveNow()
      for (const p of plain.splice(0)) {
        const w = traffic.who(p)
        if (w.dir === 'out') deps.plaintext(appName(w.pid) ?? '?', p.host ? `http://${p.host}` : `${p.dport === 21 ? 'ftp' : 'telnet'}://${w.peer ?? p.dst}`)
      }
      const now = Date.now()
      traffic.prune(now)
      const { apps, next } = summarize(traffic.perPid(), known, deps.geo, prev, prevAt ? (now - prevAt) / 1000 : 0)
      prev = next
      prevAt = now
      const t = traffic.totals()
      view = { state, adapterId, since: t.since, apps, rx: t.rx, tx: t.tx }
      deps.publish(view)
    } catch (e) {
      console.error(e)
    } finally {
      busy = false
    }
  }
  const timer = setInterval(() => void tick(), 1000)

  /** Called with every adapter snapshot: (re)starts the capture when the internet adapter changes. */
  function follow(snap: Snapshot) {
    traffic.setLocal(snap.adapters.flatMap((a) => [...a.ipv4, ...a.ipv6].map((c) => c.split('/')[0])))
    const want = enabled && capture ? snap.defaultId : null
    if (want === adapterId) return
    adapterId = want
    traffic.reset()
    prev = new Map()
    prevAt = 0
    view = { state, adapterId, since: null, apps: [], rx: 0, tx: 0 }
    if (want) capture!.start(want)
    else {
      capture?.stop()
      setState(capture ? 'off' : 'missing')
    }
  }

  /** Reads the current capture file with tshark; resolves even on a non-zero exit (the file is still growing). */
  function read(args: string[]): Promise<{ out: string; err: string }> {
    const file = capture?.file()
    if (!tshark || !file) return Promise.reject(new Error('E_NO_CAPTURE'))
    return new Promise((resolve) =>
      execFile(tshark!, ['-r', file, '-n', ...args], { windowsHide: true, maxBuffer: 64 * 1024 * 1024, timeout: 60_000 }, (_e, out, err) => resolve({ out, err }))
    )
  }

  const appName = (pid: number | null) => {
    const p = pid !== null ? known.get(pid) : undefined
    return p ? (p.title ?? p.name) : null
  }

  return {
    follow,
    view: () => view,

    /** Packets after frame `after` of `wanted` session (all kept ones when the session changed), newest last. */
    packets(wanted: number, after: number): PacketBatch {
      const from = wanted === session ? after : 0
      const fresh = rows.filter((p) => p.n > from).slice(-BATCH)
      return {
        session,
        rows: fresh.map((p) => {
          const w = traffic.who(p)
          return { ...p, dir: w.dir, app: appName(w.pid), peer: w.peer }
        })
      }
    },

    /** Wireshark's full breakdown of one packet of the current session. */
    async detail(n: number): Promise<PacketDetail> {
      const { out } = await read(['-Y', `frame.number==${n}`, '-V', '-x'])
      return parseDetail(out)
    },

    /** Frame numbers matching a Wireshark display filter. Throws E_FILTER|<tshark's message>. */
    async filter(expr: string): Promise<number[]> {
      const { out, err } = await read(['-Y', expr, '-T', 'fields', '-e', 'frame.number'])
      if (!out.trim() && filterError(err)) throw new Error(`E_FILTER|${err.replace(/^tshark:\s*/, '').trim().slice(0, 300)}`)
      return out.split(/\r?\n/).filter(Boolean).map(Number)
    },

    /** A copy of the capture so far, safe to save or hand to Wireshark while capturing goes on. */
    snapshotFile(): string {
      const file = capture?.file()
      if (!file || !fs.existsSync(file)) throw new Error('E_NO_CAPTURE')
      const copy = path.join(deps.dir, `export-${Date.now()}.pcapng`)
      fs.copyFileSync(file, copy)
      return copy
    },

    /** Opens a capture file in Wireshark, installed next to tshark. */
    openInWireshark(file: string) {
      if (!tshark) throw new Error('E_NO_CAPTURE')
      const dir = path.dirname(tshark)
      const [cmd, args] =
        process.platform === 'win32'
          ? [path.join(dir, 'Wireshark.exe'), [file]]
          : process.platform === 'darwin'
            ? ['open', ['-a', 'Wireshark', file]]
            : [fs.existsSync(path.join(dir, 'wireshark')) ? path.join(dir, 'wireshark') : 'wireshark', [file]]
      const p = spawn(cmd as string, args as string[], { detached: true, stdio: 'ignore' })
      p.on('error', () => {})
      p.unref()
    },

    /** On also looks again for Wireshark (it may have been installed meanwhile) and retries a refused capture. */
    setEnabled(on: boolean, snap: Snapshot | null) {
      enabled = on
      if (on && !capture) find()
      capture?.stop()
      adapterId = null
      setState(capture ? 'off' : 'missing')
      if (on && snap) follow(snap)
    },

    stop() {
      clearInterval(timer)
      capture?.stop()
    }
  }
}

/**
 * Linux: lets this user capture by joining the "wireshark" group, through the desktop's own password
 * prompt (pkexec). Takes effect after logging out and in.
 */
export async function allowCaptureLinux(): Promise<void> {
  if (process.platform !== 'linux') throw new Error('E_UNSUPPORTED')
  await run('pkexec', ['usermod', '-aG', 'wireshark', os.userInfo().username], 120_000).catch(() => {
    throw new Error('E_ALLOW_CAPTURE')
  })
}
