import http from 'node:http'
import net from 'node:net'
import { describe, expect, it } from 'vitest'
import { apply, cleanTarget, httpCheck, tcpCheck, type Result, type Stored } from './monitors'

it('accepts only targets of the right form', () => {
  expect(cleanTarget('http', 'example.com')).toBe('https://example.com/')
  expect(cleanTarget('http', ' http://example.com:8080/health ')).toBe('http://example.com:8080/health')
  expect(cleanTarget('http', 'ftp://example.com')).toBeNull()
  expect(cleanTarget('http', 'javascript:alert(1)')).toBeNull()
  expect(cleanTarget('http', '  ')).toBeNull()
  expect(cleanTarget('tcp', 'example.com:22')).toBe('example.com:22')
  expect(cleanTarget('tcp', '[::1]:443')).toBe('[::1]:443')
  expect(cleanTarget('tcp', 'example.com')).toBeNull()
  expect(cleanTarget('tcp', 'example.com:70000')).toBeNull()
  // Nothing a command could read as an option.
  expect(cleanTarget('tcp', '-oProxy:22')).toBeNull()
  expect(cleanTarget('ping', '192.168.1.1')).toBe('192.168.1.1')
  expect(cleanTarget('ping', '-n 1')).toBeNull()
})

describe('monitor state', () => {
  const fresh = (): Stored => ({ id: '1', kind: 'http', target: 'https://example.com/', every: 60, up: null, ms: null, status: null, error: null, certDays: null, since: null, checked: null, history: [], fails: 0, failAt: null, certWarned: null })
  const good: Result = { ms: 80, status: 200, error: null, certDays: null }
  const bad: Result = { ms: null, status: null, error: 'E_TIMEOUT', certDays: null }

  it('needs two failures to call it down, and tells when it comes back', () => {
    const m = fresh()
    expect(apply(m, good, 1000)).toEqual([])
    expect(m).toMatchObject({ up: true, since: 1000 })
    expect(apply(m, bad, 2000)).toEqual([])
    expect(m.up).toBe(true)
    expect(apply(m, bad, 3000)).toEqual([['monitorDown', 'E_TIMEOUT']])
    expect(m).toMatchObject({ up: false, since: 2000 })
    expect(apply(m, good, 62_000)).toEqual([['monitorUp', '60000']])
    expect(m.history.map((h) => h.ms)).toEqual([80, null, null, 80])
  })

  it('stays quiet about a newly added site that is down', () => {
    const m = fresh()
    apply(m, bad, 1000)
    expect(apply(m, bad, 2000)).toEqual([])
    expect(m.up).toBe(false)
  })

  it('warns about the certificate at 14, 7, 3, 1 and 0 days, once each', () => {
    const m = fresh()
    const days = (d: number) => apply(m, { ...good, certDays: d }, 1000).filter(([k]) => k === 'certExpiry')
    expect(days(40)).toEqual([])
    expect(days(10)).toEqual([['certExpiry', '10']])
    expect(days(9)).toEqual([])
    expect(days(6)).toEqual([['certExpiry', '6']])
    // Renewed: the warnings start over.
    expect(days(90)).toEqual([])
    expect(days(14)).toEqual([['certExpiry', '14']])
  })
})

it('checks a web address without reading the body', async () => {
  let status = 200
  const site = http.createServer((q, r) => (q.url === '/hang' ? undefined : r.writeHead(status).end('x'.repeat(1_000_000))))
  await new Promise<void>((r) => site.listen(0, '127.0.0.1', r))
  const base = `http://127.0.0.1:${(site.address() as net.AddressInfo).port}`
  try {
    expect(await httpCheck(`${base}/`)).toMatchObject({ status: 200, error: null, certDays: null })
    status = 503
    expect(await httpCheck(`${base}/`)).toMatchObject({ status: 503, error: 'HTTP 503' })
    expect(await httpCheck(`${base}/hang`, 500)).toMatchObject({ ms: null, error: 'E_TIMEOUT' })
  } finally {
    site.closeAllConnections()
    site.close()
  }
  expect((await httpCheck(base)).error).toBe('ECONNREFUSED')
})

it('says why a port did not answer', async () => {
  const s = net.createServer((c) => c.destroy())
  await new Promise<void>((r) => s.listen(0, '127.0.0.1', r))
  const port = (s.address() as net.AddressInfo).port
  expect(await tcpCheck('127.0.0.1', port)).toMatchObject({ error: null })
  s.close()
  await new Promise((r) => s.once('close', r))
  expect((await tcpCheck('127.0.0.1', port)).error).toBe('ECONNREFUSED')
})
