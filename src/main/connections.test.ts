import { expect, it } from 'vitest'
import type { Socket } from '../shared/types'
import { join, scope } from './connections'

it('tells this computer, the local network and the internet apart', () => {
  const ips = ['127.0.0.1', '::1', '192.168.0.1', '10.2.3.4', '172.20.0.1', '169.254.1.1', '224.0.0.251', 'fe80::1', 'fd00::1', '8.8.8.8', '2a00:1450::200e']
  expect(ips.map(scope)).toEqual(['loopback', 'loopback', 'local', 'local', 'local', 'local', 'local', 'local', 'local', 'internet', 'internet'])
})

it('joins sockets with processes, names and places', () => {
  const sock: Socket = { proto: 'tcp', localIp: '192.168.0.2', localPort: 50000, remoteIp: '8.8.8.8', remotePort: 443, state: 'established', pid: 10 }
  const r = join(
    [
      sock,
      { ...sock, remoteIp: '192.168.0.1', pid: 99 },
      { ...sock, localIp: '0.0.0.0', localPort: 445, remoteIp: null, remotePort: null, state: 'listen', pid: 4 },
      { ...sock, proto: 'udp', localIp: '0.0.0.0', localPort: 5353, remoteIp: null, remotePort: null, state: 'bound' }
    ],
    [{ pid: 10, name: 'chrome', path: 'C:\\chrome.exe', title: 'Google Chrome' }],
    new Map([['8.8.8.8', 'dns.google']]),
    (ip) => (ip === '8.8.8.8' ? { country: 'US', org: 'Google LLC' } : { country: 'XX', org: 'wrong' })
  )
  expect(r.conns[0]).toMatchObject({ app: 'chrome', title: 'Google Chrome', host: 'dns.google', country: 'US', org: 'Google LLC', scope: 'internet' })
  expect(r.conns[1]).toMatchObject({ app: 'PID 99', country: null, org: null, scope: 'local' })
  expect(r.listening).toHaveLength(1)
  expect(r.listening[0]).toMatchObject({ app: 'PID 4', localPort: 445, scope: 'local' })
})
