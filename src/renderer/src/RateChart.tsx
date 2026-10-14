import { useEffect, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import { bits } from './format'
import { useT } from './i18n'
import { KEEP, type Point } from './live'

const H = 190
const PAD = { top: 10, bottom: 4, left: 64, right: 10 }
const MIN_MAX = 8_000

/** Rounds up to 1, 2 or 5 × 10ⁿ so axis ticks are clean numbers. */
export function niceMax(v: number): number {
  const m = Math.max(v, MIN_MAX)
  const p = 10 ** Math.floor(Math.log10(m))
  return ([1, 2, 5, 10].find((f) => f * p >= m) ?? 10) * p
}

/** Live download/upload lines for the last minute, newest on the right. */
export default function RateChart({ points }: { points: Point[] }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(600)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(200, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = niceMax(Math.max(0, ...points.map((p) => Math.max(p.down, p.up))))
  const innerW = w - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const step = innerW / (KEEP - 1)
  const x = (i: number) => PAD.left + innerW - (points.length - 1 - i) * step
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const line = (key: 'down' | 'up') => points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p[key]).toFixed(1)}`).join('')
  const last = points.at(-1)
  const shown = hover !== null ? points[hover] : last
  const peak = Math.max(0, ...points.map((p) => p.down))

  const pick = (e: PointerEvent<SVGSVGElement>) => {
    if (!points.length) return
    const px = e.clientX - e.currentTarget.getBoundingClientRect().left
    const i = Math.round(points.length - 1 - (PAD.left + innerW - px) / step)
    setHover(Math.max(0, Math.min(points.length - 1, i)))
  }
  const key = (e: KeyboardEvent) => {
    if (!points.length) return
    const at = hover ?? points.length - 1
    if (e.key === 'ArrowLeft') setHover(Math.max(0, at - 1))
    else if (e.key === 'ArrowRight') setHover(Math.min(points.length - 1, at + 1))
    else if (e.key === 'Escape') setHover(null)
    else return
    e.preventDefault()
  }

  return (
    <div className="rate" ref={box}>
      <div className="rate-legend">
        <span className="rate-key">
          <i className="key down" />
          <strong>{bits(shown?.down ?? 0)}</strong>
          <span>{t.network.download}</span>
        </span>
        <span className="rate-key">
          <i className="key up" />
          <strong>{bits(shown?.up ?? 0)}</strong>
          <span>{t.network.upload}</span>
        </span>
        <span className="rate-when">{shown && last ? t.network.secondsAgo(Math.round((last.t - shown.t) / 1000)) : ''}</span>
      </div>
      <svg
        width={w}
        height={H}
        className="rate-plot"
        tabIndex={0}
        role="img"
        aria-label={t.network.chartLabel(bits(last?.down ?? 0), bits(last?.up ?? 0))}
        onPointerMove={pick}
        onPointerLeave={() => setHover(null)}
        onKeyDown={key}
        onBlur={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={PAD.left - 8} y={y(max * f)} className="tick" textAnchor="end" dominantBaseline="middle">
              {bits(max * f)}
            </text>
          </g>
        ))}
        {points.length > 1 && (
          <>
            <path d={line('up')} className="series up" />
            <path d={line('down')} className="series down" />
          </>
        )}
        {hover !== null && points[hover] && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={H - PAD.bottom} className="cross" />}
        {shown &&
          (['up', 'down'] as const).map((k) => (
            <circle key={k} cx={x(hover ?? points.length - 1)} cy={y(shown[k])} r={4} className={`end ${k}`} />
          ))}
      </svg>
      <div className="rate-foot">{t.network.peak(bits(peak))}</div>
    </div>
  )
}
