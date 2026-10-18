import { describe, expect, it } from 'vitest'
import type { Security, Signer } from '../shared/types'
import { exeOf, findings, userWritable, type Context } from './findings'
import { toSigner } from './security'

const env = { SystemRoot: 'C:\\WINDOWS', ProgramFiles: 'C:\\Program Files' }

describe('exeOf', () => {
  it('finds the program in the command lines Windows stores', () => {
    expect(exeOf('"C:\\Program Files (x86)\\Steam\\steam.exe" -silent', env)).toBe('C:\\Program Files (x86)\\Steam\\steam.exe')
    expect(exeOf('C:\\Program Files (x86)\\PlanetVPN\\PlanetVPN.exe', env)).toBe('C:\\Program Files (x86)\\PlanetVPN\\PlanetVPN.exe')
    expect(exeOf('""C:\\WINDOWS\\System32\\DriverStore\\x\\RtkAudUService64.exe"" -background', env)).toBe('C:\\WINDOWS\\System32\\DriverStore\\x\\RtkAudUService64.exe')
    expect(exeOf('%SystemRoot%\\system32\\svchost.exe -k netsvcs -p', env)).toBe('C:\\WINDOWS\\system32\\svchost.exe')
    expect(exeOf('%programfiles%\\App\\a b.exe /x', env)).toBe('C:\\Program Files\\App\\a b.exe')
    expect(exeOf('\\SystemRoot\\System32\\drivers\\x.sys', env)).toBe('C:\\WINDOWS\\System32\\drivers\\x.sys')
    expect(exeOf('svchost.exe -k x', env)).toBeNull()
    expect(exeOf('', env)).toBeNull()
  })
  it('knows the folders any program can write to', () => {
    expect(userWritable('C:\\Users\\a\\AppData\\Roaming\\x.exe')).toBe(true)
    expect(userWritable('C:\\Users\\a\\Downloads\\x.exe')).toBe(true)
    expect(userWritable('C:\\Program Files\\x.exe')).toBe(false)
  })
  it('reads signature states', () => {
    expect(toSigner({ status: 'Valid', publisher: 'Google LLC' })).toEqual({ status: 'valid', publisher: 'Google LLC' })
    expect(toSigner({ status: 'NotSigned' })?.status).toBe('unsigned')
    expect(toSigner({ status: 'HashMismatch' })?.status).toBe('invalid')
    // Windows could not tell (no answer, catalog service unavailable): unknown, not a bad signature.
    expect(toSigner(undefined)).toBeNull()
    expect(toSigner({ status: 'UnknownError' })).toBeNull()
  })
})

describe('findings', () => {
  const valid: Signer = { status: 'valid', publisher: 'Microsoft Windows' }
  const none: Signer = { status: 'unsigned', publisher: null }
  const clean: Omit<Security, 'findings'> = {
    at: 0,
    defender: { av: true, rt: true, sigAge: 0, quickAge: 1, fullAge: 4294967295, tamper: true },
    threats: [],
    users: [
      { name: 'Administrator', enabled: false, last: null, sid: 'S-1-5-21-1-500', admin: true, me: false },
      { name: 'alice', enabled: true, last: null, sid: 'S-1-5-21-1-1001', admin: true, me: true }
    ],
    services: [{ name: 'Audiosrv', display: 'Windows Audio', desc: '', state: 'Running', start: 'Auto', account: 'LocalSystem', path: '', exe: 'C:\\WINDOWS\\system32\\svchost.exe', signer: valid, microsoft: true }],
    startup: [{ id: 'run|HKCU|x|Steam', kind: 'run', hive: 'HKCU', approved: 'x', name: 'Steam', command: '', enabled: true, exe: 'C:\\Program Files\\Steam\\steam.exe', signer: { status: 'valid', publisher: 'Valve Corp.' }, suspicious: false }],
    firewall: [
      { name: 'Domain', on: true },
      { name: 'Private', on: true },
      { name: 'Public', on: true }
    ],
    openRules: [],
    uac: { lua: 1, consent: 5 },
    rdpDenied: 1,
    sac: 1,
    proxy: { on: 0, server: '', pac: '' },
    hosts: ['127.0.0.1 kubernetes.docker.internal', '192.168.0.101 host.docker.internal'],
    updated: '2026-10-10'
  }
  const ctx: Context = { now: new Date('2026-10-14T12:00:00').getTime(), dns: ['192.168.0.1'], online: [], signers: new Map(), geo: () => ({ org: 'Uzbektelekom' }), self: 'C:\\Users\\alice\\AppData\\Local\\Programs\\Netplain\\Netplain.exe' }
  const keys = (s: Omit<Security, 'findings'>, c: Partial<Context> = {}) => findings(s, { ...ctx, ...c }).map((f) => `${f.level}:${f.key}`)

  it('says only good things about a healthy computer', () => {
    expect(keys(clean)).toEqual(['ok:defenderOk', 'ok:firewallOk', 'ok:uacOk', 'ok:sacOn', 'ok:updatesOk'])
  })

  it('raises the classic signs of trouble, worst first', () => {
    const bad: Omit<Security, 'findings'> = {
      ...clean,
      defender: { ...clean.defender!, rt: false, sigAge: 12, quickAge: 30 },
      threats: [{ id: '1', name: 'Trojan:Win32/X', severity: 5, active: true, resources: [], at: null, status: 1 }],
      firewall: [{ name: 'Public', on: false }],
      openRules: ['Steam', 'node.exe'],
      uac: { lua: 1, consent: 0 },
      rdpDenied: 0,
      users: [{ ...clean.users[0], enabled: true }, clean.users[1], { name: 'helper', enabled: true, last: null, sid: 'S-1-5-21-1-1005', admin: true, me: false }],
      startup: [{ ...clean.startup[0], name: 'updater', exe: 'C:\\Users\\alice\\AppData\\Roaming\\u\\updater.exe', signer: none }],
      services: [{ ...clean.services[0], name: 'svc', display: 'Odd Service', exe: 'C:\\Tools\\svc.exe', signer: none }],
      hosts: ['6.6.6.6 www.mybank.com', '0.0.0.0 ads.example.com'],
      proxy: { on: 1, server: '10.0.0.5:8080', pac: '' },
      updated: '2026-06-01'
    }
    const signers = new Map([['C:\\x\\miner.exe', none]])
    const f = findings(bad, { ...ctx, dns: ['77.88.8.8'], online: [{ app: 'miner', path: 'C:\\x\\miner.exe' }], signers })
    expect(f.map((x) => `${x.level}:${x.key}`)).toEqual([
      'bad:realtimeOff',
      'bad:threatsActive',
      'bad:firewallOff',
      'warn:signaturesOld',
      'warn:uacSilent',
      'warn:rdpOn',
      'warn:builtinAdmin',
      'warn:startupSuspicious',
      'warn:servicesUnsigned',
      'warn:netUnsigned',
      'warn:hostsRedirect',
      'warn:proxyOn',
      'warn:updatesOld',
      'info:scanOld',
      'info:publicOpen',
      'info:otherAdmins',
      'info:dnsProvider',
      'ok:sacOn'
    ])
    expect(f.find((x) => x.key === 'hostsRedirect')?.params.lines).toBe('6.6.6.6 www.mybank.com')
    expect(f.find((x) => x.key === 'dnsProvider')?.params).toEqual({ servers: '77.88.8.8', org: 'Uzbektelekom' })
    expect(f.find((x) => x.key === 'firewallOff')?.fix).toBe('firewallOn')
    expect(f.find((x) => x.key === 'publicOpen')?.params).toEqual({ n: 2, names: 'Steam, node.exe' })
  })

  it('does not call Store apps unsigned (they are signed as a package)', () => {
    const store = 'C:\\Program Files\\WindowsApps\\Microsoft.Start_1.0_x64\\Feed.exe'
    expect(keys(clean, { online: [{ app: 'Feed', path: store }], signers: new Map([[store, none]]) })).not.toContain('warn:netUnsigned')
  })

  it('does not flag Netplain itself (unsigned builds start at login from AppData and go online)', () => {
    const own = ctx.self.toUpperCase()
    const s = { ...clean, startup: [{ ...clean.startup[0], name: 'Netplain', exe: own, signer: none }] }
    expect(keys(s, { online: [{ app: 'Netplain', path: own }], signers: new Map([[own, none]]) })).toEqual(keys(clean))
  })

  it('treats a missing Defender as the worst sign', () => {
    expect(keys({ ...clean, defender: null })[0]).toBe('bad:defenderOff')
  })
})
