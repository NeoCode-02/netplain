import { useSyncExternalStore } from 'react'
import type { Alert, Snapshot, Traffic } from '../../shared/types'
import { getLang, LANGS } from './i18n'

/** Throughput at one moment, in bits per second. */
export interface Point {
  t: number
  down: number
  up: number
}

export const KEEP = 60

/** Window event asking the app to open a page (detail: the page). */
export const GO = 'netplain:go'

/** Adds one throughput point per adapter from two consecutive snapshots. A counter that went down was reset: 0, not negative. */
export function advance(prev: Snapshot | null, next: Snapshot, hist: Map<string, Point[]>): Map<string, Point[]> {
  const out = new Map<string, Point[]>()
  const dt = prev ? (next.at - prev.at) / 1000 : 0
  for (const a of next.adapters) {
    const before = hist.get(a.id) ?? []
    const p = prev?.adapters.find((x) => x.id === a.id)
    if (!p || dt <= 0) {
      out.set(a.id, before)
      continue
    }
    const point = { t: next.at, down: (Math.max(0, a.rx - p.rx) * 8) / dt, up: (Math.max(0, a.tx - p.tx) * 8) / dt }
    out.set(a.id, [...before.slice(-(KEEP - 1)), point])
  }
  return out
}

interface State {
  snap: Snapshot | null
  hist: Map<string, Point[]>
  problem: string | null
  traffic: Traffic | null
  alerts: Alert[]
}

let state: State = { snap: null, hist: new Map(), problem: null, traffic: null, alerts: [] }
const subs = new Set<() => void>()
let started = false

function set(next: Partial<State>) {
  state = { ...state, ...next }
  subs.forEach((f) => f())
}

export function push(s: Snapshot) {
  set({ hist: advance(state.snap, s, state.hist), snap: s })
}

/** One app-wide subscription, so history survives switching pages. */
function start() {
  if (started) return
  started = true
  window.netplain.onSnapshot(push)
  window.netplain.onProblem((problem) => set({ problem }))
  window.netplain.onTraffic((traffic) => set({ traffic }))
  window.netplain.onAlert((a) => {
    set({ alerts: [a, ...state.alerts] })
    // The OS notification, in the language the app is shown in.
    const [title, body] = alertText(a)
    // Clicking it opens the app (it may be hidden in the tray) on the Alerts page.
    new Notification(title, { body, silent: false }).onclick = () => {
      void window.netplain.showWindow()
      window.dispatchEvent(new CustomEvent(GO, { detail: 'alerts' }))
    }
  })
  void window.netplain.alerts().then((alerts) => set({ alerts }))
  void window.netplain.snapshot().then((s) => s && !state.snap && push(s))
  void window.netplain.traffic().then((traffic) => traffic && !state.traffic && set({ traffic }))
}

export function useLive(): State {
  start()
  return useSyncExternalStore(
    (f) => {
      subs.add(f)
      return () => subs.delete(f)
    },
    () => state
  )
}

/** Title and explanation of an alert in the current language. */
export function alertText(a: Alert): [string, string] {
  const t = LANGS[getLang()]
  return t.alerts.say[a.kind](a.app === '?' ? t.alerts.unknownApp : a.app, a.detail)
}

export function setAlerts(alerts: Alert[]) {
  set({ alerts })
}
