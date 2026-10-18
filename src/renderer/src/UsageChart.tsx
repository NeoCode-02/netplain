import { useEffect, useRef, useState, type KeyboardEvent } from 'react'
import type { UsagePoint, UsageRange } from '../../shared/types'
import { bytes } from '../../shared/format'
import { getLang, useT } from './i18n'
import { niceMax } from './RateChart'

const H = 200
const PAD = { top: 10, bottom: 24, left: 64, right: 8 }
const GAP = 2

/** A column with only its top corners rounded (the data end), square on the baseline. */
const column = (x: number, y: number, w: number, h: number, r: number) => {
  const rr = Math.min(r, h, w / 2)
  return `M${x},${y + h}V${y + rr}Q${x},${y} ${x + rr},${y}H${x + w - rr}Q${x + w},${y} ${x + w},${y + rr}V${y + h}Z`
}

/** Download and upload per hour or day, stacked: download on the baseline, upload on top. */
export default function UsageChart({ points, range }: { points: UsagePoint[]; range: UsageRange }) {
  const t = useT()
  const box = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(700)
  const [hover, setHover] = useState<number | null>(null)

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.max(260, e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const max = niceMax(Math.max(0, ...points.map((p) => p.rx + p.tx)))
  const innerW = w - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom
  const slot = innerW / Math.max(1, points.length)
  const bw = Math.min(24, slot * 0.62)
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH
  const lang = getLang()
  const label = (p: UsagePoint) =>
    range === 'day'
      ? new Date(p.at).toLocaleTimeString(lang, { hour: '2-digit', minute: '2-digit' })
      : new Date(p.at).toLocaleDateString(lang, { weekday: range === 'week' ? 'short' : undefined, day: 'numeric', month: 'short' })
  const tick = (i: number) => (range === 'day' ? i % 6 === 0 : range === 'week' ? true : i % 5 === 0)
  const shown = hover !== null ? points[hover] : null
  const total = points.reduce((a, p) => [a[0] + p.rx, a[1] + p.tx], [0, 0])

  const key = (e: KeyboardEvent) => {
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
          <strong>{bytes(shown ? shown.rx : total[0])}</strong>
          <span>{t.network.download}</span>
        </span>
        <span className="rate-key">
          <i className="key up" />
          <strong>{bytes(shown ? shown.tx : total[1])}</strong>
          <span>{t.network.upload}</span>
        </span>
        <span className="rate-when">{shown ? label(shown) : t.history.total}</span>
      </div>
      <svg
        width={w}
        height={H}
        className="rate-plot"
        tabIndex={0}
        role="img"
        aria-label={t.history.chartLabel(bytes(total[0]), bytes(total[1]))}
        onKeyDown={key}
        onBlur={() => setHover(null)}
        onPointerLeave={() => setHover(null)}
      >
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.left} x2={w - PAD.right} y1={y(max * f)} y2={y(max * f)} className="grid" />
            <text x={PAD.left - 8} y={y(max * f)} className="tick" textAnchor="end" dominantBaseline="middle">
              {bytes(max * f)}
            </text>
          </g>
        ))}
        {points.map((p, i) => {
          const x = PAD.left + i * slot + (slot - bw) / 2
          const hDown = (p.rx / max) * innerH
          const hUp = (p.tx / max) * innerH
          const base = PAD.top + innerH
          return (
            <g key={p.at} onPointerEnter={() => setHover(i)}>
              {/* The whole slot is the hover target, not only the painted bar. */}
              <rect x={PAD.left + i * slot} y={PAD.top} width={slot} height={innerH} className={`hit ${hover === i ? 'on' : ''}`} />
              {hDown > 0 && <path d={hUp > 0 ? `M${x},${base}V${base - hDown}H${x + bw}V${base}Z` : column(x, base - hDown, bw, hDown, 4)} className="bar down" />}
              {hUp > 0 && <path d={column(x, base - hDown - (hDown > 0 ? GAP : 0) - hUp, bw, hUp, 4)} className="bar up" />}
              {tick(i) && (
                <text x={PAD.left + i * slot + slot / 2} y={H - 6} className="tick" textAnchor="middle">
                  {range === 'day' ? String(new Date(p.at).getHours()).padStart(2, '0') : new Date(p.at).toLocaleDateString(lang, range === 'week' ? { weekday: 'short' } : { day: 'numeric' })}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}
