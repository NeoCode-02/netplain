import fs from 'node:fs'
import path from 'node:path'
import type { AlertKind, Settings } from '../shared/types'

const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark']
const KINDS: readonly AlertKind[] = ['newApp', 'exposed', 'plain', 'blocklist']
const defaults = (): Settings => ({ theme: 'system', capture: true, alerts: { newApp: true, exposed: true, plain: true, blocklist: true }, blocklist: '' })

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype

/** Exact shape check for settings sent by the UI. */
export function isSettings(v: unknown): v is Settings {
  return (
    obj(v) &&
    THEMES.includes(v.theme as Settings['theme']) &&
    typeof v.capture === 'boolean' &&
    obj(v.alerts) &&
    KINDS.every((k) => typeof (v.alerts as Record<string, unknown>)[k] === 'boolean') &&
    typeof v.blocklist === 'string' &&
    v.blocklist.length <= 200_000
  )
}

/** Settings from disk: every valid key is kept (older files lack newer ones), the rest default. */
export function loadSettings(file: string): Settings {
  const d = defaults()
  let s: unknown
  try {
    s = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return d
  }
  if (!obj(s)) return d
  const alerts = obj(s.alerts) ? s.alerts : {}
  return {
    theme: THEMES.includes(s.theme as Settings['theme']) ? (s.theme as Settings['theme']) : d.theme,
    capture: typeof s.capture === 'boolean' ? s.capture : d.capture,
    alerts: Object.fromEntries(KINDS.map((k) => [k, typeof alerts[k] === 'boolean' ? alerts[k] : d.alerts[k]])) as Settings['alerts'],
    blocklist: typeof s.blocklist === 'string' && s.blocklist.length <= 200_000 ? s.blocklist : d.blocklist
  }
}

export function saveSettings(file: string, s: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
