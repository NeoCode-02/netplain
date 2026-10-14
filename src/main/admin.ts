import { execFile } from 'node:child_process'
import type { Adapter, SecStartup, SecUser } from '../shared/types'
import { run } from './exec'

/** Adapter names that are safe inside a quoted command line (no quotes, no shell operators). */
export const safeName = (name: string) => /^[\w .()*#+-]{1,128}$/.test(name)

function exit(file: string, args: string[]): Promise<{ code: number; err: string }> {
  return new Promise((resolve) =>
    execFile(file, args, { windowsHide: true, timeout: 180_000, encoding: 'utf8' }, (e, _out, err) => resolve({ code: e ? (typeof e.code === 'number' ? e.code : 1) : 0, err: err ?? '' }))
  )
}

/** The PowerShell that starts `cmd /c <line>` elevated and reports a declined prompt as exit code 1223. */
export function uacScript(line: string): string {
  return [
    `try { $p = Start-Process -FilePath cmd.exe -ArgumentList '/c ${line.replace(/'/g, "''")}' -Verb RunAs -Wait -PassThru -WindowStyle Hidden; exit $p.ExitCode }`,
    // ERROR_CANCELLED, the same in every Windows language.
    'catch { $e = $_.Exception; while ($e -and -not $e.NativeErrorCode) { $e = $e.InnerException }; if ($e.NativeErrorCode -eq 1223) { exit 1223 }; exit 1 }'
  ].join(' ')
}

/**
 * Runs a command line with admin rights after the OS's own consent prompt: UAC on Windows (cmd.exe),
 * the password dialog on macOS (osascript) and Linux (pkexec, sh). Throws E_CANCELLED or E_ADMIN.
 */
export async function elevate(line: string): Promise<void> {
  const r =
    process.platform === 'win32'
      ? await exit('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', uacScript(line)])
      : process.platform === 'darwin'
        ? await exit('osascript', ['-e', `do shell script ${JSON.stringify(line)} with administrator privileges`])
        : await exit('pkexec', ['sh', '-c', line])
  const cancelled = r.code === 1223 || /-128/.test(r.err) || (process.platform === 'linux' && r.code === 126)
  if (cancelled) throw new Error('E_CANCELLED')
  if (r.code !== 0) throw new Error('E_ADMIN')
}

/** Forgets cached name lookups, so the next visit asks the DNS server again. */
export async function flushDns(): Promise<void> {
  if (process.platform === 'win32') await run('ipconfig', ['/flushdns']).catch(() => elevate('ipconfig /flushdns'))
  else if (process.platform === 'darwin') await elevate('dscacheutil -flushcache; killall -HUP mDNSResponder')
  else await run('resolvectl', ['flush-caches']).catch(() => elevate('resolvectl flush-caches'))
}

/** Gives back the adapter's address and asks the router (DHCP) for a fresh one. */
export async function renewIp(a: Adapter): Promise<void> {
  if (!safeName(a.name) || (process.platform !== 'win32' && !safeName(a.id))) throw new Error('E_BAD_ARGS')
  if (process.platform === 'win32') await elevate(`ipconfig /release "${a.name}" & ipconfig /renew "${a.name}"`)
  else if (process.platform === 'darwin') await elevate(`ipconfig set ${a.id} DHCP`)
  else await elevate(`nmcli device reapply ${a.id}`)
}

/** Switches the adapter off and on again, the classic cure for a stuck connection. */
export async function restartAdapter(a: Adapter): Promise<void> {
  if (!safeName(a.name) || (process.platform !== 'win32' && !safeName(a.id))) throw new Error('E_BAD_ARGS')
  if (process.platform === 'win32') await elevate(`netsh interface set interface name="${a.name}" admin=disabled & netsh interface set interface name="${a.name}" admin=enabled`)
  else if (process.platform === 'darwin') await elevate(`ifconfig ${a.id} down; ifconfig ${a.id} up`)
  else await elevate(`nmcli device disconnect ${a.id}; nmcli device connect ${a.id}`)
}

export type UserAction = 'disable' | 'enable' | 'unadmin'

/** Windows user names cannot hold " / \ [ ] : ; | = , + * ? < >; this is stricter still. */
export const safeUser = (name: string) => /^[\w .-]{1,64}$/.test(name)

/** The command line for a user change; group membership goes by SID, which is the same in every language. */
export function userCommand(name: string, action: UserAction): string {
  if (!safeUser(name)) throw new Error('E_BAD_ARGS')
  if (action === 'unadmin') return `powershell -NoProfile -NonInteractive -Command Remove-LocalGroupMember -SID S-1-5-32-544 -Member '${name}'`
  return `net user "${name}" /active:${action === 'disable' ? 'no' : 'yes'}`
}

/**
 * Refuses changes that could lock the owner out: touching your own account, or taking the rights of
 * the last enabled administrator. Returns an error code, or null when the change is safe.
 */
export function userGuard(users: SecUser[], name: string, action: UserAction): string | null {
  const u = users.find((x) => x.name === name)
  if (!u) return 'E_BAD_ARGS'
  if (u.me && action !== 'enable') return 'E_SELF'
  const admins = users.filter((x) => x.admin && x.enabled)
  if ((action === 'unadmin' || action === 'disable') && u.admin && u.enabled && admins.length <= 1) return 'E_LAST_ADMIN'
  return null
}

export type ServiceAction = 'start' | 'stop' | 'auto' | 'manual' | 'disabled'

/** Service names: letters, digits and a few marks; no quotes or shell operators. */
export const safeService = (name: string) => /^[\w .@$#()-]{1,256}$/.test(name)

export function serviceCommand(name: string, action: ServiceAction): string {
  if (!safeService(name)) throw new Error('E_BAD_ARGS')
  if (action === 'start' || action === 'stop') return `sc.exe ${action} "${name}"`
  return `sc.exe config "${name}" start= ${action === 'manual' ? 'demand' : action}`
}

/** Startup entry names and task paths go into commands; no quotes, shell operators or leading slash. */
export const safeStartup = (s: string) => /^[^"%&|<>^\r\n]{1,260}$/.test(s) && !s.startsWith('/')

/**
 * How to switch a startup entry, the same way Task Manager does: Run keys and the Startup folder get a
 * StartupApproved value (02… on, 03… off — reversible), tasks are enabled or disabled. `direct` runs
 * without admin rights; `line` is the same change for an elevated retry.
 */
export function startupChange(e: Pick<SecStartup, 'kind' | 'hive' | 'name'> & { approved: string }, on: boolean): { direct: [string, string[]] | null; line: string } {
  if (!safeStartup(e.name) || (e.kind !== 'task' && !safeStartup(e.approved))) throw new Error('E_BAD_ARGS')
  if (e.kind === 'task') {
    const flag = on ? '/ENABLE' : '/DISABLE'
    return { direct: ['schtasks.exe', ['/Change', '/TN', e.name, flag]], line: `schtasks.exe /Change /TN "${e.name}" ${flag}` }
  }
  if (!e.approved) throw new Error('E_BAD_ARGS') // RunOnce entries have no switch
  const key = `${e.hive}\\${e.approved}`
  const data = (on ? '02' : '03') + '0'.repeat(22)
  const args = ['add', key, '/v', e.name, '/t', 'REG_BINARY', '/d', data, '/f']
  return { direct: e.hive === 'HKCU' ? ['reg.exe', args] : null, line: `reg.exe add "${key}" /v "${e.name}" /t REG_BINARY /d ${data} /f` }
}
