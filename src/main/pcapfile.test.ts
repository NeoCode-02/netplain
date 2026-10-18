import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { analyzePcap, createSummary, parseCredentials, SCAN_PORTS } from './pcapfile'
import { findTshark } from './tshark'

const noGeo = () => ({ country: null, org: null })

/** A classic pcap of Ethernet/IPv4/TCP frames; sequence numbers run on per flow, as tshark expects. */
function pcap(frames: [src: string, dst: string, sport: number, dport: number, flags: number, payload?: string][]) {
  const seq = new Map<string, number>()
  const ip = (s: string) => Buffer.from(s.split('.').map(Number))
  const parts = [Buffer.alloc(24)]
  parts[0].writeUInt32LE(0xa1b2c3d4, 0)
  parts[0].writeUInt16LE(2, 4)
  parts[0].writeUInt16LE(4, 6)
  parts[0].writeUInt32LE(65535, 16)
  parts[0].writeUInt32LE(1, 20)
  frames.forEach(([src, dst, sport, dport, flags, payload = ''], i) => {
    const data = Buffer.from(payload, 'latin1')
    const flow = `${src}:${sport}>${dst}:${dport}`
    const s = seq.get(flow) ?? 1
    seq.set(flow, s + data.length)
    const tcp = Buffer.alloc(20)
    tcp.writeUInt16BE(sport, 0)
    tcp.writeUInt16BE(dport, 2)
    tcp.writeUInt32BE(s, 4)
    tcp.writeUInt32BE(flags & 0x10 ? 1 : 0, 8)
    tcp[12] = 5 << 4
    tcp[13] = flags
    tcp.writeUInt16BE(65535, 14)
    const ipv4 = Buffer.alloc(20)
    ipv4[0] = 0x45
    ipv4.writeUInt16BE(40 + data.length, 2)
    ipv4[8] = 64
    ipv4[9] = 6
    ip(src).copy(ipv4, 12)
    ip(dst).copy(ipv4, 16)
    const frame = Buffer.concat([Buffer.from([2, 0, 0x5e, 0, 0, 1, 2, 0, 0x5e, 0, 0, 2, 8, 0]), ipv4, tcp, data])
    const rec = Buffer.alloc(16)
    rec.writeUInt32LE(1_760_000_000 + i, 0)
    rec.writeUInt32LE(frame.length, 8)
    rec.writeUInt32LE(frame.length, 12)
    parts.push(rec, frame)
  })
  return Buffer.concat(parts)
}

const SYN = 0x02
const DATA = 0x18 // PSH, ACK

describe('capture file report', () => {
  it('adds up protocols, talkers, names and finds a port scan', () => {
    const s = createSummary()
    s.add('1760000000.5\t135\t192.168.1.10\t203.0.113.80\t\t\tHTTP\t\t\tcam.example\tFalse\tTrue\t80')
    s.add('1760000001.0\t90\t192.168.1.10\t192.168.1.1\t\t\tDNS\tExample.COM\t\t\t\t\t')
    for (let p = 1; p <= SCAN_PORTS; p++) s.add(`1760000002\t54\t198.51.100.66\t192.168.1.10\t\t\tTCP\t\t\t\tTrue\tFalse\t${p}`)
    // Answers (SYN+ACK) and a few probes elsewhere are not a scan.
    s.add('1760000003\t54\t192.168.1.10\t198.51.100.66\t\t\tTCP\t\t\t\tTrue\tTrue\t40000')
    const r = s.report('x.pcap', [], () => ({ country: 'UZ', org: 'Example' }))
    expect(r).toMatchObject({ file: 'x.pcap', packets: 103, start: 1_760_000_000_500, end: 1_760_000_003_000 })
    expect(r.protocols).toEqual([
      { name: 'TCP', packets: 101 },
      { name: 'HTTP', packets: 1 },
      { name: 'DNS', packets: 1 }
    ])
    expect(r.talkers[0]).toEqual({ ip: '192.168.1.10', packets: 103, bytes: 135 + 90 + 54 * 101, country: 'UZ', org: 'Example' })
    expect(r.names).toEqual([
      { name: 'cam.example', count: 1 },
      { name: 'example.com', count: 1 }
    ])
    expect(r.scans).toEqual([{ src: '198.51.100.66', dst: '192.168.1.10', ports: SCAN_PORTS }])
  })

  it('reads who logged in how from the credentials table, never the password', () => {
    const text = [
      '===================================================================',
      'Packet     Protocol         Username         Info            ',
      '------     --------         --------         --------',
      '1          HTTP basic auth  admin                            ',
      '3          FTP              bob              Username in packet: 2',
      '==================================================================='
    ].join('\r\n')
    expect(parseCredentials(text)).toEqual([
      { n: 1, protocol: 'HTTP basic auth', user: 'admin' },
      { n: 3, protocol: 'FTP', user: 'bob' }
    ])
    expect(parseCredentials('')).toEqual([])
  })

  const tshark = findTshark()
  // Four tshark starts: slow while the rest of the suite runs alongside, hence the longer limit.
  it.skipIf(!tshark)('reads a real file with tshark (Wireshark installed)', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'np-pcap-'))
    const file = path.join(dir, 'test.pcap')
    fs.writeFileSync(
      file,
      pcap([
        ['192.168.1.10', '203.0.113.80', 50000, 80, DATA, 'GET /admin HTTP/1.1\r\nHost: cam.example\r\nAuthorization: Basic YWRtaW46c2VjcmV0\r\n\r\n'],
        ['192.168.1.10', '203.0.113.21', 50001, 21, DATA, 'USER bob\r\n'],
        ['192.168.1.10', '203.0.113.21', 50001, 21, DATA, 'PASS hunter2\r\n'],
        ...Array.from({ length: 150 }, (_, i): [string, string, number, number, number] => ['198.51.100.66', '192.168.1.10', 40000, i + 1, SYN])
      ])
    )
    const r = await analyzePcap(tshark!, file, noGeo)
    expect(r.packets).toBe(153)
    expect(r.names).toContainEqual({ name: 'cam.example', count: 1 })
    expect(r.credentials.map((c) => [c.protocol, c.user])).toEqual(expect.arrayContaining([['HTTP basic auth', 'admin']]))
    expect(r.credentials.some((c) => /ftp/i.test(c.protocol) && c.user === 'bob')).toBe(true)
    expect(JSON.stringify(r)).not.toMatch(/hunter2|secret/)
    expect(r.scans).toEqual([{ src: '198.51.100.66', dst: '192.168.1.10', ports: 150 }])

    fs.writeFileSync(file, 'not a capture')
    await expect(analyzePcap(tshark!, file, noGeo)).rejects.toThrow(/^E_PCAP\|/)
  }, 30_000)
})
