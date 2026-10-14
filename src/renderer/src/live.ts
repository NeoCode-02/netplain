import { useSyncExternalStore } from 'react'
import type { Snapshot, Traffic } from '../../shared/types'

/** Throughput at one moment, in bits per second. */
export interface Point {
  t: number
  down: number
  up: number
}

export const KEEP = 60

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
}

let state: State = { snap: null, hist: new Map(), problem: null, traffic: null }
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
