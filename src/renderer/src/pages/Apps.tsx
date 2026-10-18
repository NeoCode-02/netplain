import { useState } from 'react'
import type { AppTraffic, Traffic } from '../../../shared/types'
import { company, countryName } from '../explain'
import { bits, bytes } from '../format'
import { useAction } from '../hooks'
import { getLang, useT, type Dict } from '../i18n'
import { useLive } from '../live'
import { AppIcon, Empty, ErrNote, Icon, Page } from '../ui'
import { BlockApp, blockable } from './TwoStep'

const OS = /Windows/.test(navigator.userAgent) ? 'Win' : /Mac/.test(navigator.userAgent) ? 'Mac' : 'Linux'

function AppRow({ a, max, t }: { a: AppTraffic; max: number; t: Dict }) {
  const [open, setOpen] = useState(false)
  const lang = getLang()
  const unknown = a.key === '?'
  const name = unknown ? t.apps.unknown : (a.title ?? t.procs[a.app] ?? a.app)
  const live = a.rxRate + a.txRate > 0
  return (
    <div className={`ad-row ${open ? 'open' : ''}`}>
      <button className="ad-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        <AppIcon path={a.path} />
        <div className="ad-title app-main">
          <h3 className="ellipsis">{name}</h3>
          <div className="faint small ellipsis">{unknown ? t.apps.unknownNote : a.places.slice(0, 3).map((p) => p.name).join(', ')}</div>
          <div className="share" aria-hidden>
            <span style={{ width: `${Math.max(1, ((a.rx + a.tx) / max) * 100)}%` }} />
          </div>
        </div>
        <div className="app-bytes num">
          <span>
            <i className="key down" /> {bytes(a.rx)}
          </span>
          <span>
            <i className="key up" /> {bytes(a.tx)}
          </span>
          <small className={live ? '' : 'faint'}>{live ? `${bits(a.rxRate)} · ${bits(a.txRate)}` : '—'}</small>
        </div>
        <Icon name="chevron" className="chev" />
      </button>
      {open && blockable(a.path) && <BlockApp t={t} path={a.path} />}
      {open && (
        <table className="table conn-table">
          <thead>
            <tr>
              <th>{t.apps.place}</th>
              <th>{t.apps.company}</th>
              <th className="r">{t.network.download}</th>
              <th className="r">{t.network.upload}</th>
            </tr>
          </thead>
          <tbody>
            {a.places.map((p) => (
              <tr key={p.name}>
                <td>
                  <div className="ellipsis">{p.name}</div>
                  {p.name !== p.ip && <div className="mono faint">{p.ip}</div>}
                </td>
                <td className="ellipsis">{[p.org && company(p.org), p.country && countryName(p.country, lang)].filter(Boolean).join(' · ') || <span className="faint">—</span>}</td>
                <td className="r num">{bytes(p.rx)}</td>
                <td className="r num">{bytes(p.tx)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

/** What to show instead of the list while traffic can't be watched. */
export function Blocked({ tr, t }: { tr: Traffic; t: Dict }) {
  const a = t.apps
  const { busy, err, run } = useAction()
  const [allowed, setAllowed] = useState(false)
  const retry = () => void window.netplain.retryCapture()
  const allow = async () => setAllowed((await run('allow', () => window.netplain.allowCapture().then(() => true))) ?? false)
  if (tr.state === 'missing')
    return (
      <Empty icon="down" title={a.missingTitle} body={a.missingBody}>
        <p className="small muted">{a[`missing${OS}`]}</p>
        <div className="row">
          <button className="btn primary" onClick={() => void window.netplain.openUrl('https://www.wireshark.org/download.html')}>
            {a.install}
          </button>
          <button className="btn" onClick={retry}>
            {a.check}
          </button>
        </div>
      </Empty>
    )
  if (tr.state === 'denied')
    return (
      <Empty icon="alert" title={a.deniedTitle} body={a[`denied${OS}`]}>
        {allowed && <p className="small muted">{a.allowed}</p>}
        <ErrNote e={err} />
        <div className="row">
          {OS === 'Linux' && (
            <button className="btn primary" onClick={allow} disabled={busy !== null}>
              {a.allow}
            </button>
          )}
          <button className="btn" onClick={retry}>
            {a.retry}
          </button>
        </div>
      </Empty>
    )
  return (
    <Empty icon="chart" title={a.offTitle} body={a.offBody}>
      <button className="btn primary" onClick={() => void window.netplain.getSettings().then((s) => window.netplain.saveSettings({ ...s, capture: true }))}>
        {a.turnOn}
      </button>
    </Empty>
  )
}

export default function Apps() {
  const t = useT()
  const a = t.apps
  const { traffic: tr } = useLive()
  const watching = tr && (tr.state === 'on' || tr.state === 'starting' || tr.state === 'error')
  const max = Math.max(1, ...(tr?.apps ?? []).map((x) => x.rx + x.tx))
  const top = tr?.apps.find((x) => x.key !== '?')
  const since = tr?.since ? new Date(tr.since).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }) : null

  return (
    <Page
      title={a.title}
      note={`${since ? a.lead(since) : tr?.state === 'starting' ? a.starting : watching ? a.waiting : ''}${top ? ` ${a.top(top.title ?? top.app, bytes(top.rx + top.tx))}` : ''}`}
      actions={
        tr &&
        tr.rx + tr.tx > 0 && (
          <div className="app-total num">
            <span className="faint small">{a.total}</span>
            <span>
              <i className="key down" /> {bytes(tr.rx)}
            </span>
            <span>
              <i className="key up" /> {bytes(tr.tx)}
            </span>
          </div>
        )
      }
    >
      {tr?.state === 'error' && <p className="note danger">{a.error}</p>}
      {tr && !watching && <Blocked tr={tr} t={t} />}
      {watching && tr.apps.length > 0 && (
        <div className="list">
          {tr.apps.map((x) => (
            <AppRow key={x.key} a={x} max={max} t={t} />
          ))}
        </div>
      )}
    </Page>
  )
}
