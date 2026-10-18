import type { Finding, Security, Signer } from '../shared/types'

/**
 * The program file a command line starts: `"C:\a b\x.exe" -flag`, `C:\x.exe /y`, `""C:\x.exe"" -z`,
 * `%SystemRoot%\x.exe`. Null when it names no path (e.g. "svchost.exe").
 */
export function exeOf(command: string, env: Record<string, string | undefined> = process.env): string | null {
  const lower = Object.fromEntries(Object.entries(env).map(([k, v]) => [k.toLowerCase(), v]))
  let s = command.trim().replace(/%([^%]+)%/g, (m, k: string) => lower[k.toLowerCase()] ?? m)
  s = s.replace(/^\\\?\?\\/, '').replace(/^\\SystemRoot\\/i, `${lower.systemroot ?? 'C:\\Windows'}\\`)
  let path: string | undefined
  if (s.startsWith('"')) {
    const body = s.replace(/^"+/, '')
    path = body.slice(0, body.indexOf('"') >= 0 ? body.indexOf('"') : undefined)
  } else path = /^(.+?\.(?:exe|com|bat|cmd|scr|ps1|vbs|js|msc|lnk))(?=\s|$)/i.exec(s)?.[1] ?? s.split(/\s+/)[0]
  return path && /^[a-z]:\\/i.test(path) ? path : null
}

/** Folders any program of this user can write to: a classic hiding place, legit only when signed. */
export const userWritable = (path: string) => /\\(AppData|Temp|Downloads|Users\\Public)\\/i.test(path)

/** Store apps are signed as a whole package (AppxSignature), so their files carry no signature of their own. */
export const packaged = (path: string | null) => !!path && /\\(WindowsApps|SystemApps)\\/i.test(path)

export const suspicious = (exe: string | null, s: Signer | null) => !!exe && !!s && s.status !== 'valid' && userWritable(exe) && !packaged(exe)
const unsigned = (s: Signer | null, exe: string | null = null) => !!s && s.status !== 'valid' && !packaged(exe)
export const isMicrosoft = (s: Signer | null) => s?.status === 'valid' && /microsoft/i.test(s.publisher ?? '')

/** Resolvers people choose on purpose; the router's own address is private and fine too. */
const KNOWN_DNS = /^(1\.1\.1\.1|1\.0\.0\.1|8\.8\.8\.8|8\.8\.4\.4|9\.9\.9\.9|149\.112\.112\.112|208\.67\.22[02]\.22[02]|94\.140\.1[45]\.1[45]|2606:4700:4700::1(00)?1|2001:4860:4860::88(88|44))$/
const privateIp = (ip: string) => /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|127\.|169\.254\.|fe80:|fd|fc|::1$)/i.test(ip)

export interface Context {
  now: number
  /** DNS servers of the internet adapter. */
  dns: string[]
  /** Programs talking to the internet: name and file. */
  online: { app: string; path: string | null }[]
  signers: Map<string, Signer>
  geo: (ip: string) => { org: string | null }
  /** Netplain's own program: unsigned builds start at login and go online too, and are not a finding. */
  self: string
}

const names = (xs: string[]) => [...new Set(xs)].slice(0, 5).join(', ')
const days = (from: string, now: number) => Math.floor((now - new Date(`${from}T00:00:00`).getTime()) / 86_400_000)

/** Turns what was read into the "was I hacked?" list, worst first. */
export function findings(s: Omit<Security, 'findings'>, c: Context): Finding[] {
  const out: Finding[] = []
  const add = (f: Finding) => out.push(f)

  const d = s.defender
  if (!d || !d.av) add({ key: 'defenderOff', level: 'bad', params: {}, fix: 'openDefender', tab: 'antivirus' })
  else {
    if (!d.rt) add({ key: 'realtimeOff', level: 'bad', params: {}, fix: 'openDefender', tab: 'antivirus' })
    if (d.sigAge > 7) add({ key: 'signaturesOld', level: 'warn', params: { days: d.sigAge }, fix: 'openDefender', tab: 'antivirus' })
    const active = s.threats.filter((t) => t.active)
    if (active.length) add({ key: 'threatsActive', level: 'bad', params: { n: active.length, names: names(active.map((t) => t.name)) }, tab: 'antivirus' })
    if (d.rt && d.sigAge <= 7 && !active.length) add({ key: 'defenderOk', level: 'ok', params: {}, tab: 'antivirus' })
    if (d.quickAge > 14) add({ key: 'scanOld', level: 'info', params: { days: d.quickAge }, tab: 'antivirus' })
  }

  const off = s.firewall.filter((f) => !f.on).map((f) => f.name)
  add(off.length ? { key: 'firewallOff', level: 'bad', params: { profiles: off.join(', ') }, fix: 'firewallOn' } : { key: 'firewallOk', level: 'ok', params: {} })
  if (s.openRules.length) add({ key: 'publicOpen', level: 'info', params: { n: s.openRules.length, names: names(s.openRules) }, fix: 'openFirewall' })

  if (s.uac.lua === 0) add({ key: 'uacOff', level: 'bad', params: {} })
  else if (s.uac.consent === 0) add({ key: 'uacSilent', level: 'warn', params: {} })
  else add({ key: 'uacOk', level: 'ok', params: {} })

  if (s.rdpDenied === 0) add({ key: 'rdpOn', level: 'warn', params: {} })
  if (s.sac === 1) add({ key: 'sacOn', level: 'ok', params: {} })

  const builtin = s.users.find((u) => u.sid.endsWith('-500'))
  if (builtin?.enabled) add({ key: 'builtinAdmin', level: 'warn', params: { name: builtin.name }, tab: 'users' })
  const others = s.users.filter((u) => u.admin && u.enabled && !u.me && !u.sid.endsWith('-500'))
  if (others.length) add({ key: 'otherAdmins', level: 'info', params: { names: names(others.map((u) => u.name)) }, tab: 'users' })

  const mine = (p: string | null) => p?.toLowerCase() === c.self.toLowerCase()
  const badStart = s.startup.filter((x) => x.enabled && !mine(x.exe) && suspicious(x.exe, x.signer))
  if (badStart.length) add({ key: 'startupSuspicious', level: 'warn', params: { names: names(badStart.map((x) => x.name)) }, tab: 'startup' })
  const plainStart = s.startup.filter((x) => x.enabled && !mine(x.exe) && unsigned(x.signer, x.exe) && !suspicious(x.exe, x.signer))
  if (plainStart.length) add({ key: 'startupUnsigned', level: 'info', params: { names: names(plainStart.map((x) => x.name)) }, tab: 'startup' })

  const badSvc = s.services.filter((x) => x.start !== 'Disabled' && (suspicious(x.exe, x.signer) || (unsigned(x.signer, x.exe) && x.state === 'Running')))
  if (badSvc.length) add({ key: 'servicesUnsigned', level: 'warn', params: { names: names(badSvc.map((x) => x.display || x.name)) }, tab: 'services' })

  const netBad = c.online.filter((p) => p.path && !mine(p.path) && !isMicrosoft(c.signers.get(p.path) ?? null) && unsigned(c.signers.get(p.path) ?? null, p.path))
  if (netBad.length) add({ key: 'netUnsigned', level: 'warn', params: { names: names(netBad.map((p) => p.app)) } })

  // hosts lines sending real-looking names to another real address (not blocking, not local tooling).
  const redirects = s.hosts.filter((line) => {
    const [ip, ...hosts] = line.split(/\s+/)
    return !/^(127\.|0\.0\.0\.0$|::1$)/.test(ip) && hosts.some((h) => h.includes('.') && !/(\.internal|\.local|\.lan|\.test|\.localhost|\.home\.arpa)$/i.test(h))
  })
  if (redirects.length) add({ key: 'hostsRedirect', level: 'warn', params: { lines: redirects.slice(0, 3).join('; ') } })

  if (s.proxy.on === 1 || s.proxy.pac) add({ key: 'proxyOn', level: 'warn', params: { server: s.proxy.pac || s.proxy.server } })

  const odd = c.dns.filter((ip) => !privateIp(ip) && !KNOWN_DNS.test(ip))
  if (odd.length) add({ key: 'dnsProvider', level: 'info', params: { servers: odd.join(', '), org: c.geo(odd[0]).org ?? '?' } })

  if (s.updated) {
    const age = days(s.updated, c.now)
    add(age > 60 ? { key: 'updatesOld', level: 'warn', params: { days: age } } : { key: 'updatesOk', level: 'ok', params: { date: s.updated } })
  }

  const rank = { bad: 0, warn: 1, info: 2, ok: 3 }
  return out.sort((a, b) => rank[a.level] - rank[b.level])
}
