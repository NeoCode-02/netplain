import { app } from 'electron'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const quote = (s: string) => (s.startsWith('--') ? s : `"${s}"`)
/** How the system starts this app: the installed program, or Electron with this folder while developing. */
const command = () => [process.env.APPIMAGE ?? process.execPath, ...(app.isPackaged ? [] : [app.getAppPath()]), '--hidden']
const login = () => {
  const [exe, ...args] = command()
  return { path: exe, args: args.map(quote) }
}

/** The XDG autostart entry (Linux has no login-item API). */
export const desktopEntry = (cmd: string[]) => ['[Desktop Entry]', 'Type=Application', 'Name=Netplain', `Exec=${cmd.map(quote).join(' ')}`, 'X-GNOME-Autostart-enabled=true', ''].join('\n')
const linuxFile = () => path.join(process.env.XDG_CONFIG_HOME || path.join(os.homedir(), '.config'), 'autostart', 'netplain.desktop')

/** Whether the system starts Netplain at login (read from the system, so a change made elsewhere shows). */
export function autostart(): boolean {
  if (process.platform === 'linux') return fs.existsSync(linuxFile())
  const s = app.getLoginItemSettings(login())
  // Windows: the Run entry exists, and Task Manager has not switched it off.
  return process.platform === 'win32' ? s.openAtLogin && s.executableWillLaunchAtLogin : s.openAtLogin
}

/** Starts Netplain in the tray at login (Windows: the Run key, macOS: login items, Linux: ~/.config/autostart). */
export function setAutostart(on: boolean) {
  if (process.platform !== 'linux') return app.setLoginItemSettings({ openAtLogin: on, ...login() })
  const f = linuxFile()
  if (!on) return fs.rmSync(f, { force: true })
  fs.mkdirSync(path.dirname(f), { recursive: true })
  fs.writeFileSync(f, desktopEntry(command()))
}
