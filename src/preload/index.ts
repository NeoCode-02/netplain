import { contextBridge, ipcRenderer } from 'electron'
import { CHANNELS, type Api } from '../shared/api'
import type { Alert, Snapshot, Traffic } from '../shared/types'

type Async<T> = { [K in keyof T]: T[K] extends (...a: infer A) => infer R ? (...a: A) => Promise<Awaited<R>> : never }

// Record (not an array) so TypeScript fails when a handler is missing here.
const names: Record<keyof Api, true> = {
  appInfo: true,
  getSettings: true,
  saveSettings: true,
  snapshot: true,
  neighbors: true,
  scan: true,
  openUrl: true,
  connections: true,
  appIcon: true,
  geoInfo: true,
  geoUpdate: true,
  traffic: true,
  retryCapture: true,
  allowCapture: true,
  packets: true,
  packetDetail: true,
  packetFilter: true,
  savePackets: true,
  openInWireshark: true,
  usage: true,
  alerts: true,
  markAlertsRead: true,
  clearAlerts: true,
  blocklistInfo: true,
  updateFirehol: true,
  removeFirehol: true,
  ping: true,
  trace: true,
  lookup: true,
  checkPort: true,
  publicIp: true,
  diagnose: true,
  flushDns: true,
  renewIp: true,
  restartAdapter: true,
  security: true,
  fixFinding: true
}

const api = Object.fromEntries(Object.keys(names).map((n) => [n, (...a: unknown[]) => ipcRenderer.invoke(n, ...a)])) as Async<Api>

function listen<A extends unknown[]>(channel: string, cb: (...a: A) => void) {
  const fn = (_e: unknown, ...a: unknown[]) => cb(...(a as A))
  ipcRenderer.on(channel, fn)
  return () => {
    ipcRenderer.removeListener(channel, fn)
  }
}

const bridge = {
  ...api,
  onSnapshot: (cb: (s: Snapshot) => void) => listen(CHANNELS.snapshot, cb),
  /** An error code while data can't be read (null once it can again). */
  onProblem: (cb: (code: string | null) => void) => listen(CHANNELS.problem, cb),
  onTraffic: (cb: (t: Traffic) => void) => listen(CHANNELS.traffic, cb),
  onAlert: (cb: (a: Alert) => void) => listen(CHANNELS.alert, cb)
}
export type Bridge = typeof bridge

contextBridge.exposeInMainWorld('netplain', bridge)
