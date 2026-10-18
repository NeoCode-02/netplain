import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import type { CaptureState, DetailNode, Packet, PacketDetail } from '../shared/types'

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
const ifaceFor = (adapterId: string) => (process.platform === 'win32' ? `\\Device\\NPF_${adapterId}` : adapterId)

export function classify(stderr: string): CaptureState {
  return /permission|denied|not permitted|access/i.test(stderr) ? 'denied' : 'error'
}

/** Captures into files under `dir`; each new file starts a new session (frame numbers restart at 1). */
export function createCapture(tshark: string, dir: string, on: { packet(p: Packet): void; state(s: CaptureState, detail?: string): void; session(file: string): void }) {
  let proc: ChildProcessWithoutNullStreams | null = null
  let retry: NodeJS.Timeout | undefined
  let wanted: string | null = null
  let file: string | null = null

  function start(adapterId: string) {
    stop()
    wanted = adapterId
    on.state('starting')
    run(adapterId)
  }

  function run(adapterId: string) {
    fs.mkdirSync(dir, { recursive: true })
    const f = path.join(dir, `capture-${Date.now()}.pcapng`)
    file = f
    on.session(f)
    // -l: flush every line; -n: no name lookups (we resolve names ourselves); -Q: only real errors on stderr;
    // -M: reset dissector state every 100k packets so a long session does not keep growing;
    // -w/-P: keep the packets in a file (for details and export) and still print each one;
    // -a filesize: stop at ~100 MB, after which a fresh file is started.
    const args = [
      ...['-i', ifaceFor(adapterId), '-l', '-n', '-Q', '-M', '100000', '-w', f, '-P', '-a', 'filesize:100000'],
      ...['-T', 'fields', '-E', 'occurrence=a', '-E', 'aggregator=,', ...FIELDS.flatMap((x) => ['-e', x])]
    ]
    const p = spawn(tshark, args, { windowsHide: true })
    proc = p
    // The file goes with its process (Windows keeps it locked until tshark exits).
    p.once('exit', () => fs.rm(f, { force: true }, () => {}))
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
    p.on('exit', (code) => {
      clearTimeout(ok)
      if (proc !== p) return
      proc = null
      // The size limit ends tshark normally: carry on in a fresh file.
      if (code === 0 && wanted === adapterId) return run(adapterId)
      const state = classify(err)
      on.state(state, err.trim().slice(0, 500))
      // A refused capture will be refused again; anything else gets another try.
      if (state !== 'denied' && wanted === adapterId) retry = setTimeout(() => wanted === adapterId && run(adapterId), 5000)
    })
  }

  function stop() {
    clearTimeout(retry)
    wanted = null
    file = null
    if (proc) {
      const p = proc
      proc = null
      p.kill()
    }
  }

  return { start, stop, adapter: () => wanted, file: () => file }
}

/** `tshark -V -x` output: the details tree (4 spaces per level), then the hex dump. */
export function parseDetail(text: string): PacketDetail {
  const lines = text.replace(/\r/g, '').split('\n')
  const hexAt = lines.findIndex((l) => /^[0-9a-f]{4} {2}[0-9a-f]{2} /.test(l))
  const tree: DetailNode[] = []
  const stack: { depth: number; list: DetailNode[] }[] = [{ depth: -1, list: tree }]
  for (const l of (hexAt >= 0 ? lines.slice(0, hexAt) : lines).filter((x) => x.trim())) {
    const depth = Math.floor((l.length - l.trimStart().length) / 4)
    const node: DetailNode = { text: l.trim(), children: [] }
    while (stack.length > 1 && stack.at(-1)!.depth >= depth) stack.pop()
    stack.at(-1)!.list.push(node)
    stack.push({ depth, list: node.children })
  }
  return { tree, hex: hexAt >= 0 ? lines.slice(hexAt).join('\n').trim() : '' }
}

/** A display-filter mistake (as opposed to tshark complaining about a file still being written). */
export const filterError = (stderr: string) => /filter|expression|syntax|valid|neither a field|unexpected/i.test(stderr)
