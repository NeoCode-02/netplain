import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import type { CaptureState, Packet } from '../shared/types'

// One tshark process per watched adapter; every packet comes back as one tab-separated line.
export const FIELDS = [
  'frame.number',
  'frame.time_epoch',
  'frame.len',
  'ip.src',
  'ip.dst',
  'ipv6.src',
  'ipv6.dst',
  'tcp.srcport',
  'tcp.dstport',
  'udp.srcport',
  'udp.dstport',
  '_ws.col.protocol',
  '_ws.col.info',
  'dns.qry.name',
  'dns.a',
  'dns.aaaa',
  'tls.handshake.extensions_server_name',
  'http.host'
] as const

/** Nested headers (ICMP errors, tunnels) give a field several values; the outer one comes first. */
const first = (v: string | undefined) => (v ? v.split(',')[0] : '')
const port = (v: string) => (v ? Number(first(v)) : null)

export function parseLine(line: string): Packet | null {
  const c = line.split('\t')
  if (c.length < FIELDS.length) return null
  const [n, time, len, ip4s, ip4d, ip6s, ip6d, tcps, tcpd, udps, udpd, proto, info, qname, a, aaaa, sni, host] = c
  const src = first(ip4s) || first(ip6s)
  const dst = first(ip4d) || first(ip6d)
  return {
    n: Number(n),
    t: Math.round(Number(time) * 1000),
    len: Number(len),
    src,
    dst,
    sport: port(tcps || udps),
    dport: port(tcpd || udpd),
    transport: tcps ? 'tcp' : udps ? 'udp' : 'other',
    proto,
    info,
    dnsQuery: first(qname) || null,
    dnsAnswers: [a, aaaa].filter(Boolean).flatMap((s) => s.split(',')),
    sni: first(sni) || null,
    host: first(host) || null
  }
}

/** tshark's interface name for an adapter id: Windows uses the NPF device path, others the interface name. */
export const ifaceFor = (adapterId: string) => (process.platform === 'win32' ? `\\Device\\NPF_${adapterId}` : adapterId)

export function classify(stderr: string): CaptureState {
  return /permission|denied|not permitted|access/i.test(stderr) ? 'denied' : 'error'
}

export function createCapture(tshark: string, on: { packet(p: Packet): void; state(s: CaptureState, detail?: string): void }) {
  let proc: ChildProcessWithoutNullStreams | null = null
  let retry: NodeJS.Timeout | undefined
  let wanted: string | null = null

  function start(adapterId: string) {
    stop()
    wanted = adapterId
    on.state('starting')
    // -l: flush every line; -n: no name lookups (we resolve names ourselves); -Q: only real errors on stderr;
    // -M: reset dissector state every 100k packets so a long session does not keep growing.
    const args = ['-i', ifaceFor(adapterId), '-l', '-n', '-Q', '-M', '100000', '-T', 'fields', '-E', 'occurrence=a', '-E', 'aggregator=,', ...FIELDS.flatMap((f) => ['-e', f])]
    const p = spawn(tshark, args, { windowsHide: true })
    proc = p
    let buf = ''
    let err = ''
    let started = false
    p.stdout.setEncoding('utf8')
    p.stdout.on('data', (d: string) => {
      if (!started) {
        started = true
        on.state('on')
      }
      buf += d
      let i
      while ((i = buf.indexOf('\n')) >= 0) {
        const pkt = parseLine(buf.slice(0, i).replace(/\r$/, ''))
        buf = buf.slice(i + 1)
        if (pkt) on.packet(pkt)
      }
    })
    p.stderr.on('data', (d) => (err += d))
    // A quiet network prints nothing for a while; after 3 s without an error the capture is running.
    const ok = setTimeout(() => proc === p && !started && on.state('on'), 3000)
    p.on('error', (e) => {
      clearTimeout(ok)
      on.state('error', e.message)
    })
    p.on('exit', () => {
      clearTimeout(ok)
      if (proc !== p) return
      proc = null
      const state = classify(err)
      on.state(state, err.trim().slice(0, 500))
      // A refused capture will be refused again; anything else gets another try.
      if (state !== 'denied' && wanted === adapterId) retry = setTimeout(() => start(adapterId), 5000)
    })
  }

  function stop() {
    clearTimeout(retry)
    wanted = null
    if (proc) {
      const p = proc
      proc = null
      p.kill()
    }
  }

  return { start, stop, adapter: () => wanted }
}
