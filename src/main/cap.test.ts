import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { expect, it } from 'vitest'
import type { Adapter, DataCap } from '../shared/types'
import { createCap, crossed, networkName, period } from './cap'
import { createUsage, networkOf } from './usage'

const day = (y: number, m: number, d: number, h = 12) => new Date(y, m, d, h).getTime()

it('finds the billing period around the reset day', () => {
  expect(period(5, day(2026, 9, 16))).toEqual({ start: new Date(2026, 9, 5).getTime(), end: new Date(2026, 10, 5).getTime() })
  expect(period(5, day(2026, 9, 4))).toEqual({ start: new Date(2026, 8, 5).getTime(), end: new Date(2026, 9, 5).getTime() })
  // January, before the reset day: the period began in December of the year before.
  expect(period(20, day(2026, 0, 3))).toEqual({ start: new Date(2025, 11, 20).getTime(), end: new Date(2026, 0, 20).getTime() })
  expect(period(1, day(2026, 9, 1, 0))).toEqual({ start: new Date(2026, 9, 1).getTime(), end: new Date(2026, 10, 1).getTime() })
})

it('names networks and steps', () => {
  expect(networkName('wifi:Home: 5G')).toBe('Home: 5G')
  expect(networkOf({ kind: 'ethernet', name: 'Ethernet 2', wifi: null })).toEqual({ key: 'ethernet:Ethernet 2', name: 'Ethernet 2' })
  expect(crossed(85, [])).toEqual([80])
  expect(crossed(120, [80])).toEqual([100])
  expect(crossed(120, [80, 100])).toEqual([])
})

it('counts one network from the reset day and warns once per step', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-cap-'))
  const usage = createUsage(path.join(dir, 'usage'))
  const wifi = (ssid: string, rx: number): Adapter => ({ id: 'w', name: 'WiFi', description: '', kind: 'wifi', up: true, mac: '', speed: null, ipv4: [], ipv6: [], gateway: null, dns: [], dhcp: null, rx, tx: 0, wifi: { ssid } as Adapter['wifi'] })
  const at = day(2026, 9, 16)
  usage.adapters({ at, defaultId: 'w', adapters: [wifi('Phone', 0)] })
  usage.adapters({ at: at + 1000, defaultId: 'w', adapters: [wifi('Phone', 850_000_000)] })
  usage.adapters({ at: at + 2000, defaultId: 'w', adapters: [wifi('Home', 5_850_000_000)] })
  expect(usage.used('wifi:Phone', period(5, at).start, at + 3000)).toBe(850_000_000)
  expect(usage.used('', period(5, at).start, at + 3000)).toBe(5_850_000_000)
  expect(usage.networks(at + 3000).map((n) => n.key)).toEqual(['wifi:Home', 'wifi:Phone'])

  let cap: DataCap | null = { network: 'wifi:Phone', gb: 1, day: 5 }
  const told: unknown[] = []
  const c = createCap(dir, { cap: () => cap, used: usage.used, tell: (...a) => told.push(a) })
  c.check(at + 3000)
  c.check(at + 4000)
  expect(told).toEqual([[80, 'Phone', 850_000_000, 1e9]])
  // Already over both steps when the limit is set: only the highest is told.
  cap = { network: '', gb: 5, day: 5 }
  c.check(at + 5000)
  expect(told.at(-1)).toEqual([100, null, 5_850_000_000, 5e9])
  expect(c.state(at + 5000)).toMatchObject({ used: 5_850_000_000, limit: 5e9, name: null })
})
