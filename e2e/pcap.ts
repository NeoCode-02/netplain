// Capture files for tests (the unit tests and the e2e run): Node reads this file with its type stripping.

export type Frame = [src: string, dst: string, sport: number, dport: number, flags: number, payload?: string]
export const SYN = 0x02
/** PSH + ACK: a segment carrying data. */
export const DATA = 0x18

/** A classic pcap of Ethernet/IPv4/TCP frames; sequence numbers run on per flow, as tshark expects. */
export function pcap(frames: Frame[]): Buffer {
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

/** One HTTP request carrying a Basic login (admin / a password that must never show up anywhere). */
export const LOGIN: Frame = ['192.168.1.10', '203.0.113.80', 50000, 80, DATA, 'GET /admin HTTP/1.1\r\nHost: cam.example\r\nAuthorization: Basic YWRtaW46c2VjcmV0\r\n\r\n']
