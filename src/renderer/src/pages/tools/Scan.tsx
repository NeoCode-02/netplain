import { useEffect, useRef, useState } from 'react'
import type { ScanHit } from '../../../../shared/types'
import { COMMON_PORTS, parsePorts, RISKY, service } from '../../explain'
import { getLang, useT } from '../../i18n'
import { useLive } from '../../live'
import { ErrNote } from './kit'

type Sets = 'common' | 'low' | 'all' | 'custom'
const SETS: Sets[] = ['common', 'low', 'all', 'custom']
const range = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => from + i)
/** Ports per request: the page shows progress and can stop between batches. */
const BATCH = 500

type Run = { host: string; total: number; done: number; hits: ScanHit[]; busy: boolean }

/** Port scanner; starts on the router (or the device it was opened for). */
export default function Scan({ initial }: { initial?: string }) {
  const t = useT()
  const k = t.tools.scan
  const { snap } = useLive()
  const router = snap?.adapters.find((a) => a.id === snap.defaultId)?.gateway ?? ''
  const [typed, setTyped] = useState(initial ?? null)
  const host = (typed ?? router).trim()
  const [set, setSet] = useState<Sets>('common')
  const [custom, setCustom] = useState('')
  const [run, setRun] = useState<Run | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const stop = useRef(false)
  useEffect(() => () => void (stop.current = true), [])

  const ports = set === 'common' ? COMMON_PORTS : set === 'low' ? range(1, 1024) : set === 'all' ? range(1, 65535) : parsePorts(custom)

  const start = async () => {
    if (!ports || !host) return
    stop.current = false
    setErr(null)
    let r: Run = { host, total: ports.length, done: 0, hits: [], busy: true }
    setRun(r)
    try {
      for (let i = 0; i < ports.length && !stop.current; i += BATCH) {
        const hits = await window.netplain.scanPorts(host, ports.slice(i, i + BATCH))
        r = { ...r, done: Math.min(i + BATCH, ports.length), hits: [...r.hits, ...hits] }
        setRun(r)
      }
    } catch (e) {
      setErr(e)
    }
    setRun({ ...r, busy: false })
  }

  // Opened for a device (its Ports button): start right away, once.
  const auto = useRef(!!initial)
  useEffect(() => {
    if (!auto.current) return
    auto.current = false
    void start()
  })

  const num = (n: number) => n.toLocaleString(getLang())

  return (
    <>
      <section className="panel panel-pad tool">
        <p className="small muted">{k.lead}</p>
        <form
          className="row tool-form"
          onSubmit={(e) => {
            e.preventDefault()
            void start()
          }}
        >
          <input className="input sm mono" value={typed ?? router} placeholder={t.tools.host} aria-label={t.tools.host} onChange={(e) => setTyped(e.target.value)} />
          {run?.busy ? (
            <button type="button" className="btn sm" onClick={() => (stop.current = true)}>
              {k.stop}
            </button>
          ) : (
            <button type="submit" className="btn sm primary" disabled={!host || !ports}>
              {k.run}
            </button>
          )}
        </form>
        <div className="row tool-form">
          <div className="seg" role="group" aria-label={k.which}>
            {SETS.map((x) => (
              <button key={x} type="button" className={set === x ? 'on' : ''} aria-pressed={set === x} onClick={() => setSet(x)}>
                {k.sets[x](num(COMMON_PORTS.length))}
              </button>
            ))}
          </div>
          {set === 'custom' && <input className="input sm mono" value={custom} placeholder="22, 80, 8000-8100" aria-label={k.sets.custom()} onChange={(e) => setCustom(e.target.value)} />}
        </div>
        {set === 'custom' && custom.trim() && !ports && <p className="note">{k.badPorts}</p>}
        <p className="small faint tool-out">{set === 'all' ? `${k.allNote} ${k.only}` : k.only}</p>
      </section>

      {run && (
        <section className="section">
          <div className="section-head">
            <h3>{run.busy ? k.scanning(run.host) : k.found(run.hits.length, run.host)}</h3>
            <span className="small faint">{k.progress(num(run.done), num(run.total))}</span>
          </div>
          {run.busy && (
            <div className="meter scan-meter" role="progressbar" aria-valuenow={run.done} aria-valuemax={run.total}>
              <span style={{ width: `${(run.done / run.total) * 100}%` }} />
            </div>
          )}
          {run.hits.length > 0 && (
            <div className="list">
              {run.hits.map((h) => {
                const key = service('tcp', h.port)
                const [name, what] = key ? t.services[key] : [k.unknown, '']
                return (
                  <div className="list-row" key={h.port}>
                    <span className="mono scan-port">{h.port}</span>
                    <div className="app-main">
                      <div className="alert-title">{name}</div>
                      {what && <p className="small muted">{what}</p>}
                      {h.banner && <p className="small mono faint ellipsis">{h.banner}</p>}
                    </div>
                    {key && RISKY.has(key) && (
                      <span className="tag warn" title={k.riskyNote}>
                        {k.risky}
                      </span>
                    )}
                  </div>
                )
              })}
            </div>
          )}
          {!run.busy && run.hits.length === 0 && err === null && <p className="muted">{k.none}</p>}
        </section>
      )}
      <ErrNote t={t} e={err} />
    </>
  )
}
