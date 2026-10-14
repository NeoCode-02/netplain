import os from 'node:os'
import type { CaptureState, Packet, Proc, Snapshot, Traffic } from '../shared/types'
import { createCapture } from './capture'
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
}

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
    if (traffic.add(p) && !soon)
      soon = setTimeout(() => {
        soon = undefined
        resolveNow().catch(console.error)
      }, 150)
  }

  let capture: ReturnType<typeof createCapture> | null = null
  const find = () => {
    const tshark = findTshark()
    capture = tshark ? createCapture(tshark, { packet: onPacket, state: setState }) : null
    if (!capture) state = 'missing'
  }
  find()

  async function tick() {
    if (busy || state !== 'on') return
    busy = true
    try {
      for (const p of await deps.processes()) known.set(p.pid, p)
      traffic.learn(await deps.hosts())
      await resolveNow()
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

  return {
    follow,
    view: () => view,
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
