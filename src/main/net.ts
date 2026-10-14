import dgram from 'node:dgram'
import type { Neighbor } from '../shared/types'

/** The local IPv4 the OS would use to reach the internet. Connecting a UDP socket only picks a route; nothing is sent. */
export function internetIp(): Promise<string | null> {
  return new Promise((resolve) => {
    const s = dgram.createSocket('udp4')
    s.once('error', () => {
      s.close()
      resolve(null)
    })
    s.connect(53, '1.1.1.1', () => {
      const ip = s.address().address
      s.close()
      resolve(ip)
    })
  })
}

export const isPrivate = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(ip)

/** Multicast and broadcast entries the OS keeps in its table are not devices. */
export function realDevices(list: Neighbor[]): Neighbor[] {
  return list.filter((n) => {
    const first = Number(n.ip.split('.')[0])
    return n.mac && n.mac !== 'ff:ff:ff:ff:ff:ff' && !n.mac.startsWith('01:00:5e') && !n.mac.startsWith('33:33') && first < 224 && !n.ip.endsWith('.255')
  })
}

/**
 * Sends one byte to the discard port of every host in the /24 around `ip`, so the OS learns their
 * MAC addresses and lists them in its neighbour table. Only on private networks.
 */
export async function sweep(ip: string): Promise<void> {
  if (!isPrivate(ip)) throw new Error('E_NOT_PRIVATE')
  const base = ip.split('.').slice(0, 3).join('.')
  const s = dgram.createSocket('udp4')
  s.on('error', () => {})
  const one = Buffer.from([0])
  await Promise.all(Array.from({ length: 254 }, (_, i) => new Promise<void>((done) => s.send(one, 9, `${base}.${i + 1}`, () => done()))))
  // ARP replies arrive within a few hundred ms on a LAN; slow Wi-Fi clients may need longer.
  await new Promise((r) => setTimeout(r, 2000))
  s.close()
}
