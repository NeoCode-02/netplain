import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import type { Alert, Conn, Connections } from '../shared/types'
import { createAlerts } from './alerts'
import { createBlocklist } from './blocklist'
import { isSettings, loadSettings, saveSettings } from './settings'

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-alerts-'))
const ALL = { newApp: true, exposed: true, plain: true, blocklist: true }

describe('blocklist', () => {
  it('matches addresses and ranges, ignoring comments and junk', () => {
    const b = createBlocklist('# FireHOL\n1.2.3.4\n10.0.0.0/8\n10.1.0.0/16\n192.168.1.7/24\nnot-an-ip\n300.1.1.1\n2001:db8::/32\n')
    expect(b.size).toBe(3)
    expect(['1.2.3.4', '10.200.3.4', '192.168.1.200', '1.2.3.5', '11.0.0.0', 'x'].map((ip) => b.has(ip))).toEqual([true, true, true, false, false, false])
  })
})

describe('alerts', () => {
  const conn = (p: Partial<Conn>): Conn => ({ proto: 'tcp', localIp: '192.168.0.2', localPort: 50000, remoteIp: '8.8.8.8', remotePort: 443, state: 'established', pid: 10, app: 'chrome', title: null, path: null, host: null, country: null, org: null, scope: 'internet', ...p })
  const data = (conns: Conn[], listening: Conn[] = []): Connections => ({ at: 0, conns, listening })

  it('records a baseline first, then reports new apps, new open ports and blocked addresses once', () => {
    const dir = tmp()
    const got: Alert[] = []
    const a = createAlerts(dir, (x) => got.push(x))
    a.setOwnBlocklist('6.6.6.0/24')
    const listen = conn({ localIp: '0.0.0.0', localPort: 445, remoteIp: null, remotePort: null, state: 'listen', app: 'System', scope: 'local' })
    a.connections(data([conn({})], [listen]), ALL)
    expect(got).toEqual([])

    const curl = conn({ app: 'curl', remoteIp: '6.6.6.6', host: 'bad.example' })
    const dev = conn({ localIp: '0.0.0.0', localPort: 3000, remoteIp: null, remotePort: null, state: 'listen', app: 'node', scope: 'local' })
    a.connections(data([conn({}), curl, conn({ app: 'PID 99' })], [listen, dev]), ALL)
    a.connections(data([curl], [dev]), ALL)
    expect(got.map((x) => [x.kind, x.app, x.detail])).toEqual([
      ['newApp', 'curl', 'bad.example'],
      ['blocklist', 'curl', '6.6.6.6'],
      ['exposed', 'node', '3000']
    ])

    // The baseline survives a restart; switched-off rules stay quiet.
    const again: Alert[] = []
    const b = createAlerts(dir, (x) => again.push(x))
    b.connections(data([conn({ app: 'zoom' })]), { ...ALL, newApp: false })
    b.connections(data([conn({ app: 'zoom' })]), ALL)
    expect(again).toEqual([])
    expect(b.list().map((x) => x.kind)).toEqual(['exposed', 'blocklist', 'newApp'])
    b.markRead()
    expect(createAlerts(dir, () => {}).list().every((x) => x.read)).toBe(true)
  })

  it('reports unencrypted traffic once a day, but not certificate checks', () => {
    const got: Alert[] = []
    const a = createAlerts(tmp(), (x) => got.push(x))
    a.plaintext(ALL, 'game', 'http://example.com')
    a.plaintext(ALL, 'game', 'http://example.com')
    a.plaintext(ALL, 'svchost', 'http://ocsp.digicert.com')
    a.plaintext(ALL, 'svchost', 'http://ctldl.windowsupdate.com')
    expect(got.map((x) => x.detail)).toEqual(['http://example.com'])
  })
})

describe('settings', () => {
  it('fills keys missing from older files and checks what the UI sends', () => {
    const file = path.join(tmp(), 'settings.json')
    fs.writeFileSync(file, JSON.stringify({ theme: 'dark', alerts: { plain: false } }))
    const s = loadSettings(file)
    expect(s).toEqual({ theme: 'dark', capture: true, alerts: { newApp: true, exposed: true, plain: false, blocklist: true }, blocklist: '', updates: true })
    expect(isSettings(s)).toBe(true)
    expect(isSettings({ ...s, alerts: { ...s.alerts, plain: 'no' } })).toBe(false)
    expect(isSettings({ ...s, blocklist: 'x'.repeat(200_001) })).toBe(false)
    saveSettings(file, { ...s, capture: false })
    expect(loadSettings(file).capture).toBe(false)
    expect(loadSettings(path.join(tmp(), 'missing.json')).theme).toBe('system')
  })
})
