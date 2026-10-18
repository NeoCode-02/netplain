import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { HostsEntry, HostsOp } from '../shared/types'
import { elevate, safeStartup } from './admin'

export const HOSTS = process.platform === 'win32' ? path.join(process.env.SystemRoot ?? 'C:\\Windows', 'System32', 'drivers', 'etc', 'hosts') : '/etc/hosts'
/** Entries switched off here become comments with this mark, so they can be switched on again. */
const OFF = '#netplain-off '
const NAME = /^(?=.{1,253}$)[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?(\.[a-z0-9_]([a-z0-9_-]{0,62}[a-z0-9_])?)*$/i

/** Address lines of a hosts file (plain comments and blank lines are not entries). */
export function parseHosts(text: string): HostsEntry[] {
  const out: HostsEntry[] = []
  text.split(/\r?\n/).forEach((raw, line) => {
    const on = !raw.startsWith(OFF)
    const [body, ...note] = (on ? raw : raw.slice(OFF.length)).split('#')
    const [ip, ...names] = body.trim().split(/\s+/)
    if (net.isIP(ip) && names.length) out.push({ line, ip, names, on, comment: note.join('#').trim() })
  })
  return out
}

/** The file after one change. Throws E_BAD_ARGS for a bad address or name, E_HOSTS_CHANGED when the line moved meanwhile. */
export function applyHosts(text: string, op: HostsOp): string {
  const eol = text.includes('\r\n') ? '\r\n' : '\n'
  const lines = text.split(/\r?\n/)
  if (op.kind === 'add') {
    if (!net.isIP(op.ip) || !NAME.test(op.name)) throw new Error('E_BAD_ARGS')
    const end = lines.at(-1) === '' ? lines.length - 1 : lines.length
    lines.splice(end, 0, `${op.ip}\t${op.name}`)
    return lines.join(eol)
  }
  const e = parseHosts(text).find((x) => x.line === op.line && x.ip === op.ip)
  if (!e) throw new Error('E_HOSTS_CHANGED')
  if (op.kind === 'remove') lines.splice(op.line, 1)
  else lines[op.line] = e.on ? OFF + lines[op.line] : lines[op.line].slice(OFF.length)
  return lines.join(eol)
}

export const readHosts = () => fs.readFileSync(HOSTS, 'utf8')

/** Writes the file through the admin prompt, keeping the previous one as hosts.netplain.bak next to it. Throws E_HOSTS_WRITE. */
export async function writeHosts(next: string, dir: string): Promise<void> {
  fs.mkdirSync(dir, { recursive: true })
  const tmp = path.join(dir, 'hosts.netplain')
  fs.writeFileSync(tmp, next)
  if (!safeStartup(tmp) || tmp.includes("'")) throw new Error('E_BAD_ARGS')
  const bak = `${HOSTS}.netplain.bak`
  await elevate(process.platform === 'win32' ? `copy /y "${HOSTS}" "${bak}" >nul & copy /y "${tmp}" "${HOSTS}" >nul` : `cp '${HOSTS}' '${bak}' && cp '${tmp}' '${HOSTS}'`)
  // The elevated exit code can be lost on the way back; the file itself tells (an antivirus may guard it).
  if (readHosts() !== next) throw new Error('E_HOSTS_WRITE')
}
