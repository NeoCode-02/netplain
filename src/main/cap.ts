import path from 'node:path'
import type { CapState, DataCap } from '../shared/types'
import { readJson, writeJson } from './store'

/** Warnings at these shares of the limit, each once per period. */
const STEPS = [80, 100]

/** The billing period `now` falls in: from the reset day (local midnight) to the next one. */
export function period(resetDay: number, now: number): { start: number; end: number } {
  const d = new Date(now)
  const m = d.getMonth() - (d.getDate() < resetDay ? 1 : 0)
  return { start: new Date(d.getFullYear(), m, resetDay).getTime(), end: new Date(d.getFullYear(), m + 1, resetDay).getTime() }
}

/** The steps newly reached; only the highest is told, all count as told. */
export const crossed = (pct: number, told: number[]) => STEPS.filter((s) => pct >= s && !told.includes(s))

/** The limit's name part of a network key: "wifi:Home" → "Home". */
export const networkName = (key: string) => key.slice(key.indexOf(':') + 1)

interface Deps {
  cap: () => DataCap | null
  used: (network: string, from: number, now: number) => number
  tell: (step: number, name: string | null, used: number, limit: number) => void
}

export function createCap(dir: string, d: Deps) {
  const file = path.join(dir, 'cap.json')
  let told = readJson<{ key: string; steps: number[] }>(file, { key: '', steps: [] })

  function state(now = Date.now()): CapState | null {
    const c = d.cap()
    if (!c) return null
    const p = period(c.day, now)
    return { network: c.network, name: c.network ? networkName(c.network) : null, used: d.used(c.network, p.start, now), limit: c.gb * 1e9, start: p.start, end: p.end }
  }

  return {
    state,
    /** Run every minute and when the limit changes: tells about 80 % and 100 % once per period and limit. */
    check(now = Date.now()) {
      const s = state(now)
      if (!s) return
      const key = `${s.start}|${s.network}|${s.limit}`
      if (told.key !== key) told = { key, steps: [] }
      const steps = crossed((s.used / s.limit) * 100, told.steps)
      if (!steps.length) return
      told.steps.push(...steps)
      writeJson(file, told)
      d.tell(Math.max(...steps), s.name, s.used, s.limit)
    }
  }
}
