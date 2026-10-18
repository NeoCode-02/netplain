import { useEffect, useState } from 'react'
import type { ScanKind, ScanState, Security } from '../../../../shared/types'
import { behavioural, threatParts } from '../../explain'
import { useAction } from '../../hooks'
import { getLang, type Dict } from '../../i18n'
import { ErrNote, Icon } from '../../ui'

const NEVER = 100_000
const clock = (ms: number) => `${Math.floor(ms / 60_000)}:${String(Math.floor(ms / 1000) % 60).padStart(2, '0')}`

/** Microsoft Defender: protection state, scans, definitions and the threats it found. */
export default function Antivirus({ sec, t, onChanged }: { sec: Security; t: Dict; onChanged(): void }) {
  const a = t.security.av
  const lang = getLang()
  const d = sec.defender
  const [scan, setScan] = useState<ScanState | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const { busy, err, run: act } = useAction()
  const [note, setNote] = useState<string | null>(null)

  // While a scan runs, its state is asked for every two seconds.
  useEffect(() => {
    let stop = false
    const poll = async () => {
      const s = await window.netplain.scanState()
      if (stop) return
      setScan(s)
      setNow(Date.now())
      if (s.running) setTimeout(poll, 2000)
    }
    void poll()
    return () => {
      stop = true
    }
  }, [busy])

  const run = (key: string, f: () => Promise<void>, done?: string) => {
    setNote(null)
    return act(key, async () => {
      await f()
      if (done) setNote(done)
      onChanged()
    })
  }
  const start = (kind: ScanKind, admin = false) => run(`scan-${kind}`, async () => window.netplain.startScan(kind, admin))
  const last = scan?.last
  const result = last && (last.code === 0 ? a.results.ok : last.code === 2 ? a.results.found : last.code === -1 ? a.results.cancelled : a.results.failed(last.code))
  const age = (n: number | undefined) => (n === undefined || n >= NEVER ? a.never : a.ago(n))
  const active = sec.threats.filter((x) => x.active)

  return (
    <>
      <div className="kpis">
        <div className="kpi">
          <span>{a.realtime}</span>
          <strong className={d?.rt ? 'good' : 'bad'}>{d?.rt ? a.on : a.off}</strong>
        </div>
        <div className="kpi">
          <span>{a.definitions}</span>
          <strong>{age(d?.sigAge)}</strong>
        </div>
        <div className="kpi">
          <span>{a.quick}</span>
          <strong>{age(d?.quickAge)}</strong>
        </div>
        <div className="kpi">
          <span>{a.full}</span>
          <strong>{age(d?.fullAge)}</strong>
        </div>
      </div>

      <section className="panel panel-pad stack">
        <div className="scan-row">
          <div>
            <div className="alert-title">{a.quickScan}</div>
            <p className="small muted">{a.quickWhat}</p>
          </div>
          <button className="btn primary sm" disabled={!!scan?.running || busy !== null} onClick={() => void start('quick')}>
            {a.quickScan}
          </button>
        </div>
        <div className="scan-row">
          <div>
            <div className="alert-title">{a.fullScan}</div>
            <p className="small muted">{a.fullWhat}</p>
          </div>
          <button className="btn sm" disabled={!!scan?.running || busy !== null} onClick={() => void start('full')}>
            {a.fullScan}
          </button>
        </div>
        {scan?.running && (
          <p className="note row">
            <Icon name="refresh" className="spin" />
            {a.scanning(scan.running === 'quick' ? a.quickScan : a.fullScan, clock(now - (scan.started ?? now)))}
          </p>
        )}
        {!scan?.running && result && (
          <div className={`note ${last!.code === 2 ? 'danger' : ''} row`}>
            <span className="spacer">{result}</span>
            {last!.code !== 0 && last!.code !== 2 && last!.code !== -1 && (
              <button className="btn sm" onClick={() => void start(last!.kind, true)}>
                {a.asAdmin}
              </button>
            )}
          </div>
        )}
        <div className="row">
          <button className="btn sm" disabled={busy !== null} onClick={() => void run('update', () => window.netplain.updateDefinitions(), a.updated)}>
            {busy === 'update' && <Icon name="refresh" className="spin" />}
            {a.update}
          </button>
          <button className="btn quiet sm" onClick={() => void window.netplain.fixFinding('openDefender')}>
            {a.openWs}
          </button>
        </div>
        {note && <p className="small muted">{note}</p>}
        <ErrNote e={err} />
      </section>

      <section className="section">
        <div className="section-head">
          <h3>{a.history}</h3>
          {active.length > 0 && (
            <button className="btn sm danger" disabled={busy !== null} onClick={() => void run('remove', () => window.netplain.removeThreats())}>
              {a.removeAll}
            </button>
          )}
        </div>
        {sec.threats.length === 0 ? (
          <p className="list-empty">{a.noThreats}</p>
        ) : (
          <div className="list">
            {sec.threats.map((x) => {
              const parts = threatParts(x.name)
              const status = x.status === null ? null : (a.status[x.status] ?? (x.status >= 100 ? a.statusFailed : null))
              return (
                <div className="list-row finding" key={x.id}>
                  <span className={`ad-icon level-${x.active ? 'bad' : 'warn'}`}>
                    <Icon name="alert" size={16} />
                  </span>
                  <div className="app-main">
                    <div className="alert-title">{x.name}</div>
                    <p className="small muted">
                      {[parts && a.categories[parts.category], behavioural(x.name) && a.behaviour].filter(Boolean).join(' ')}
                    </p>
                    {x.resources[0] && <p className="mono small faint threat-res">{x.resources[0].replace(/^\w+:_/, '').slice(0, 220)}</p>}
                  </div>
                  <div className="threat-meta small">
                    <span className={`tag ${x.active ? 'danger' : ''}`}>{x.active ? a.active : (status ?? '—')}</span>
                    <span className="faint">{a.severity[x.severity] ?? ''}</span>
                    {x.at && <span className="faint">{new Date(x.at).toLocaleDateString(lang, { day: 'numeric', month: 'short', year: 'numeric' })}</span>}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>
    </>
  )
}
