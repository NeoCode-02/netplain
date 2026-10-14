import type { Adapter, Neighbor, Proc, Socket } from '../../shared/types'

/** One per OS (win.ts, mac.ts, linux.ts); only the running OS's is used. */
export interface Collector {
  /** Calls `on` with every adapter about once a second until the returned function is called. */
  watch(on: (adapters: Adapter[]) => void, onError: (e: unknown) => void): () => void
  /** The OS neighbour (ARP) table: devices this computer has talked to on the local network. */
  neighbors(): Promise<Neighbor[]>
  /** Open TCP/UDP sockets with their process id (only your own processes on macOS/Linux without root). */
  sockets(): Promise<Socket[]>
  processes(): Promise<Proc[]>
  /** IP → name pairs from the OS DNS cache; empty where the OS has no readable cache. */
  dnsCache(): Promise<[string, string][]>
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

/** "192.168.0.2:443", "[fe80::1%3]:443", "*:5353", "*:*" → ip + port ('*' ip = any address, port 0 = none). */
export function hostPort(s: string): { ip: string; port: number } | null {
  const m = /^\[?(.*?)\]?:(\d+|\*)$/.exec(s)
  if (!m) return null
  const ip = m[1].replace(/%.*/, '')
  return { ip: ip === '*' ? '0.0.0.0' : ip, port: m[2] === '*' ? 0 : Number(m[2]) }
}

const STATES: Record<string, string> = {
  LISTEN: 'listen',
  LISTENING: 'listen',
  ESTABLISHED: 'established',
  TIME_WAIT: 'time_wait',
  CLOSE_WAIT: 'close_wait',
  SYN_SENT: 'syn_sent',
  SYN_RECEIVED: 'syn_received',
  SYN_RECV: 'syn_received',
  FIN_WAIT_1: 'fin_wait',
  FIN_WAIT1: 'fin_wait',
  FIN_WAIT_2: 'fin_wait',
  FIN_WAIT2: 'fin_wait',
  LAST_ACK: 'last_ack',
  CLOSING: 'closing',
  CLOSED: 'closed'
}

/** Some Windows languages translate netstat's states; then the shape decides: a peer means connected. */
export const tcpState = (raw: string, hasPeer: boolean) => STATES[raw.toUpperCase()] ?? (hasPeer ? 'established' : 'listen')
