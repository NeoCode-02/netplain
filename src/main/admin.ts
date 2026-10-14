import { execFile } from 'node:child_process'
import type { Adapter } from '../shared/types'
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
