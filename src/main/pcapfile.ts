import { spawn } from 'node:child_process'
import path from 'node:path'
import readline from 'node:readline'
import type { GeoLookup, PcapReport } from '../shared/types'


export const FIELDS = [
  'frame.time_epoch',
  'frame.len',
  'ip.src',
  'ip.dst',
  'ipv6.src',
  'ipv6.dst',
  '_ws.col.protocol',
  'dns.qry.name',
  'tls.handshake.extensions_server_name',
  'http.host',
  'tcp.flags.syn',
  'tcp.flags.ack',
  'tcp.dstport'
] as const

/** One source knocking on this many ports of one target (SYN, no answer expected) is a port scan. */
export const SCAN_PORTS = 100

const on = (v: string) => v === 'True' || v === '1'
const top = <T>(m: Map<string, T>, by: (v: T) => number, n: number) => [...m].sort((a, b) => by(b[1]) - by(a[1])).slice(0, n)

/** Adds up `tshark -T fields` lines (FIELDS, tab-separated) into the parts of a report. */
export function createSummary() {
  let packets = 0
  let bytes = 0
  let start: number | null = null
  let end: number | null = null
  const protocols = new Map<string, number>()
  const talkers = new Map<string, { packets: number; bytes: number }>()
  const names = new Map<string, number>()
  const syns = new Map<string, Set<number>>()
  const count = <K>(m: Map<K, number>, k: K) => m.set(k, (m.get(k) ?? 0) + 1)

  return {
    add(line: string) {
      const [time, len, s4, d4, s6, d6, proto, qname, sni, host, syn, ack, dport] = line.split('\t')
      if (!time) return
      const t = Math.round(Number(time) * 1000)
      const size = Number(len) || 0
      packets++
      bytes += size
      start = start === null ? t : Math.min(start, t)
      end = end === null ? t : Math.max(end, t)
      if (proto) count(protocols, proto)
      for (const ip of [s4 || s6, d4 || d6]) {
        if (!ip) continue
        const x = talkers.get(ip) ?? { packets: 0, bytes: 0 }
        x.packets++
        x.bytes += size
        talkers.set(ip, x)
      }
      for (const n of [qname, sni, host]) if (n) count(names, n.toLowerCase())
      if (on(syn) && !on(ack) && dport) {
        const key = `${s4 || s6}|${d4 || d6}`
        const ports = syns.get(key) ?? new Set<number>()
        ports.add(Number(dport))
        syns.set(key, ports)
      }
    },

    report(file: string, credentials: PcapReport['credentials'], geo: GeoLookup): PcapReport {
      return {
        file,
        packets,
        bytes,
        start,
        end,
        protocols: top(protocols, (v) => v, 12).map(([name, n]) => ({ name, packets: n })),
        talkers: top(talkers, (v) => v.bytes, 10).map(([ip, v]) => ({ ip, ...v, ...geo(ip) })),
        names: top(names, (v) => v, 30).map(([name, n]) => ({ name, count: n })),
        credentials,
        scans: [...syns]
          .filter(([, p]) => p.size >= SCAN_PORTS)
          .map(([k, p]) => {
            const [src, dst] = k.split('|')
            return { src, dst, ports: p.size }
          })
          .sort((a, b) => b.ports - a.ports)
      }
    }
  }
}

/**
 * tshark's credentials table: fixed-width columns under a "Packet  Protocol  Username  Info" header.
 * Only who and how; the password itself is never read.
 */
export function parseCredentials(text: string): PcapReport['credentials'] {
  const lines = text.split(/\r?\n/)
  const h = lines.findIndex((l) => /^Packet\s+Protocol\s+Username/.test(l))
  if (h < 0) return []
  const [p, u, i] = ['Protocol', 'Username', 'Info'].map((w) => lines[h].indexOf(w))
  const out: PcapReport['credentials'] = []
  for (const l of lines.slice(h + 1)) {
    if (l.startsWith('=')) break
    const n = Number(l.slice(0, p).trim())
    if (n > 0) out.push({ n, protocol: l.slice(p, u).trim(), user: l.slice(u, i).trim() })
  }
  return out
}

function tshark(file: string, args: string[], line: (l: string) => void): Promise<{ code: number | null; err: string }> {
  return new Promise((resolve, reject) => {
    const p = spawn(file, args, { windowsHide: true })
    let err = ''
    p.stderr.setEncoding('utf8').on('data', (d: string) => (err += d))
    readline.createInterface({ input: p.stdout }).on('line', line)
    p.on('error', reject)
    p.on('close', (code) => resolve({ code, err }))
  })
}

/** Reads a capture file once for the summary and once for credentials. Throws E_PCAP|reason. */
export async function analyzePcap(exe: string, file: string, geo: GeoLookup): Promise<PcapReport> {
  const sum = createSummary()
  let creds = ''
  // ponytail: two full reads; a multi-GB file takes minutes. One pass with -z alongside -T fields if that matters.
  const [main] = await Promise.all([
    tshark(exe, ['-r', file, '-n', '-T', 'fields', '-E', 'separator=\t', '-E', 'occurrence=f', ...FIELDS.flatMap((f) => ['-e', f])], sum.add),
    tshark(exe, ['-r', file, '-n', '-q', '-z', 'credentials'], (l) => (creds += `${l}\n`))
  ])
  const report = sum.report(path.basename(file), parseCredentials(creds), geo)
  if (main.code !== 0 && report.packets === 0) throw new Error(`E_PCAP|${main.err.replace(/^tshark:\s*/, '').trim().split(/\r?\n/)[0].slice(0, 200)}`)
  return report
}
