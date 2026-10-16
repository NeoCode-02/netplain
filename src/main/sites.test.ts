import http from 'node:http'
import net from 'node:net'
import { expect, it } from 'vitest'
import type { Conn } from '../shared/types'
import { DEV, localSites, titleOf } from './sites'

it('reads a page title', () => {
  expect(titleOf('<html><head><title>\n  My  App &amp; Co </title>')).toBe('My App & Co')
  expect(titleOf('<html><body>no title</body>')).toBeNull()
})

it('tells development tools from background apps', () => {
  expect(['node', 'python3', 'php-cgi.exe', 'com.docker.backend.exe'].every((a) => DEV.test(a))).toBe(true)
  expect(['nodeX', 'Spotify', 'comxdockerxbackend', 'python3.12'].some((a) => DEV.test(a))).toBe(false)
})

it('finds the web sites among listening ports', async () => {
  const site = http.createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<title>Shop – dev</title>'))
  const db = net.createServer((s) => s.end('not http\r\n'))
  await Promise.all([site, db].map((s) => new Promise<void>((r) => s.listen(0, '127.0.0.1', r))))
  const port = (s: net.Server) => (s.address() as net.AddressInfo).port
  const conn = (p: number, pid: number, app: string): Conn => ({ proto: 'tcp', localIp: '127.0.0.1', localPort: p, remoteIp: null, remotePort: null, state: 'listen', pid, app, title: null, path: null, host: null, country: null, org: null, scope: 'loopback' })
  try {
    const found = await localSites([conn(port(site), 100, 'node'), conn(port(db), 101, 'postgres'), conn(port(site), 7, 'node')], 7)
    expect(found).toEqual([{ port: port(site), https: false, title: 'Shop – dev', app: 'node', dev: true }])
  } finally {
    site.close()
    db.close()
  }
})
