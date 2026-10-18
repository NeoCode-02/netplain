import { useEffect, useState } from 'react'
import type { CapState, Usage, UsageRange, UsageRow } from '../../../shared/types'
import CapMeter from '../CapMeter'
import { bytes } from '../format'
import { useT } from '../i18n'
import { AppIcon, Page, Tabs } from '../ui'
import UsageChart from '../UsageChart'

function Rows({ rows, icons }: { rows: UsageRow[]; icons: boolean }) {
  const t = useT()
  const max = Math.max(1, ...rows.map((r) => r.rx + r.tx))
  return (
    <div className="list">
      {rows.slice(0, 20).map((r) => (
        <div className="list-row mini usage-row" key={r.key}>
          {icons && <AppIcon path={r.path} />}
          <div className="app-main">
            <div className="ellipsis">{r.key === '?' ? t.apps.unknown : icons ? (t.procs[r.name] ?? r.name) : r.name}</div>
            <div className="share" aria-hidden>
              <span style={{ width: `${Math.max(1, ((r.rx + r.tx) / max) * 100)}%` }} />
            </div>
          </div>
          <span className="num small">
            <i className="key down" /> {bytes(r.rx)}
          </span>
          <span className="num small">
            <i className="key up" /> {bytes(r.tx)}
          </span>
        </div>
      ))}
    </div>
  )
}

export default function History() {
  const t = useT()
  const h = t.history
  const [range, setRange] = useState<UsageRange>('day')
  const [u, setU] = useState<Usage | null>(null)
  const [cap, setCap] = useState<CapState | null>(null)

  useEffect(() => {
    const load = () => {
      window.netplain.usage(range).then(setU, () => {})
      window.netplain.dataCap().then(setCap, () => {})
    }
    load()
    const timer = setInterval(load, 30_000)
    return () => clearInterval(timer)
  }, [range])

  return (
    <Page title={h.title} note={h.lead} tabs={<Tabs value={range} options={['day', 'week', 'month'] as const} text={(r) => h.ranges[r]} onChange={setRange} />}>
      {cap && <CapMeter t={t} c={cap} />}
      {u && (
        <>
          <section className={`panel panel-pad${cap ? ' section' : ''}`}>
            <div className="section-head">
              <h3>{h.chart}</h3>
            </div>
            {u.rx + u.tx > 0 ? <UsageChart points={u.points} range={range} /> : <p className="list-empty">{h.empty}</p>}
          </section>
          <div className="overview-grid section">
            <section>
              <div className="section-head">
                <h3>{h.apps}</h3>
              </div>
              {u.apps.length ? <Rows rows={u.apps} icons /> : <p className="note">{h.noApps}</p>}
            </section>
            <section>
              <div className="section-head">
                <h3>{h.adapters}</h3>
              </div>
              {u.adapters.length ? <Rows rows={u.adapters} icons={false} /> : <p className="list-empty">{h.empty}</p>}
            </section>
          </div>
        </>
      )}
    </Page>
  )
}
