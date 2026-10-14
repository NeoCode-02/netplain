import http from 'node:http'
import net from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { asset, checksum } from './cloudflared'
import { createProxy, LINK, visitor } from './share'

// The "local site": echoes what it got, and accepts WebSocket upgrades (then echoes bytes).
const seen: http.IncomingHttpHeaders[] = []
const site = http.createServer((req, res) => {
  seen.push(req.headers)
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ method: req.method, url: req.url, body })))
})
site.on('upgrade', (_req, socket) => {
  socket.write('HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\n\r\n')
  socket.on('data', (d) => socket.write(d))
})
let sitePort = 0

const auth = `Basic ${Buffer.from('netplain:secret').toString('base64')}`
let proxy: ReturnType<typeof createProxy>
let port = 0

function get(path: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; body: string }>((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, method: body ? 'POST' : 'GET', headers }, (res) => {
      let b = ''
      res.on('data', (c) => (b += c))
      res.on('end', () => resolve({ status: res.statusCode!, body: b }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

beforeAll(async () => {
  // Only IPv4, like many dev servers: the proxy asks for "localhost" and must still find it.
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  sitePort = (site.address() as net.AddressInfo).port
  proxy = createProxy({ port: sitePort, https: false, auth, country: (ip) => (ip === '203.0.113.7' ? 'NL' : null), changed: () => {} })
  port = await proxy.listen()
})
afterAll(() => {
  proxy.close()
  site.close()
})

describe('share proxy', () => {
  it('asks for the password', async () => {
    expect((await get('/', {})).status).toBe(401)
    expect((await get('/', { authorization: 'Basic d3Jvbmc6d3Jvbmc=' })).status).toBe(401)
  })

  it('forwards to the local site as localhost and logs the request', async () => {
    const r = await get('/api?x=1', { authorization: auth, host: 'abc.trycloudflare.com', 'cf-connecting-ip': '203.0.113.7' }, 'hello')
    expect(r.status).toBe(200)
    expect(JSON.parse(r.body)).toEqual({ method: 'POST', url: '/api?x=1', body: 'hello' })
    const h = seen.at(-1)!
    expect(h.host).toBe(`localhost:${sitePort}`)
    expect(h['x-forwarded-host']).toBe('abc.trycloudflare.com')
    expect(h.authorization).toBeUndefined()

    const e = proxy.requests(0).find((x) => x.path === '/api?x=1')!
    expect(e).toMatchObject({ method: 'POST', status: 200, ip: '203.0.113.7', country: 'NL', error: null })
    expect(e.bytes).toBe(r.body.length)
    const d = proxy.request(e.id)!
    expect(d.reqBody).toBe('hello')
    expect(JSON.parse(d.resBody).body).toBe('hello')
    expect(proxy.requests(0).filter((x) => x.status === 401)).toHaveLength(2)
  })

  it('replays a request', async () => {
    const before = seen.length
    const e = proxy.requests(0).find((x) => x.path === '/api?x=1')!
    await proxy.replay(e.id)
    expect(seen.length).toBe(before + 1)
    expect(proxy.requests(e.id).at(-1)).toMatchObject({ path: '/api?x=1', ip: 'replay', status: 200 })
  })

  it('joins WebSockets', async () => {
    const s = net.connect(port, '127.0.0.1')
    let got = ''
    s.on('data', (d) => (got += d))
    s.write(`GET /ws HTTP/1.1\r\nHost: x\r\nAuthorization: ${auth}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n`)
    await new Promise((r) => setTimeout(r, 200))
    s.write('ping')
    await new Promise((r) => setTimeout(r, 200))
    s.destroy()
    expect(got).toMatch(/^HTTP\/1\.1 101/)
    expect(got.endsWith('ping')).toBe(true)
  })

  it('says when nothing answers locally', async () => {
    const free = net.createServer()
    await new Promise<void>((r) => free.listen(0, '127.0.0.1', r))
    const dead = (free.address() as net.AddressInfo).port
    free.close()
    const p = createProxy({ port: dead, https: false, auth: null, country: () => null, changed: () => {} })
    port = await p.listen()
    try {
      expect((await get('/')).status).toBe(502)
      expect(p.requests(0)[0].error).toBe('E_SHARE_LOCAL')
    } finally {
      p.close()
    }
  })
})

it('finds the link and the visitor', () => {
  expect(LINK.cloudflare.exec('INF |  https://quiet-river-fox.trycloudflare.com  |')?.[0]).toBe('https://quiet-river-fox.trycloudflare.com')
  expect(LINK.ssh.exec('a1b2c3.lhr.life tunneled with tls termination, https://a1b2c3.lhr.life')?.[0]).toBe('https://a1b2c3.lhr.life')
  expect(visitor({ 'x-forwarded-for': '198.51.100.4, 10.0.0.1' })).toBe('198.51.100.4')
  expect(visitor({})).toBeNull()
})

it('picks the cloudflared release file and its checksum', () => {
  expect(asset('win32', 'x64')).toBe('cloudflared-windows-amd64.exe')
  expect(asset('darwin', 'arm64')).toBe('cloudflared-darwin-arm64.tgz')
  expect(asset('freebsd', 'x64')).toBeNull()
  const notes = '### SHA256 Checksums:\n```\ncloudflared-windows-amd64.exe: 86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c\ncloudflared-windows-amd64.msi: 1111111111111111111111111111111111111111111111111111111111111111\n```'
  expect(checksum(notes, 'cloudflared-windows-amd64.exe')).toBe('86aee4017b26625cee8484c113558f48effa4cd47f7aa05fcf425604e5d2b23c')
  expect(checksum(notes, 'cloudflared-linux-amd64')).toBeNull()
})
