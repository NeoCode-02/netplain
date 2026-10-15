import fs from 'node:fs'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Outage } from '../shared/types'
import { causeOf, createLog, knock, parsePingOnce, type Check } from './uptime'

const ok = { adapter: true, routerKnown: true, router: 2, internet: 20, dns: true }

it('names the nearest broken link', () => {
  expect(causeOf(ok)).toBeNull()
  expect(causeOf({ ...ok, dns: null })).toBeNull()
  expect(causeOf({ ...ok, adapter: false, router: null, internet: null })).toBe('adapter')
  expect(causeOf({ ...ok, router: null, internet: null })).toBe('router')
  // A router that ignores every check says nothing about the outage.
  expect(causeOf({ ...ok, routerKnown: false, router: null, internet: null })).toBe('provider')
  expect(causeOf({ ...ok, internet: null })).toBe('provider')
  expect(causeOf({ ...ok, dns: false })).toBe('dns')
})

it('reads one ping reply on Windows (any language) and elsewhere', () => {
  expect(parsePingOnce('Reply from 192.168.1.1: bytes=32 time=3ms TTL=64', true)).toBe(3)
  expect(parsePingOnce('Reply from 192.168.1.1: bytes=32 time<1ms TTL=64', true)).toBe(1)
  expect(parsePingOnce('Ответ от 192.168.1.1: число байт=32 время=12мс TTL=64', true)).toBe(12)
  // Windows exits 0 for this one, which is why the reply line itself is read.
  expect(parsePingOnce('Reply from 192.168.1.117: Destination host unreachable.', true)).toBeNull()
  expect(parsePingOnce('64 bytes from 192.168.1.1: icmp_seq=0 ttl=64 time=2.41 ms', false)).toBe(2.41)
  expect(parsePingOnce('1 packets transmitted, 0 received, 100% packet loss', false)).toBeNull()
})

describe('outage log', () => {
  const T = new Date('2026-10-15T10:00:00').getTime()
  const at = (s: number) => T + s * 1000
  const check = (s: number, c: Partial<Check> = {}): Check => ({ at: at(s), network: 'Home', ...ok, ...c })
  const dir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-uptime-'))

  it('needs two failed checks, keeps the deepest cause, and ends at the first good check', () => {
    const ended: Outage[] = []
    const log = createLog(dir(), (o) => ended.push({ ...o }))
    log.record(check(0))
    log.record(check(15, { internet: null }))
    log.record(check(20))
    expect(log.view().outages).toHaveLength(0)
    log.record(check(35, { internet: null }))
    log.record(check(40, { internet: null, router: null }))
    expect(log.view().outages[0]).toMatchObject({ start: at(35), end: null, cause: 'router', network: 'Home' })
    log.record(check(45, { internet: null }))
    log.record(check(50))
    expect(ended).toEqual([expect.objectContaining({ start: at(35), end: at(50), cause: 'router' })])
  })

  it('does not count sleep as an outage', () => {
    const ended: Outage[] = []
    const log = createLog(dir(), (o) => ended.push({ ...o }))
    log.record(check(0, { internet: null }))
    log.record(check(5, { internet: null }))
    // Two hours later (the lid was closed): the outage ended with the last check before it.
    log.record(check(7200, { internet: null }))
    expect(ended[0]).toMatchObject({ start: at(0), end: at(5) })
    // One failed check after waking up starts nothing yet.
    expect(log.view().outages).toHaveLength(1)
  })

  it('keeps one point per minute and survives a restart (an open outage is closed)', () => {
    const d = dir()
    const log = createLog(d, () => {})
    log.record(check(0, { internet: 10, router: 2 }))
    log.record(check(30, { internet: 30, router: 4 }))
    log.record(check(45, { internet: null }))
    log.record(check(60, { internet: null }))
    log.save()
    const p = log.view().points
    expect(p).toHaveLength(2)
    expect(p[0]).toEqual({ at: at(0), internet: 20, router: 3, loss: 1 / 3 })
    const again = createLog(d, () => {})
    expect(again.view().outages[0]).toMatchObject({ start: at(45), end: at(60) })
  })
})

it('times a TCP handshake, and a refused one only when asked to', async () => {
  const server = net.createServer((s) => s.destroy())
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
  const open = (server.address() as net.AddressInfo).port
  server.close()
  const closed = open
  const live = net.createServer((s) => s.destroy())
  await new Promise<void>((r) => live.listen(0, '127.0.0.1', r))
  try {
    expect(await knock('127.0.0.1', (live.address() as net.AddressInfo).port, 2000)).toBeGreaterThanOrEqual(1)
    expect(await knock('127.0.0.1', closed, 3000)).toBeNull()
    expect(await knock('127.0.0.1', closed, 3000, true)).toBeGreaterThanOrEqual(1)
  } finally {
    live.close()
  }
})
