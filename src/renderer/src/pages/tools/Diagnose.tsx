import { useState } from 'react'
import type { DiagnoseStep, Hop, LookupResult, PingResult, PortState, PublicIp } from '../../../../shared/types'
import { addressKind, where } from '../../explain'
import { getLang, useT } from '../../i18n'
import { useLive } from '../../live'
import { ErrNote, Icon } from '../../ui'
import { Ask, Tool } from './kit'
import { useRun } from '../../hooks'

/** "Is the internet working?", the classic terminal commands as buttons, and quick fixes. */
export default function Diagnose() {
  const t = useT()
  const k = t.tools
  const lang = getLang()
  const { snap } = useLive()
  const internet = snap?.adapters.find((a) => a.id === snap.defaultId) ?? null
  const diag = useRun<DiagnoseStep[]>()
  const ping = useRun<PingResult>()
  const trace = useRun<Hop[]>()
  const look = useRun<LookupResult>()
  const port = useRun<PortState>()
  const pub = useRun<PublicIp>()
  const fix = useRun<string>()
  const [portNo, setPortNo] = useState('443')

  const okTimes = (ping.res?.times ?? []).filter((x): x is number => x !== null)
  const avg = okTimes.length ? okTimes.reduce((a, b) => a + b, 0) / okTimes.length : null
  const speed = avg === null ? null : avg < 30 ? 'fast' : avg < 100 ? 'good' : avg < 250 ? 'slow' : 'poor'

  return (
    <>
      <section className="panel panel-pad">
        <div className="section-head">
          <div>
            <h3>{k.diagnose}</h3>
            <p>{k.diagnoseLead}</p>
          </div>
          <button className="btn primary" onClick={() => void diag.run(() => window.netplain.diagnose())} disabled={diag.busy}>
            {diag.busy && <Icon name="refresh" className="spin" />}
            {diag.busy ? k.checking : k.check}
          </button>
        </div>
        {diag.res && (
          <ol className="steps-list">
            {diag.res.map((s) => {
              const [name, ok, fail] = k.steps[s.key]
              return (
                <li key={s.key} className={`step-${s.state}`}>
                  <span className="step-mark">{s.state === 'ok' ? '✓' : s.state === 'fail' ? '✕' : '–'}</span>
                  <div>
                    <strong>{name}</strong>
                    <p className="small muted">{s.state === 'ok' ? ok(s.detail) : s.state === 'fail' ? fail : k.skipped}</p>
                  </div>
                </li>
              )
            })}
          </ol>
        )}
        <ErrNote e={diag.err} />
      </section>

      <div className="tools-grid section">
        <Tool title={k.ping} lead={k.pingLead}>
          <Ask placeholder={k.host} label={k.ping} busy={ping.busy} onRun={(h) => void ping.run(() => window.netplain.ping(h))} />
          {ping.res && (
            <div className="tool-out">
              {avg !== null ? (
                <p>
                  <strong>{k.speed[speed!]}</strong> — {k.pingResult(okTimes.length, ping.res.times.length, `${Math.round(avg)} ms`)}
                </p>
              ) : (
                <p>{k.pingNone}</p>
              )}
              <p className="mono small faint">
                {ping.res.ip ?? ping.res.host} · {ping.res.times.map((x) => (x === null ? '✕' : `${x} ms`)).join(' · ')}
              </p>
            </div>
          )}
          <ErrNote e={ping.err} />
        </Tool>

        <Tool title={k.lookup} lead={k.lookupLead}>
          <Ask placeholder={k.host} label={k.lookupRun} busy={look.busy} onRun={(h) => void look.run(() => window.netplain.lookup(h))} />
          {look.res && (
            <div className="tool-out">
              {look.res.addresses.map((a) => (
                <p key={a.ip}>
                  <span className="mono">{a.ip}</span> <span className="small muted">{where(a, lang)}</span>
                </p>
              ))}
              {look.res.addresses.length === 1 && look.res.addresses[0].ip === look.res.name && (
                <p className="small muted">{look.res.names.length ? look.res.names.join(', ') : k.noNames}</p>
              )}
              <p className="small faint">{k.took(look.res.ms)}</p>
            </div>
          )}
          <ErrNote e={look.err} />
        </Tool>

        <Tool title={k.port} lead={k.portLead}>
          <Ask
            placeholder={k.host}
            label={k.portRun}
            busy={port.busy}
            onRun={(h) => void port.run(() => window.netplain.checkPort(h, Number(portNo)))}
            extra={<input className="input sm mono port-input" inputMode="numeric" value={portNo} aria-label="Port" onChange={(e) => setPortNo(e.target.value.replace(/\D/g, '').slice(0, 5))} />}
          />
          {port.res && <p className={`tool-out port-${port.res}`}>{k.ports[port.res]}</p>}
          <ErrNote e={port.err} />
        </Tool>

        <Tool title={k.publicIp} lead={k.publicIpLead}>
          <div className="row">
            <button className="btn sm" onClick={() => void pub.run(() => window.netplain.publicIp())} disabled={pub.busy}>
              {pub.busy && <Icon name="refresh" className="spin" />}
              {k.publicIpRun}
            </button>
          </div>
          {pub.res && (
            <div className="tool-out">
              <p className="mono big">{pub.res.ip}</p>
              <p className="small muted">{where(pub.res, lang)}</p>
            </div>
          )}
          <ErrNote e={pub.err} />
        </Tool>
      </div>

      <section className="panel panel-pad section">
        <h3>{k.trace}</h3>
        <p className="small muted">{k.traceLead}</p>
        <Ask placeholder={k.host} label={k.traceRun} busy={trace.busy} onRun={(h) => void trace.run(() => window.netplain.trace(h))} />
        {trace.busy && <p className="small muted">{k.tracing}</p>}
        {trace.res && (
          <ol className="hops">
            {trace.res.map((h) => (
              <li key={h.n}>
                <span className="hop-n num">{h.n}</span>
                <span className="mono">{h.ip ?? '*'}</span>
                <span className="small muted ellipsis">
                  {!h.ip ? k.hopLost : h.ip === internet?.gateway ? k.hopRouter : addressKind(h.ip) === 'public' ? where(h, lang) : k.hopLocal}
                </span>
                <span className="num small">{h.ms !== null ? `${h.ms} ms` : ''}</span>
              </li>
            ))}
          </ol>
        )}
        <ErrNote e={trace.err} />
      </section>

      <section className="section">
        <div className="section-head">
          <div>
            <h3>{k.fixes}</h3>
            <p>{k.fixesLead}</p>
          </div>
        </div>
        <div className="list">
          {(
            [
              ['flush', () => window.netplain.flushDns(), false],
              ['renew', () => window.netplain.renewIp(internet!.id), true],
              ['restart', () => window.netplain.restartAdapter(internet!.id), true]
            ] as const
          ).map(([key, action, needsAdapter]) => (
            <div className="list-row" key={key}>
              <div className="app-main">
                <div className="alert-title">{k[key][0]}</div>
                <p className="small muted">{needsAdapter && !internet ? k.noAdapter : k[key][1]}</p>
              </div>
              <button className="btn sm" disabled={fix.busy || (needsAdapter && !internet)} onClick={() => void fix.run(async () => (await action(), key))}>
                {k.run}
              </button>
            </div>
          ))}
        </div>
        {fix.res && <p className="note">{`${k[fix.res as 'flush'][0]}: ${k.done}`}</p>}
        <ErrNote e={fix.err} />
      </section>
    </>
  )
}
