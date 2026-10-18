import http from 'node:http'
import type { AddressInfo } from 'node:net'
import { describe, expect, it } from 'vitest'
import { chainOf, inspectSite, securityHeaders, siteUrl } from './webcheck'

describe('site check', () => {
  it('reads web addresses, starting bare names on http', () => {
    expect(siteUrl('example.com')?.href).toBe('http://example.com/')
    expect(siteUrl('https://example.com/a?b')?.href).toBe('https://example.com/a?b')
    for (const bad of ['ftp://example.com', 'javascript:alert(1)', 'http://', '']) expect(siteUrl(bad), bad).toBeNull()
  })

  it('grades security headers; HSTS only counts over https', () => {
    const h = { 'strict-transport-security': 'max-age=63072000', 'content-security-policy': "default-src 'self'; frame-ancestors 'none'", 'x-content-type-options': 'nosniff' }
    const on = Object.fromEntries(securityHeaders(h, true).map((x) => [x.key, x.value]))
    expect(on).toEqual({ hsts: 'max-age=63072000', csp: h['content-security-policy'], frames: "frame-ancestors 'none'", nosniff: 'nosniff', referrer: null, permissions: null })
    expect(securityHeaders(h, false).find((x) => x.key === 'hsts')?.value).toBeNull()
  })

  it('walks a certificate chain up to the root that signs itself', () => {
    const root = { subject: { CN: 'Root CA', O: 'Example Trust' }, issuer: { CN: 'Root CA', O: 'Example Trust' }, valid_from: 'Jan  1 00:00:00 2020 GMT', valid_to: 'Jan  1 00:00:00 2040 GMT', subjectaltname: undefined }
    ;(root as Record<string, unknown>).issuerCertificate = root
    const leaf = { subject: { CN: 'example.com' }, issuer: { CN: 'Root CA', O: 'Example Trust' }, valid_from: 'Mar  1 00:00:00 2026 GMT', valid_to: 'May 30 23:59:59 2026 GMT', subjectaltname: 'DNS:example.com, DNS:www.example.com, IP Address:192.0.2.1', issuerCertificate: root }
    expect(chainOf(leaf as never)).toEqual([
      { subject: 'example.com', issuer: 'Example Trust · Root CA', validFrom: '2026-03-01', validTo: '2026-05-30', names: ['example.com', 'www.example.com', '192.0.2.1'] },
      { subject: 'Root CA', issuer: 'Example Trust · Root CA', validFrom: '2020-01-01', validTo: '2040-01-01', names: [] }
    ])
  })

  it('follows redirects to the final answer', async () => {
    const server = http.createServer((q, r) => {
      if (q.url === '/') return r.writeHead(301, { location: '/home' }).end()
      r.writeHead(200, { server: 'TestWeb', 'x-content-type-options': 'nosniff', 'strict-transport-security': 'max-age=1' }).end('hi')
    })
    await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      const r = await inspectSite(`${base}/`)
      expect(r.hops).toEqual([
        { url: `${base}/`, status: 301 },
        { url: `${base}/home`, status: 200 }
      ])
      expect(r).toMatchObject({ url: `${base}/home`, status: 200, server: 'TestWeb', tls: null, upgrade: false })
      expect(r.headers.find((x) => x.key === 'hsts')?.value).toBeNull()
      server.close()
      await expect(inspectSite(`${base}/`)).rejects.toThrow('E_SITE|ECONNREFUSED')
    } finally {
      server.close()
    }
  })
})
