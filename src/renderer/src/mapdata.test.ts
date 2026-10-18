import { describe, expect, it } from 'vitest'
import type { Conn, Connections, Hop, Traffic } from '../../shared/types'
import { byCountry, routeOf } from './mapdata'

const conn = (o: Partial<Conn>): Conn =>
  ({ proto: 'tcp', localIp: '192.168.1.10', localPort: 50000, remoteIp: '203.0.113.5', remotePort: 443, state: 'established', pid: 1, app: 'chrome', title: 'Google Chrome', path: null, host: null, country: 'DE', org: 'Hetzner', scope: 'internet', ...o }) as Conn
const data = (conns: Conn[], listening: Conn[] = []): Connections => ({ at: 0, conns, listening })

describe('traffic by country', () => {
  it('counts connections per country and tells who started them', () => {
    const c = data(
      [
        conn({}),
        conn({ remoteIp: '203.0.113.6', host: 'cdn.example' }),
        conn({ localPort: 22, remoteIp: '198.51.100.9', country: 'NL', app: 'sshd', title: null }),
        conn({ scope: 'local', remoteIp: '192.168.1.1', country: null }),
        conn({ remoteIp: '198.51.100.50', country: null })
      ],
      [conn({ localPort: 22, remoteIp: null, state: 'listen' })]
    )
    expect(byCountry(c, null)).toEqual([
      {
        country: 'DE',
        rx: null,
        tx: null,
        conns: 2,
        inbound: 0,
        spots: [
          { ip: '203.0.113.5', name: '203.0.113.5', app: 'Google Chrome', org: 'Hetzner' },
          { ip: '203.0.113.6', name: 'cdn.example', app: 'Google Chrome', org: 'Hetzner' }
        ]
      },
      { country: 'NL', rx: null, tx: null, conns: 1, inbound: 1, spots: [{ ip: '198.51.100.9', name: '198.51.100.9', app: 'sshd', org: 'Hetzner' }] }
    ])
  })

  it('adds the bytes the traffic watch saw, and orders by them', () => {
    const traffic = {
      state: 'on',
      apps: [
        { key: 't', app: 'telegram', title: 'Telegram', places: [{ name: 'api.example', ip: '149.154.167.1', rx: 5000, tx: 900, org: 'Telegram', country: 'NL' }] },
        { key: 'c', app: 'chrome', title: null, places: [{ name: '203.0.113.5', ip: '203.0.113.5', rx: 100, tx: 50, org: 'Hetzner', country: 'DE' }] }
      ]
    } as unknown as Traffic
    const flows = byCountry(data([conn({})]), traffic)
    expect(flows.map((f) => [f.country, f.rx, f.tx, f.conns])).toEqual([
      ['NL', 5000, 900, 0],
      ['DE', 100, 50, 1]
    ])
    // The same address from both sources is listed once.
    expect(flows[1].spots).toHaveLength(1)
    expect(byCountry(null, { ...traffic, state: 'off' })).toEqual([])
  })
})

describe('route by country', () => {
  it('groups routers by country in order and skips silent and unplaced hops', () => {
    const hop = (n: number, ip: string | null, country: string | null, org: string | null = null): Hop => ({ n, ip, ms: ip ? n * 10 : null, org, country })
    expect(
      routeOf([hop(1, '192.168.1.1', null), hop(2, '100.64.0.1', null), hop(3, '213.230.1.1', 'UZ', 'Uzbektelekom'), hop(4, '213.230.1.2', 'UZ', 'Uzbektelekom'), hop(5, null, null), hop(6, '80.81.192.1', 'DE', 'DE-CIX'), hop(7, '8.8.8.8', 'US', 'Google')])
    ).toEqual([
      {
        country: 'UZ',
        hops: [
          { n: 3, ip: '213.230.1.1', org: 'Uzbektelekom', ms: 30 },
          { n: 4, ip: '213.230.1.2', org: 'Uzbektelekom', ms: 40 }
        ]
      },
      { country: 'DE', hops: [{ n: 6, ip: '80.81.192.1', org: 'DE-CIX', ms: 60 }] },
      { country: 'US', hops: [{ n: 7, ip: '8.8.8.8', org: 'Google', ms: 70 }] }
    ])
  })
})
