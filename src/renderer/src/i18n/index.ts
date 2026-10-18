import { useSyncExternalStore } from 'react'
import { en, type Dict } from './en'
import { uz } from './uz'

export type { Dict }

export const LANGS = { en, uz }
export type Lang = keyof typeof LANGS

const KEY = 'netplain.lang'
const listeners = new Set<() => void>()

function initial(): Lang {
  try {
    const saved = localStorage.getItem(KEY)
    if (saved === 'en' || saved === 'uz') return saved
  } catch {
    // storage unavailable: fall back to the system language
  }
  return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('uz') ? 'uz' : 'en'
}

let current: Lang = initial()
if (typeof document !== 'undefined') document.documentElement.lang = current

export function setLang(l: Lang) {
  current = l
  try {
    localStorage.setItem(KEY, l)
  } catch {
    // not persisted; still applies for this session
  }
  document.documentElement.lang = l
  listeners.forEach((f) => f())
}

export const getLang = () => current

export function useT(): Dict {
  const lang = useSyncExternalStore(
    (f) => {
      listeners.add(f)
      return () => listeners.delete(f)
    },
    () => current
  )
  return LANGS[lang]
}

/** An IPC error ("Error invoking remote method 'scan': Error: E_OFFLINE", or "E_FILTER|detail") in the reader's language. */
export function errText(t: Dict, e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e)
  const m = /\b(E_[A-Z_]+)(?:\|(.*))?/.exec(msg)
  const code = m?.[1] as keyof Dict['errors'] | undefined
  const known = code && code !== 'unknown' ? t.errors[code] : undefined
  if (typeof known === 'function') return known(m?.[2] ?? '')
  return typeof known === 'string' ? known : t.errors.unknown(msg.replace(/^Error invoking remote method '\w+': (Error: )?/, ''))
}
