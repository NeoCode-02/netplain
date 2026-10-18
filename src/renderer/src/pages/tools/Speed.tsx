import { useEffect, useState } from 'react'
import type { SpeedPhase, SpeedResult } from '../../../../shared/types'
import { bytes } from '../../format'
import { getLang, useT } from '../../i18n'
import { ErrNote, Icon } from '../../ui'

const PHASES: SpeedPhase[] = ['latency', 'down', 'up']
const mb = (v: number | null) => (v === null ? '—' : `${v < 10 ? v.toFixed(1) : Math.round(v)} Mbit/s`)
const ms = (v: number | null) => (v === null ? '—' : `${v} ms`)

/** What a download speed is enough for, from the usual streaming and call requirements. */
export const downUse = (v: number) => (v >= 25 ? 'uhd' : v >= 10 ? 'hd' : v >= 3 ? 'sd' : 'slow')
export const upUse = (v: number) => (v >= 10 ? 'great' : v >= 3 ? 'calls' : 'weak')
/** How much a full line slows everything else down (bufferbloat), from the added latency. */
export const bloat = (idle: number, loaded: number) => (loaded - idle < 30 ? 'good' : loaded - idle < 100 ? 'fair' : 'poor')

/** Cloudflare speed test, phase by phase, with what the numbers mean and the earlier results. */
export default function Speed() {
  const t = useT()
  const k = t.tools.speedTest
  const lang = getLang()
  const [hist, setHist] = useState<SpeedResult[]>([])
  const [cur, setCur] = useState<SpeedResult | null>(null)
  const [phase, setPhase] = useState<SpeedPhase | null>(null)
  const [err, setErr] = useState<unknown>(null)
  useEffect(() => void window.netplain.speedHistory().then(setHist), [])

  const start = async () => {
    setErr(null)
    setCur(null)
    try {
      for (const p of PHASES) {
        setPhase(p)
        setCur(await window.netplain.speedTest(p))
      }
      setHist(await window.netplain.speedHistory())
    } catch (e) {
      setErr(e)
    }
    setPhase(null)
  }

  // While a test runs, only its own numbers show.
  const r = phase ? cur : (cur ?? hist.at(-1) ?? null)
  const loaded = r && Math.max(r.loadedDown ?? 0, r.loadedUp ?? 0)
  const grade = r?.idle != null && loaded ? bloat(r.idle, loaded) : null
  const when = (at: number) => new Date(at).toLocaleString(lang, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

  return (
    <>
      <section className="panel panel-pad tool">
        <div className="section-head">
          <p className="small muted">{k.lead}</p>
          <button className="btn primary" onClick={() => void start()} disabled={phase !== null}>
            {phase && <Icon name="refresh" className="spin" />}
            {phase ? k.phases[phase] : k.run}
          </button>
        </div>
        {(r || phase) && (
          <div className="uptime-now speed-now">
            {(
              [
                [k.down, mb(r?.down ?? null), phase === 'down'],
                [k.up, mb(r?.up ?? null), phase === 'up'],
                [k.idle, ms(r?.idle ?? null), phase === 'latency'],
                [k.loaded, ms(loaded || null), false]
              ] as const
            ).map(([label, value, live]) => (
              <div key={label} className={`uptime-tile ${live ? 'live' : ''}`}>
                <span className="small muted">{label}</span>
                <strong>{live ? '…' : value}</strong>
              </div>
            ))}
          </div>
        )}
        {r && !phase && r.down !== null && r.up !== null && (
          <ul className="verdicts tool-out">
            <li className={r.down >= 10 ? 'ok' : 'bad'}>
              <Icon name={r.down >= 10 ? 'check' : 'alert'} />
              {k.downUse[downUse(r.down)]}
            </li>
            <li className={r.up >= 3 ? 'ok' : 'bad'}>
              <Icon name={r.up >= 3 ? 'check' : 'alert'} />
              {k.upUse[upUse(r.up)]}
            </li>
            {grade && (
              <li className={grade === 'poor' ? 'bad' : 'ok'}>
                <Icon name={grade === 'poor' ? 'alert' : 'check'} />
                {k.bloat[grade]}
              </li>
            )}
          </ul>
        )}
        {r && !phase && r.up !== null && <p className="small faint tool-out">{k.foot(r.server, bytes(r.bytes), r.jitter, when(r.at))}</p>}
        <ErrNote e={err} />
      </section>

      {hist.length > 1 && (
        <section className="section">
          <div className="section-head">
            <h3>{k.history}</h3>
          </div>
          <table className="table">
            <thead>
              <tr>
                <th>{k.when}</th>
                <th className="num">{k.down}</th>
                <th className="num">{k.up}</th>
                <th className="num">{k.idle}</th>
                <th className="num">{k.loaded}</th>
              </tr>
            </thead>
            <tbody>
              {hist
                .slice(-10)
                .reverse()
                .map((h) => (
                  <tr key={h.at}>
                    <td>{when(h.at)}</td>
                    <td className="num">{mb(h.down)}</td>
                    <td className="num">{mb(h.up)}</td>
                    <td className="num">{ms(h.idle)}</td>
                    <td className="num">{ms(Math.max(h.loadedDown ?? 0, h.loadedUp ?? 0) || null)}</td>
                  </tr>
                ))}
            </tbody>
          </table>
        </section>
      )}
    </>
  )
}
