import fs from 'node:fs'
import path from 'node:path'
import type { AlertKind, Settings } from '../shared/types'

const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark']
const defaults = (): Settings => ({
  theme: 'system',
  capture: true,
  alerts: { newApp: true, exposed: true, plain: true, blocklist: true },
  blocklist: '',
  updates: true,
  // Some Linux desktops show no tray icon; a closed window would leave the app unreachable there.
  background: process.platform !== 'linux',
  autostart: false
})
const KINDS = Object.keys(defaults().alerts) as AlertKind[]

const obj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype
const bool = (v: unknown) => typeof v === 'boolean'

/** One check per key: TypeScript fails here when Settings gets a key without one. */
const FIELDS: Record<keyof Settings, (v: unknown) => boolean> = {
  theme: (v) => THEMES.includes(v as Settings['theme']),
  capture: bool,
  alerts: (v) => obj(v) && KINDS.every((k) => bool(v[k])),
  blocklist: (v) => typeof v === 'string' && v.length <= 200_000,
  updates: bool,
  background: bool,
  autostart: bool
}
const KEYS = Object.keys(FIELDS) as (keyof Settings)[]

/** Exact shape check for settings sent by the UI. */
export const isSettings = (v: unknown): v is Settings => obj(v) && KEYS.every((k) => FIELDS[k](v[k]))

/** Only the known keys, each valid one kept and the rest default (files from older versions lack newer keys). */
export function normalize(s: unknown): Settings {
  const out = defaults()
  if (!obj(s)) return out
  for (const k of KEYS) if (k !== 'alerts' && FIELDS[k](s[k])) (out as unknown as Record<string, unknown>)[k] = s[k]
  const alerts = obj(s.alerts) ? s.alerts : {}
  for (const k of KINDS) if (bool(alerts[k])) out.alerts[k] = alerts[k] as boolean
  return out
}

export function loadSettings(file: string): Settings {
  try {
    return normalize(JSON.parse(fs.readFileSync(file, 'utf8')))
  } catch {
    return defaults()
  }
}

export function saveSettings(file: string, s: Settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(`${file}.tmp`, JSON.stringify(s, null, 2))
  fs.renameSync(`${file}.tmp`, file)
}
