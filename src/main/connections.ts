import type { Conn, Connections, Proc, Scope, Socket } from '../shared/types'

/** Where an address is: this computer, the local network, or the internet. */
export function scope(ip: string): Scope {
  if (/^127\./.test(ip) || ip === '::1') return 'loopback'
  if (ip.includes(':')) return /^(fe[89ab]|f[cd]|ff)/i.test(ip) ? 'local' : 'internet'
  const [a, b] = ip.split('.').map(Number)
  const local = a === 10 || (a === 192 && b === 168) || (a === 172 && b >= 16 && b <= 31) || (a === 169 && b === 254) || a >= 224 || a === 0
  return local ? 'local' : 'internet'
}

type Lookup = (ip: string) => { country: string | null; org: string | null }

/** Joins sockets with their process, the DNS name and the location of the far end. */
export function join(sockets: Socket[], procs: Proc[], hosts: Map<string, string>, geo: Lookup): Connections {
  const byPid = new Map(procs.map((p) => [p.pid, p]))
  const conns: Conn[] = []
  const listening: Conn[] = []
  for (const s of sockets) {
    const p = s.pid !== null ? byPid.get(s.pid) : undefined
    const base = { ...s, app: p?.name ?? (s.pid ? `PID ${s.pid}` : 'System'), title: p?.title ?? null, path: p?.path ?? null }
    if (s.remoteIp) {
      const where = scope(s.remoteIp)
      conns.push({ ...base, host: hosts.get(s.remoteIp) ?? null, ...(where === 'internet' ? geo(s.remoteIp) : { country: null, org: null }), scope: where })
    } else if (s.state === 'listen') {
      listening.push({ ...base, host: null, country: null, org: null, scope: scope(s.localIp) === 'loopback' ? 'loopback' : 'local' })
    }
  }
  return { at: Date.now(), conns, listening }
}
