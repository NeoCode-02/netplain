import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, expect, it } from 'vitest'
import type { Adapter, AppTraffic, Snapshot, Traffic } from '../shared/types'
import { createUsage, dayKey } from './usage'

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-usage-'))
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const adapter = (id: string, kind: Adapter['kind'], rx: number, tx: number): Adapter => ({ id, name: id, description: '', kind, up: true, mac: '', speed: null, ipv4: [], ipv6: [], gateway: null, dns: [], dhcp: null, rx, tx, wifi: null })
const snap = (at: number, wifi: number, vm: number): Snapshot => ({ at, defaultId: 'w', adapters: [adapter('w', 'wifi', wifi, wifi / 10), adapter('vm', 'virtual', vm, 0)] })
const app = (key: string, rx: number, tx: number): AppTraffic => ({ key, app: key, title: null, path: null, rx, tx, rxRate: 0, txRate: 0, places: [] })
const view = (since: number, apps: AppTraffic[]): Traffic => ({ state: 'on', adapterId: 'w', since, apps, rx: 0, tx: 0 })

it('adds adapter counter changes per hour, skipping resets, and counts only internet adapters in totals', () => {
  const at = new Date(2026, 9, 14, 10, 30).getTime()
  const u = createUsage(dir)
  u.adapters(snap(at, 1000, 500))
  u.adapters(snap(at + 1000, 3000, 900))
  u.adapters(snap(at + 2000, 100, 900)) // Wi-Fi reconnected: counter restarted
  u.adapters(snap(at + 3000, 600, 1000))
  const r = u.query('day', at)
  expect(r.points[10]).toMatchObject({ rx: 2500, tx: 250 })
  expect(r.points.reduce((a, p) => a + p.rx, 0)).toBe(2500)
  expect(r.adapters.map((a) => [a.key, a.rx])).toEqual([
    ['w', 2500],
    ['vm', 500]
  ])
  expect(r.rx).toBe(2500)
})

it('adds app totals as they grow and restarts with a new capture', () => {
  const u = createUsage(dir)
  u.apps(view(1, [app('chrome', 100, 10)]))
  u.apps(view(1, [app('chrome', 300, 20), app('curl', 50, 5)]))
  u.apps(view(2, [app('chrome', 40, 4)]))
  expect(u.query('day').apps.map((a) => [a.key, a.rx, a.tx])).toEqual([
    ['chrome', 340, 24],
    ['curl', 50, 5]
  ])
})

it('keeps days on disk, reads them back for a week, and prunes old ones', () => {
  const now = new Date(2026, 9, 14, 12).getTime()
  const u = createUsage(dir)
  u.adapters(snap(now - 2 * 86_400_000, 0, 0))
  u.adapters(snap(now - 2 * 86_400_000 + 1000, 7000, 0))
  u.adapters(snap(now, 7000, 0))
  u.adapters(snap(now + 1000, 8000, 0))
  u.save()
  expect(fs.readdirSync(dir).sort()).toEqual([`${dayKey(now - 2 * 86_400_000)}.json`, `${dayKey(now)}.json`])
  const week = createUsage(dir).query('week', now)
  expect(week.points).toHaveLength(7)
  expect(week.points.map((p) => p.rx)).toEqual([0, 0, 0, 0, 7000, 0, 1000])
  fs.writeFileSync(path.join(dir, '2026-01-01.json'), '{}')
  createUsage(dir).prune(now)
  expect(fs.existsSync(path.join(dir, '2026-01-01.json'))).toBe(false)
})
