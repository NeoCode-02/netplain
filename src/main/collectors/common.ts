import type { Adapter, Neighbor } from '../../shared/types'

/** One per OS (win.ts, mac.ts, linux.ts); only the running OS's is used. */
export interface Collector {
  /** Calls `on` with every adapter about once a second until the returned function is called. */
  watch(on: (adapters: Adapter[]) => void, onError: (e: unknown) => void): () => void
  /** The OS neighbour (ARP) table: devices this computer has talked to on the local network. */
  neighbors(): Promise<Neighbor[]>
}

/** `watch` for OSes read by polling; a slow tick is never overlapped by the next one. */
export function poll(snapshot: () => Promise<Adapter[]>): Collector['watch'] {
  return (on, onError) => {
    let stopped = false
    let busy = false
    const tick = () => {
      if (busy) return
      busy = true
      snapshot()
        .then((a) => !stopped && on(a))
        .catch(onError)
        .finally(() => (busy = false))
    }
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      stopped = true
      clearInterval(timer)
    }
  }
}
