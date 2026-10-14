import { describe, expect, it } from 'vitest'
import type { Adapter, Snapshot } from '../../shared/types'
import { addressKind, authKey, bandKey, quality, randomMac, summary, what } from './explain'
import { bits, bytes } from './format'
import { LANGS } from './i18n'
import { advance, KEEP } from './live'
import { niceMax } from './RateChart'

const base: Adapter = { id: 'w', name: 'WiFi', description: '', kind: 'wifi', up: true, mac: '', speed: null, ipv4: ['192.168.0.2/24'], ipv6: [], gateway: '192.168.0.1', dns: [], dhcp: true, rx: 0, tx: 0, wifi: null }
const snap = (at: number, rx: number, tx: number): Snapshot => ({ at, defaultId: 'w', adapters: [{ ...base, rx, tx }] })

describe('live', () => {
  it('turns byte counters into bits per second', () => {
    let h = advance(null, snap(0, 1000, 0), new Map())
    expect(h.get('w')).toEqual([])
    h = advance(snap(0, 1000, 0), snap(2000, 3000, 500), h)
    expect(h.get('w')).toEqual([{ t: 2000, down: 8000, up: 2000 }])
  })
  it('treats a counter reset as zero and keeps one minute', () => {
    let h = advance(snap(0, 5000, 5000), snap(1000, 10, 10), new Map())
    expect(h.get('w')![0]).toMatchObject({ down: 0, up: 0 })
    for (let i = 1; i <= KEEP + 5; i++) h = advance(snap(i * 1000, i, i), snap((i + 1) * 1000, i + 1, i + 1), h)
    expect(h.get('w')!.length).toBe(KEEP)
  })
})

describe('format', () => {
  it('prints speeds and sizes', () => {
    expect(bits(0)).toBe('0 bit/s')
    expect(bits(3_400_000)).toBe('3.4 Mbit/s')
    expect(bits(270_000_000)).toBe('270 Mbit/s')
    expect(bytes(1_234_567_890)).toBe('1.2 GB')
    expect(bytes(512)).toBe('512 B')
  })
  it('rounds the chart axis to clean numbers', () => {
    expect(niceMax(0)).toBe(10_000)
    expect(niceMax(3_400_000)).toBe(5_000_000)
    expect(niceMax(1_000_000)).toBe(1_000_000)
    expect(niceMax(1_000_001)).toBe(2_000_000)
  })
})

describe('explain', () => {
  it('picks the plain-language story', () => {
    expect(what({ ...base, kind: 'virtual', description: 'VirtualBox Host-Only Ethernet Adapter' })).toBe('virtualbox')
    expect(what({ ...base, kind: 'virtual', name: 'vEthernet (WSL (Hyper-V firewall))' })).toBe('wsl')
    expect(what({ ...base, kind: 'vpn', description: 'TAP-Windows Adapter V9' })).toBe('openvpn')
    expect(what({ ...base, kind: 'vpn', name: 'utun3' })).toBe('vpn')
    expect(what(base)).toBe('wifi')
  })
  it('grades addresses, signal, band and security', () => {
    expect(['169.254.1.1', '192.168.0.2', '100.100.1.1', '8.8.8.8'].map(addressKind)).toEqual(['apipa', 'private', 'cgnat', 'public'])
    expect([90, 70, 45, 10].map(quality)).toEqual(['excellent', 'good', 'fair', 'weak'])
    expect(['2.4 GHz', '5 GHz', '6 GHz', '5 ГГц', ''].map(bandKey)).toEqual(['2.4', '5', '6', '5', null])
    expect(['WPA3-Personal', 'WPA2-Personal', 'Open', 'WEP', ''].map(authKey)).toEqual(['strong', 'ok', 'weak', 'weak', null])
    expect([randomMac('da:a1:19:77:88:99'), randomMac('a4:2b:b0:11:22:33')]).toEqual([true, false])
  })
  it('summarises where the internet goes, in both languages', () => {
    const wifi = { ...base, wifi: { ssid: 'Home', bssid: '', signal: 80, channel: 1, band: '', radio: '', auth: '', rxMbps: null, txMbps: null } }
    expect(summary(LANGS.en, [wifi], 'w')).toContain('“Home”')
    expect(summary(LANGS.uz, [wifi], 'w')).toContain('“Home” Wi-Fi')
    expect(summary(LANGS.en, [wifi], null)).toBe(LANGS.en.network.offline)
  })
})
