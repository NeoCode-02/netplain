import type { CapState } from '../../shared/types'
import { bytes } from '../../shared/format'
import { getLang, type Dict } from './i18n'

const capPct = (c: CapState) => Math.round((c.used / c.limit) * 100)

/** "12 GB of 50 GB used on Phone (24%)", and when the count starts again. */
export function capText(t: Dict, c: CapState): [string, string] {
  const date = new Date(c.end).toLocaleDateString(getLang(), { day: 'numeric', month: 'long' })
  return [t.cap.meter(bytes(c.used), bytes(c.limit), capPct(c), c.name), t.cap.resets(date)]
}

/** How much of the monthly data limit is used. */
export default function CapMeter({ t, c }: { t: Dict; c: CapState }) {
  const pct = capPct(c)
  const [used, resets] = capText(t, c)
  return (
    <section className="panel panel-pad stack tight">
      <div className="setting">
        <h3>{t.cap.title}</h3>
        <span className="small muted">{resets}</span>
      </div>
      <div className="meter" role="meter" aria-label={t.cap.title} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.min(100, pct)}>
        <span className={pct >= 100 ? 'bad' : pct >= 80 ? 'warn' : undefined} style={{ width: `${Math.min(100, pct)}%` }} />
      </div>
      <p className="small">{used}</p>
    </section>
  )
}
