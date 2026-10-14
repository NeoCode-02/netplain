import { useEffect, useMemo, useRef, useState } from 'react'
import type { DetailNode, PacketDetail, PacketRow } from '../../../shared/types'
import { describePacket, layerKey, PRESETS } from '../explain'
import { bytes } from '../format'
import { errText, useT, type Dict } from '../i18n'
import { useLive } from '../live'
import { Icon } from '../ui'
import { Blocked } from './Apps'

const ROW = 30
const KEEP = 5000
type Preset = keyof typeof PRESETS

const time = (t: number) => {
  const d = new Date(t)
  return `${d.toLocaleTimeString([], { hour12: false })}.${String(d.getMilliseconds()).padStart(3, '0')}`
}

function Node({ n }: { n: DetailNode }) {
  if (!n.children.length) return <div className="dt-leaf">{n.text}</div>
  return (
    <details className="dt-node">
      <summary>{n.text}</summary>
      <div className="dt-kids">
        {n.children.map((c, i) => (
          <Node key={i} n={c} />
        ))}
      </div>
    </details>
  )
}

function Detail({ n, onClose, t }: { n: number; onClose(): void; t: Dict }) {
  const [d, setD] = useState<PacketDetail | null>(null)
  const [err, setErr] = useState<unknown>(null)
  // Mounted per packet (key), so the state starts empty for each one.
  useEffect(() => {
    window.netplain.packetDetail(n).then(setD, setErr)
  }, [n])
  return (
    <aside className="pk-detail" aria-label={t.packets.detail(n)}>
      <div className="row pk-detail-head">
        <h3>{t.packets.detail(n)}</h3>
        <span className="spacer" />
        <button className="btn quiet icon sm" aria-label={t.packets.close} onClick={onClose}>
          ×
        </button>
      </div>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {d?.tree.map((layer, i) => {
        const key = layerKey(layer.text)
        return (
          <div className="pk-layer" key={i}>
            {key && t.packets.layers[key] && <p className="small muted">{t.packets.layers[key]}</p>}
            <Node n={layer} />
          </div>
        )
      })}
      {d?.hex && (
        <>
          <h4 className="pk-hex-title">{t.packets.bytes}</h4>
          <pre className="pk-hex">{d.hex}</pre>
        </>
      )}
    </aside>
  )
}

export default function Packets() {
  const t = useT()
  const k = t.packets
  const { traffic } = useLive()
  const [rows, setRows] = useState<PacketRow[]>([])
  const [paused, setPaused] = useState(false)
  const [preset, setPreset] = useState<Preset>('all')
  const [app, setApp] = useState('')
  const [expr, setExpr] = useState('')
  const [matches, setMatches] = useState<Set<number> | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [saved, setSaved] = useState(false)
  const [sel, setSel] = useState<number | null>(null)
  const pos = useRef({ session: 0, after: 0 })
  const box = useRef<HTMLDivElement>(null)
  const [view, setView] = useState({ top: 0, height: 600 })
  const stick = useRef(true)

  const on = traffic?.state === 'on'

  useEffect(() => {
    if (!on || paused) return
    const pull = async () => {
      const b = await window.netplain.packets(pos.current.session, pos.current.after)
      const reset = b.session !== pos.current.session
      if (!b.rows.length && !reset) return
      pos.current = { session: b.session, after: b.rows.at(-1)?.n ?? (reset ? 0 : pos.current.after) }
      setRows((old) => (reset ? b.rows : [...old, ...b.rows]).slice(-KEEP))
      if (reset) {
        setSel(null)
        setMatches(null)
      }
    }
    void pull()
    const timer = setInterval(() => void pull().catch(() => {}), 700)
    return () => clearInterval(timer)
  }, [on, paused])

  useEffect(() => {
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setView((v) => ({ ...v, height: e.contentRect.height })))
    ro.observe(el)
    return () => ro.disconnect()
  }, [on])

  const shown = useMemo(() => rows.filter((p) => PRESETS[preset](p) && (!app || p.app === app) && (!matches || matches.has(p.n))), [rows, preset, app, matches])
  const apps = useMemo(() => [...new Set(rows.flatMap((p) => (p.app ? [p.app] : [])))].sort(), [rows])

  // Follow new packets while the list is scrolled to the bottom.
  useEffect(() => {
    if (stick.current && box.current) box.current.scrollTop = box.current.scrollHeight
  }, [shown.length])

  const applyFilter = async () => {
    setErr(null)
    if (!expr.trim()) return setMatches(null)
    try {
      setMatches(new Set(await window.netplain.packetFilter(expr.trim())))
    } catch (e) {
      setErr(e)
    }
  }
  const save = async () => {
    setErr(null)
    try {
      setSaved(await window.netplain.savePackets())
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setErr(e)
    }
  }

  if (traffic && !on && traffic.state !== 'starting')
    return (
      <div className="page wide">
        <header className="page-head">
          <h2>{k.title}</h2>
        </header>
        <Blocked tr={traffic} t={t} />
      </div>
    )

  const first = Math.max(0, Math.floor(view.top / ROW) - 10)
  const last = Math.min(shown.length, Math.ceil((view.top + view.height) / ROW) + 10)

  return (
    <div className={`packets ${sel !== null ? 'with-detail' : ''}`}>
      <div className="pk-main">
        <header className="pk-head">
          <div>
            <h2>{k.title}</h2>
            <p className="muted">{k.lead}</p>
          </div>
          <div className="row">
            <button className="btn sm" onClick={() => setPaused(!paused)}>
              {paused ? k.resume : k.pause}
            </button>
            <button className="btn sm" onClick={save}>
              <Icon name="down" />
              {saved ? k.saved : k.save}
            </button>
            <button className="btn sm" onClick={() => void window.netplain.openInWireshark().catch(setErr)}>
              {k.open}
            </button>
          </div>
        </header>
        <div className="toolbar pk-tools">
          <div className="seg" role="group">
            {(Object.keys(PRESETS) as Preset[]).map((p) => (
              <button key={p} className={preset === p ? 'on' : ''} aria-pressed={preset === p} onClick={() => setPreset(p)}>
                {k.presets[p]}
              </button>
            ))}
          </div>
          <select className="select sm" value={app} onChange={(e) => setApp(e.target.value)} aria-label={k.app}>
            <option value="">{k.anyApp}</option>
            {apps.map((a) => (
              <option key={a}>{a}</option>
            ))}
          </select>
          <form
            className="row pk-filter"
            onSubmit={(e) => {
              e.preventDefault()
              void applyFilter()
            }}
          >
            <input className="input sm mono" placeholder={k.filter} aria-label={k.filter} value={expr} onChange={(e) => setExpr(e.target.value)} />
            <button className="btn sm" type="submit">
              {k.apply}
            </button>
            {matches && (
              <button
                className="btn quiet sm"
                type="button"
                onClick={() => {
                  setExpr('')
                  setMatches(null)
                }}
              >
                {k.clear}
              </button>
            )}
          </form>
        </div>
        {err !== null && <p className="note danger">{errText(t, err)}</p>}
        {matches && <p className="small muted">{k.matches(matches.size)}</p>}

        <div className="pk-table" role="table">
          <div className="pk-row pk-th" role="row">
            <span>{k.time}</span>
            <span>{k.app}</span>
            <span>{k.where}</span>
            <span>{k.proto}</span>
            <span className="r">{k.size}</span>
            <span>{k.what}</span>
          </div>
          <div
            className="pk-body"
            ref={box}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollTop + el.clientHeight >= el.scrollHeight - ROW * 2
              setView((v) => ({ ...v, top: el.scrollTop }))
            }}
          >
            {shown.length === 0 && <p className="list-empty">{k.empty}</p>}
            <div style={{ height: shown.length * ROW, position: 'relative' }}>
              {shown.slice(first, last).map((p, i) => (
                <div
                  key={p.n}
                  role="row"
                  tabIndex={0}
                  className={`pk-row ${sel === p.n ? 'on' : ''} ${p.dir ?? 'other'}`}
                  style={{ top: (first + i) * ROW }}
                  onClick={() => setSel(p.n)}
                  onKeyDown={(e) => e.key === 'Enter' && setSel(p.n)}
                >
                  <span className="mono faint">{time(p.t)}</span>
                  <span className="ellipsis">{p.app ?? '—'}</span>
                  <span className="ellipsis">
                    <i className={`dir ${p.dir ?? ''}`}>{p.dir === 'in' ? '↓' : p.dir === 'out' ? '↑' : '·'}</i> {p.peer ?? (p.dir === 'in' ? p.src : p.dst)}
                  </span>
                  <span className="ellipsis">{p.proto}</span>
                  <span className="r num">{bytes(p.len)}</span>
                  <span className="ellipsis">{describePacket(p, t)}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
        <p className="small faint">{k.kept}</p>
      </div>
      {sel !== null && <Detail key={sel} n={sel} onClose={() => setSel(null)} t={t} />}
    </div>
  )
}
