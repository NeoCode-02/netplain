import { systemFile } from '../shared/model'
import type { Conn } from '../shared/types'
import { elevate } from './admin'

/** Why the program behind a listening port may not be stopped from here, or null when it may. */
export function stopGuard(pid: number, listening: Conn[], own: number[]): string | null {
  const c = listening.find((x) => x.pid === pid)
  if (!c || pid <= 4) return 'E_BAD_ARGS'
  if (own.includes(pid)) return 'E_NETPLAIN'
  // Without a known file it could be anything, so it is left alone.
  if (!c.path || systemFile(c.path)) return 'E_SYSTEM_PROCESS'
  return null
}

/** Ends a program: directly when it is the user's own, else through the admin prompt. */
export async function stopProcess(pid: number): Promise<void> {
  try {
    process.kill(pid)
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code
    if (code === 'ESRCH') return // already gone
    if (code !== 'EPERM') throw e
    await elevate(process.platform === 'win32' ? `taskkill /PID ${pid} /F` : `kill ${pid}`)
  }
}
