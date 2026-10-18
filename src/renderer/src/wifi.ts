import type { WifiNet } from '../../shared/types'

type Band = '2.4' | '5'
/** Channels worth moving to: the three that never overlap on 2.4 GHz, and the 5 GHz ones without radar rules. */
export const CANDIDATES: Record<Band, number[]> = { '2.4': [1, 6, 11], '5': [36, 40, 44, 48, 149, 153, 157, 161] }

/**
 * How crowded a channel is: every network counts by its signal (0–1). On 2.4 GHz neighbours up to
 * four channels away overlap partly; on 5 GHz the next channel counts half, as wide routers bond it.
 */
export function load(nets: WifiNet[], band: Band, ch: number): number {
  let sum = 0
  for (const n of nets) {
    if (n.band !== band || n.channel === null) continue
    const d = Math.abs(n.channel - ch)
    sum += (band === '2.4' ? Math.max(0, 1 - d / 5) : d === 0 ? 1 : d === 4 ? 0.5 : 0) * (n.signal / 100)
  }
  return Math.round(sum * 100) / 100
}

/** The quietest candidate channel of a band, and whether moving there from `current` is worth it. */
export function advice(nets: WifiNet[], band: Band, current: number | null, mine: (n: WifiNet) => boolean) {
  const others = nets.filter((n) => !mine(n))
  const best = CANDIDATES[band].map((ch) => ({ ch, load: load(others, band, ch) })).reduce((a, b) => (b.load < a.load ? b : a))
  const now = current === null ? null : load(others, band, current)
  return { best: best.ch, move: now !== null && best.ch !== current && now - best.load >= 0.3 }
}

/** Networks per channel, for the chart: every 2.4 GHz channel, and the 5 GHz ones in use (plus yours). */
export function perChannel(nets: WifiNet[], band: Band, extra: (number | null)[] = []): { ch: number; count: number }[] {
  const seen = nets.filter((n) => n.band === band && n.channel !== null).map((n) => n.channel!)
  const chans = band === '2.4' ? Array.from({ length: 13 }, (_, i) => i + 1) : [...new Set([...seen, ...extra.filter((x): x is number => x !== null)])].sort((a, b) => a - b)
  return chans.map((ch) => ({ ch, count: seen.filter((c) => c === ch).length }))
}

/** Protection that others nearby could break or simply read. */
export const weak = (n: WifiNet) => n.security === 'open' || n.security === 'wep' || n.security === 'wpa' || n.tkip
