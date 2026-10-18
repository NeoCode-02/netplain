import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import type { Outage, QualityPoint } from '../../shared/types'
import { getLang, useT } from './i18n'

const H = 200
const PAD = { top: 10, bottom: 24, left: 52, right: 12 }
const DAY = 86_400_000
/** A gap longer than this between minutes (the app was closed) breaks the line. */
const BREAK = 150_000

/** 1, 2 or 5 × 10ⁿ ms, at least 20 ms, so the axis has clean numbers. */
function niceMs(v: number): number {
  const m = Math.max(v, 20)
  const p = 10 ** Math.floor(Math.log10(m))
  return ([1, 2, 5, 10].find((f) => f * p >= m) ?? 10) * p
}

/** Lines through the minutes that have a value; a missing value or a long gap lifts the pen. */
function path(points: QualityPoint[], key: 'internet' | 'router', x: (t: number) => number, y: (v: number) => number) {
  let d = ''
  let prev: QualityPoint | null = null
  for (const p of points) {
    const v = p[key]
    if (v === null) {
      prev = null
      continue
    }
    d += `${prev && p.at - prev.at <= BREAK ? 'L' : 'M'}${x(p.at).toFixed(1)},${y(v).toFixed(1)}`
    prev = p
  }
  return d
}

/** Response time to the internet and the router over the last 24 hours, with the drops shaded. */
export default function QualityChart({ points, outages, now }: { points: QualityPoint[]; outages: Outage[]; now: number }) {
  const t = useT()
  const u = t.uptime
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const from = now - DAY
  const shown = points.filter((p) => p.at >= from)
  const max = niceMs(Math.max(0, ...shown.map((p) => Math.max(p.internet ?? 0, p.router ?? 0))))
  const innerW = w - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const x = (at: number) => PAD.left + ((at - from) / DAY) * innerW
  const y = (v: number) => PAD.top + innerH - (Math.min(v, max) / max) * innerH
  const drops = outages.filter((o) => (o.end ?? now) > from)
  const at = hover !== null ? shown[hover] : shown.at(-1)
  const ms = (v: number | null | undefined) => (v == null ? '—' : u.ms(v))
  const clock = (v: number) => new Date(v).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' })
  // Ticks every 6 hours, on the hour.
  const ticks = Array.from({ length: 4 }, (_, i) => {
    const d = new Date(from + (i + 1) * 6 * 3_600_000)
    d.setMinutes(0, 0, 0)
    return d.getTime()
  })

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!shown.length) return
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    const time = from + ((px - PAD.left) / innerW) * DAY
    let best = 0
    for (let i = 1; i < shown.length; i++) if (Math.abs(shown[i].at - time) < Math.abs(shown[best].at - time)) best = i
    setHover(best)
  }
  const key = (e: KeyboardEvent) => {
    if (!shown.length) return
    const i = hover ?? shown.length - 1
    if (e.key === 'ArrowLeft') setHover(Math.max(0, i - 1))
    else if (e.key === 'ArrowRight') setHover(Math.min(shown.length - 1, i + 1))
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  return (
    <div className="rate" ref={box}>
      <div className="rate-legend">
        <span className="rate-key">
          <i className="key down" />
          <strong>{ms(at?.internet)}</strong>
          <span>{u.internet}</span>
        </span>
        <span className="rate-key">
          <i className="key up" />
          <strong>{ms(at?.router)}</strong>
          <span>{u.router}</span>
        </span>
        {drops.length > 0 && (
          <span className="rate-key">
            <i className="key drop" />
            <span>{u.outages}</span>
          </span>
        )}
        <span className="rate-when">
          {at ? clock(at.at) : ''}
          {at && at.loss > 0 ? ` · ${u.lost(Math.round(at.loss * 100))}` : ''}
        </span>
      </div>
      <svg
        width={w}
        height={H}
        className="rate-plot"
        tabIndex={0}
        role="img"
        aria-label={u.chartLabel(ms(shown.at(-1)?.internet), ms(shown.at(-1)?.router))}
        onPointerMove={pick}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {drops.map((o) => {
          const x0 = x(Math.max(o.start, from))
          return <rect key={o.id} x={x0} y={PAD.top} width={Math.max(2, x(o.end ?? now) - x0)} height={innerH} className="band" />
        })}
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={PAD.left - 8} y={y(max * f)} className="tick" textAnchor="end" dominantBaseline="middle">
              {u.ms(max * f)}
            </text>
          </g>
        ))}
        {ticks
          .filter((tk) => x(tk) > PAD.left + 28 && x(tk) < w - PAD.right - 28)
          .map((tk) => (
            <text key={tk} x={x(tk)} y={H - 6} className="tick" textAnchor="middle">
              {clock(tk)}
            </text>
          ))}
        <path d={path(shown, 'router', x, y)} className="series up" />
        <path d={path(shown, 'internet', x, y)} className="series down" />
        {hover !== null && at && (
          <>
            <line x1={x(at.at)} x2={x(at.at)} y1={PAD.top} y2={PAD.top + innerH} className="cross" />
            {at.router !== null && <circle cx={x(at.at)} cy={y(at.router)} r={4} className="end up" />}
            {at.internet !== null && <circle cx={x(at.at)} cy={y(at.internet)} r={4} className="end down" />}
          </>
        )}
      </svg>
    </div>
  )
}
