import net from 'node:net'
import type { Blocked } from '../shared/types'
import { safeStartup } from './admin'
import { isPrivate } from './net'
import { powershell } from './security'

/** Every rule Netplain makes starts with this, and it touches no other. */
export const PREFIX = 'Netplain: '

/** Addresses worth blocking: on the internet, not this computer or the home network. */
export const publicIp = (ip: string) => net.isIP(ip) !== 0 && !isPrivate(ip) && !/^(127\.|0\.|169\.254\.|::1$|fe80:|f[cd][0-9a-f]{2}:)/i.test(ip)

/** The elevated command line that blocks a program's internet (outbound) or an address (both ways). */
export function blockCommand(t: { program: string } | { ip: string }): string {
  if ('program' in t) {
    // Windows's own parts (svchost carries DNS and updates) would take the whole internet down with them.
    if (!safeStartup(t.program) || !/^[a-z]:\\/i.test(t.program) || /^[a-z]:\\windows\\/i.test(t.program)) throw new Error('E_BAD_ARGS')
    return `netsh advfirewall firewall add rule name="${PREFIX}${t.program}" dir=out action=block program="${t.program}" enable=yes`
  }
  if (!publicIp(t.ip)) throw new Error('E_BAD_ARGS')
  const rule = (dir: string) => `netsh advfirewall firewall add rule name="${PREFIX}${t.ip}" dir=${dir} action=block remoteip=${t.ip} enable=yes`
  return `${rule('out')} & ${rule('in')}`
}

export function unblockCommand(name: string): string {
  if (!name.startsWith(PREFIX) || !safeStartup(name)) throw new Error('E_BAD_ARGS')
  return `netsh advfirewall firewall delete rule name="${name}"`
}

/** Netplain's rules from PowerShell's JSON (one object or a list), merged by name across directions. */
export function parseBlocked(json: string): Blocked[] {
  let rows: { name?: unknown; program?: unknown; remote?: unknown }[]
  try {
    const v = JSON.parse(json || '[]')
    rows = Array.isArray(v) ? v : [v]
  } catch {
    return []
  }
  const out = new Map<string, Blocked>()
  for (const r of rows) {
    if (typeof r.name !== 'string' || !r.name.startsWith(PREFIX)) continue
    const program = typeof r.program === 'string' && r.program !== 'Any' ? r.program : null
    const ip = typeof r.remote === 'string' && r.remote !== 'Any' ? r.remote : null
    out.set(r.name, { name: r.name, program, ip })
  }
  return [...out.values()]
}

/** The block rules Netplain made (reading the firewall needs no admin rights). */
export async function blockedList(): Promise<Blocked[]> {
  const out = await powershell(`
$ErrorActionPreference = 'SilentlyContinue'
@(Get-NetFirewallRule -DisplayName '${PREFIX}*' | ForEach-Object {
  [pscustomobject]@{ name = $_.DisplayName; program = ($_ | Get-NetFirewallApplicationFilter).Program; remote = (($_ | Get-NetFirewallAddressFilter).RemoteAddress -join ',') }
}) | ConvertTo-Json -Compress
`)
  return parseBlocked(out)
}
