import { execFile } from 'node:child_process'
import path from 'node:path'
import type { ScanKind, ScanState } from '../shared/types'
import { elevate } from './admin'

/** Microsoft Defender's command-line tool; this copy always forwards to the current engine version. */
export const MPCMD = path.join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Windows Defender', 'MpCmdRun.exe')

export const scanArgs = (kind: ScanKind) => ['-Scan', '-ScanType', kind === 'quick' ? '1' : '2']

function exitCode(file: string, args: string[], timeout: number): Promise<number> {
  return new Promise((resolve) => execFile(file, args, { windowsHide: true, timeout }, (e) => resolve(e ? (typeof e.code === 'number' ? e.code : 1) : 0)))
}

/** One scan at a time; standard users may scan, and when Windows says no the user can retry with admin rights. */
export function createScanner(onDone: () => void) {
  let state: ScanState = { running: null, started: null, last: null }

  async function scan(kind: ScanKind, admin: boolean) {
    if (state.running) throw new Error('E_BUSY')
    state = { ...state, running: kind, started: Date.now() }
    let code = 0
    try {
      // A full scan can take hours; nothing should cut it short.
      if (admin) await elevate(`"${MPCMD}" ${scanArgs(kind).join(' ')}`)
      else code = await exitCode(MPCMD, scanArgs(kind), 0)
    } catch (e) {
      code = (e as Error).message === 'E_CANCELLED' ? -1 : 1
    } finally {
      state = { running: null, started: null, last: { kind, at: Date.now(), code } }
      onDone()
    }
  }

  return {
    state: () => state,
    /** Starts a scan and returns at once; poll `state()`. */
    start(kind: ScanKind, admin: boolean) {
      void scan(kind, admin)
    },
    /** Downloads the newest definitions (works without admin rights on most PCs). */
    async updateDefinitions() {
      if ((await exitCode(MPCMD, ['-SignatureUpdate'], 10 * 60_000)) !== 0) throw new Error('E_ADMIN')
    },
    /** Lets Defender clean up every active threat (admin rights, UAC). */
    removeThreats: () => elevate('powershell -NoProfile -NonInteractive -Command Remove-MpThreat')
  }
}
