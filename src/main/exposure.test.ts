import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { internetDb, locationOf, natOf, parseInternetDb, readGateway, wanServices } from './exposure'

const DESC = `<?xml version="1.0"?>
<root xmlns="urn:schemas-upnp-org:device-1-0"><device><friendlyName>Home &amp; Router</friendlyName><deviceList><device><deviceList><device>
<serviceList>
<service><serviceType>urn:schemas-upnp-org:service:WANPPPConnection:1</serviceType><controlURL>/ppp</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:WANIPConnection:1</serviceType><controlURL>/ip</controlURL></service>
<service><serviceType>urn:schemas-upnp-org:service:Layer3Forwarding:1</serviceType><controlURL>/l3f</controlURL></service>
</serviceList></device></deviceList></device></deviceList></device></root>`

const MAPS = [
  { port: 51413, client: '192.168.1.23', what: 'Transmission at 51413' },
  { port: 3074, client: '192.168.1.40', what: 'Xbox' }
]
const reply = (action: string, inner: string) => `<?xml version="1.0"?><s:Envelope xmlns:s="http://schemas.xmlsoap.org/soap/envelope/"><s:Body><u:${action}Response xmlns:u="urn:schemas-upnp-org:service:WANIPConnection:1">${inner}</u:${action}Response></s:Body></s:Envelope>`

let base = ''
const server = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    if (req.url === '/desc.xml') return res.end(DESC)
    const action = /#(\w+)"/.exec(String(req.headers.soapaction))?.[1]
    // The PPP service is not the one in use: it fails like on real routers.
    if (req.url !== '/ip') return res.writeHead(500).end()
    if (action === 'GetExternalIPAddress') return res.end(reply(action, '<NewExternalIPAddress>100.70.1.2</NewExternalIPAddress>'))
    const i = Number(/<NewPortMappingIndex>(\d+)</.exec(body)?.[1])
    const m = MAPS[i]
    if (action !== 'GetGenericPortMappingEntry' || !m) return res.writeHead(500).end('<errorCode>713</errorCode>')
    res.end(
      reply(
        action,
        `<NewRemoteHost></NewRemoteHost><NewExternalPort>${m.port}</NewExternalPort><NewProtocol>${i ? 'udp' : 'TCP'}</NewProtocol><NewInternalPort>${m.port}</NewInternalPort><NewInternalClient>${m.client}</NewInternalClient><NewEnabled>1</NewEnabled><NewPortMappingDescription>${m.what}</NewPortMappingDescription><NewLeaseDuration>${i ? 3600 : 0}</NewLeaseDuration>`
      )
    )
  })
})

beforeAll(async () => {
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})
afterAll(() => void server.close())

describe('upnp', () => {
  it('takes the description URL only from a router on this network', () => {
    expect(locationOf('HTTP/1.1 200 OK\r\nCACHE-CONTROL: max-age=120\r\nLOCATION: http://192.168.1.1:5000/rootDesc.xml\r\n\r\n')).toBe('http://192.168.1.1:5000/rootDesc.xml')
    expect(locationOf('HTTP/1.1 200 OK\r\nLocation: http://203.0.113.9/desc.xml\r\n')).toBeNull()
    expect(locationOf('HTTP/1.1 200 OK\r\nLocation: file:///etc/passwd\r\n')).toBeNull()
  })

  it('finds the WAN services with absolute control URLs', () => {
    expect(wanServices(DESC, 'http://192.168.1.1:5000/desc.xml')).toEqual([
      { type: 'urn:schemas-upnp-org:service:WANPPPConnection:1', url: 'http://192.168.1.1:5000/ppp' },
      { type: 'urn:schemas-upnp-org:service:WANIPConnection:1', url: 'http://192.168.1.1:5000/ip' }
    ])
  })

  it('reads the external address and every port mapping, skipping the service not in use', async () => {
    expect(await readGateway(`${base}/desc.xml`)).toEqual({
      router: 'Home & Router',
      externalIp: '100.70.1.2',
      maps: [
        { external: 51413, protocol: 'TCP', client: '192.168.1.23', internal: 51413, description: 'Transmission at 51413', enabled: true, lease: 0 },
        { external: 3074, protocol: 'UDP', client: '192.168.1.40', internal: 3074, description: 'Xbox', enabled: true, lease: 3600 }
      ]
    })
  })

  it('tells a shared provider address from a direct one and from two routers in a row', () => {
    expect(natOf('203.0.113.5', '203.0.113.5')).toBe('direct')
    expect(natOf('203.0.113.5', '100.70.1.2')).toBe('cgnat')
    expect(natOf('203.0.113.5', '198.51.100.7')).toBe('cgnat')
    expect(natOf('203.0.113.5', '192.168.0.10')).toBe('double')
    expect(natOf('203.0.113.5', null)).toBe('unknown')
  })
})

describe('internetdb', () => {
  it('keeps only well-formed fields, ports sorted', () => {
    expect(parseInternetDb({ ip: '192.0.2.1', ports: [443, 22, 'x'], vulns: ['CVE-2023-1234', 5], tags: ['self-signed'], hostnames: ['a.example'], cpes: [] })).toEqual({ ports: [22, 443], vulns: ['CVE-2023-1234'], tags: ['self-signed'], hostnames: ['a.example'] })
    expect(parseInternetDb({ detail: 'No information available' })).toBeNull()
  })

  it.skipIf(!process.env.EXPOSURE_LIVE)('asks InternetDB (EXPOSURE_LIVE=1)', async () => {
    expect((await internetDb('1.1.1.1'))?.ports).toContain(443)
    expect(await internetDb('192.0.2.1')).toBeNull()
  })
})
