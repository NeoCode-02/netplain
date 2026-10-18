import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Adapter, Neighbor } from '../shared/types'
import { createLanWatch, LEARN, type LanKind } from './lanwatch'

const wifi = { id: 'w', name: 'Wi-Fi', kind: 'wifi', ipv4: ['192.168.1.10/24'], gateway: '192.168.1.1', dns: ['192.168.1.1', 'fe80::1'], wifi: { ssid: 'Home' } } as unknown as Adapter
const dev = (ip: string, mac: string, vendor: string | null = null): Neighbor => ({ ip, mac, via: '192.168.1.10', vendor })
const ROUTER = dev('192.168.1.1', '02:00:5e:00:00:01')
const TV = dev('192.168.1.20', '02:00:5e:00:00:02', 'Samsung')

function setup() {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'np-lan-')), 'lan.json')
  const told: [LanKind, string, string][] = []
  return { file, told, w: createLanWatch(file, (...e) => told.push(e)) }
}

describe('lan watch', () => {
  it('learns a network for a day, then tells about strangers', () => {
    const { w, told } = setup()
    w.check(wifi, [ROUTER, TV], false, 0)
    w.check(wifi, [ROUTER, TV, dev('192.168.1.30', '02:00:5e:00:00:03')], false, 1000)
    expect(told).toEqual([])
    w.check(wifi, [ROUTER, TV, dev('192.168.1.40', '02:00:5e:00:00:04', 'Apple'), dev('192.168.1.50', '02:00:5e:00:00:05', 'Other')], false, LEARN + 1)
    expect(told).toEqual([
      ['newDevice', 'Apple', '192.168.1.40|02:00:5e:00:00:04'],
      ['newDevice', 'Other', '192.168.1.50|02:00:5e:00:00:05']
    ])
  })

  it('takes the first scan as the starting list, later scans as news', () => {
    const { w, told } = setup()
    w.check(wifi, [ROUTER], false, 0)
    w.check(wifi, [ROUTER, TV], true, LEARN * 3)
    expect(told).toEqual([])
    w.check(wifi, [ROUTER, TV, dev('192.168.1.40', '02:00:5e:00:00:04')], true, LEARN * 4)
    expect(told.map((e) => e[0])).toEqual(['newDevice'])
  })

  it('raises the alarm when the router address leads to another card, once', () => {
    const { w, told } = setup()
    w.check(wifi, [ROUTER, TV], false, 0)
    const spoofed = [{ ...ROUTER, mac: TV.mac }, TV]
    w.check(wifi, spoofed, false, 1000)
    w.check(wifi, spoofed, false, 2000)
    expect(told).toEqual([['arpSpoof', '', '192.168.1.1|02:00:5e:00:00:01|02:00:5e:00:00:02|192.168.1.20']])
  })

  it('tells when DNS servers or the proxy change, and remembers across restarts', () => {
    const { w, told, file } = setup()
    w.check(wifi, [ROUTER], false, 0)
    w.proxy('DIRECT')
    w.check({ ...wifi, dns: ['203.0.113.53'] }, [ROUTER], false, 1000)
    const again = createLanWatch(file, (...e) => told.push(e))
    again.proxy('PROXY 127.0.0.1:8888')
    again.check({ ...wifi, dns: ['203.0.113.53'] }, [ROUTER], false, 2000)
    expect(told).toEqual([
      ['netChange', '', 'dns|192.168.1.1|203.0.113.53'],
      ['netChange', '', 'proxy|DIRECT|PROXY 127.0.0.1:8888']
    ])
  })

  it('keeps networks apart and skips adapters without a router', () => {
    const { w, told } = setup()
    w.check(wifi, [ROUTER], false, 0)
    w.check({ ...wifi, wifi: { ssid: 'Cafe' }, dns: ['10.0.0.1'] } as unknown as Adapter, [{ ...ROUTER, mac: '02:00:5e:00:00:09' }], false, 1000)
    w.check({ ...wifi, gateway: null }, [TV], false, LEARN * 2)
    expect(told).toEqual([])
  })
})
