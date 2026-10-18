import { useEffect } from 'react'
import type { WifiNet } from '../../../../shared/types'
import { quality } from '../../explain'
import { useT } from '../../i18n'
import { useLive } from '../../live'
import { Icon } from '../../ui'
import { advice, perChannel, weak } from '../../wifi'
import { ErrNote, useRun } from './kit'

/** Wi-Fi networks around: how crowded each channel is, which is quieter for your router, and which networks are unsafe. */
export default function Wifi() {
  const t = useT()
  const k = t.tools.wifi
  const { snap } = useLive()
  const q = useRun<WifiNet[]>()
  const { run } = q
  useEffect(() => void run(() => window.netplain.wifiScan()), [run])

  const wifi = (snap?.adapters.find((a) => a.id === snap.defaultId && a.wifi) ?? snap?.adapters.find((a) => a.wifi))?.wifi ?? null
  const nets = q.res ?? []
  const isMine = (n: WifiNet) => !!wifi && (n.bssid !== null && wifi.bssid ? n.bssid === wifi.bssid : n.ssid === wifi.ssid && n.channel === wifi.channel)
  const mine = nets.find(isMine) ?? null
  const band = mine?.band === '2.4' || mine?.band === '5' ? mine.band : null
  const tip = band && mine ? advice(nets, band, mine.channel, isMine) : null
  const others = nets.filter((n) => !isMine(n) && weak(n)).length

  return (
    <>
      <section className="panel panel-pad tool">
        <div className="section-head">
          <p className="small muted">{k.lead}</p>
          <button className="btn" onClick={() => void run(() => window.netplain.wifiScan())} disabled={q.busy}>
            <Icon name="refresh" className={q.busy ? 'spin' : undefined} />
            {q.busy ? k.scanning : k.scan}
          </button>
        </div>
        {q.res && (
          <ul className="verdicts">
            <li>
              <Icon name="wifi" />
              {k.count(nets.length)}
            </li>
            {mine && tip && (
              <li className={tip.move ? 'bad' : 'ok'}>
                <Icon name={tip.move ? 'alert' : 'check'} />
                {tip.move ? k.move(mine.channel!, tip.best) : k.stay(mine.channel!)}
              </li>
            )}
            {mine && (
              <li className={weak(mine) ? 'bad' : 'ok'}>
                <Icon name={weak(mine) ? 'alert' : 'check'} />
                {weak(mine) ? k.mineWeak : k.mineSafe[mine.security === 'wpa3' ? 'wpa3' : 'wpa2']}
              </li>
            )}
            {others > 0 && (
              <li className="bad">
                <Icon name="alert" />
                {k.othersWeak(others)}
              </li>
            )}
          </ul>
        )}
        <ErrNote t={t} e={q.err} />
      </section>

      {q.res &&
        (['2.4', '5'] as const).map((b) => {
          const cols = perChannel(nets, b, [band === b ? (mine?.channel ?? null) : null])
          if (!cols.some((c) => c.count)) return null
          const max = Math.max(...cols.map((c) => c.count))
          return (
            <section className="section" key={b}>
              <div className="section-head">
                <h3>{k.band(b)}</h3>
                <span className="small faint">{k.chartNote}</span>
              </div>
              <div className="panel panel-pad chan-chart" role="img" aria-label={k.band(b)}>
                {cols.map((c) => {
                  const here = band === b && mine?.channel === c.ch
                  const best = band === b && tip?.move && tip.best === c.ch
                  return (
                    <div key={c.ch} className={`chan ${here ? 'mine' : ''} ${best ? 'best' : ''}`} title={k.onChannel(c.count, c.ch)}>
                      <span className="chan-count">{c.count || ''}</span>
                      <span className="chan-track">
                        <span className="chan-bar" style={{ height: `${(c.count / max) * 100}%` }} />
                      </span>
                      <span className="chan-n">{c.ch}</span>
                    </div>
                  )
                })}
              </div>
            </section>
          )
        })}

      {nets.length > 0 && (
        <section className="section">
          <div className="section-head">
            <h3>{k.networks}</h3>
          </div>
          <div className="list">
            {nets.map((n, i) => (
              <div className="list-row" key={`${n.bssid ?? n.ssid}-${i}`}>
                <div className="app-main">
                  <div className="alert-title ellipsis">
                    {n.ssid || <span className="muted">{k.hidden}</span>} {isMine(n) && <span className="tag ok">{k.yours}</span>}
                  </div>
                  <p className="small muted ellipsis">{[n.vendor, n.band && n.channel !== null ? k.where(n.band, n.channel) : null].filter(Boolean).join(' · ')}</p>
                </div>
                <span className={`tag ${weak(n) ? 'warn' : ''}`}>{k.security[n.security] + (n.tkip ? ' · TKIP' : '')}</span>
                <div className={`meter wifi-meter q-${quality(n.signal)}`} title={`${n.signal}%${n.dbm !== null ? ` · ${n.dbm} dBm` : ''}`}>
                  <span style={{ width: `${n.signal}%` }} />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </>
  )
}
