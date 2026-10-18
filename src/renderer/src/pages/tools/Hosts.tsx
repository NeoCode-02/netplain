import { useEffect, useState } from 'react'
import type { HostsEntry, HostsOp } from '../../../../shared/types'
import { useT } from '../../i18n'
import { Icon } from '../../ui'
import { ErrNote } from './kit'

/** The hosts file: names this computer answers itself, before any DNS server. */
export default function Hosts() {
  const t = useT()
  const k = t.tools.hosts
  const [list, setList] = useState<HostsEntry[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [ip, setIp] = useState('127.0.0.1')
  const [name, setName] = useState('')

  useEffect(() => void window.netplain.hosts().then(setList, setErr), [])

  const edit = async (key: string, op: HostsOp) => {
    setBusy(key)
    setErr(null)
    try {
      setList(await window.netplain.editHosts(op))
      if (op.kind === 'add') setName('')
    } catch (e) {
      setErr(e)
      // The file may have changed meanwhile: show what is there now.
      window.netplain.hosts().then(setList, () => {})
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <section className="panel panel-pad tool">
        <p className="small muted">{k.lead}</p>
        <form
          className="row tool-form"
          onSubmit={(e) => {
            e.preventDefault()
            if (ip.trim() && name.trim()) void edit('add', { kind: 'add', ip: ip.trim(), name: name.trim() })
          }}
        >
          <input className="input sm mono hosts-ip" value={ip} placeholder="127.0.0.1" aria-label={k.ip} onChange={(e) => setIp(e.target.value)} />
          <input className="input sm mono" value={name} placeholder="myapp.test" aria-label={k.name} onChange={(e) => setName(e.target.value)} />
          <button className="btn sm primary" type="submit" disabled={busy !== null || !ip.trim() || !name.trim()}>
            {busy === 'add' && <Icon name="refresh" className="spin" />}
            {k.add}
          </button>
        </form>
        <ErrNote t={t} e={err} />
      </section>

      {list && (
        <section className="section">
          <div className="section-head">
            <h3>{k.entries(list.length)}</h3>
          </div>
          {list.length === 0 ? (
            <p className="note">{k.empty}</p>
          ) : (
            <div className="list">
              {list.map((e) => {
                const key = `${e.line}`
                return (
                  <div className={`list-row ${e.on ? '' : 'muted'}`} key={key}>
                    <span className="mono hosts-ip">{e.ip}</span>
                    <div className="app-main">
                      <div className="mono ellipsis">{e.names.join(' ')}</div>
                      {(e.comment || !e.on) && <p className="small faint ellipsis">{[!e.on && k.off, e.comment].filter(Boolean).join(' · ')}</p>}
                    </div>
                    <div className="row-actions">
                      <button className="btn sm quiet" disabled={busy !== null} onClick={() => void edit(key, { kind: 'toggle', line: e.line, ip: e.ip })}>
                        {busy === key && <Icon name="refresh" className="spin" />}
                        {e.on ? k.turnOff : k.turnOn}
                      </button>
                      <button className="btn sm quiet" disabled={busy !== null} onClick={() => void edit(key, { kind: 'remove', line: e.line, ip: e.ip })}>
                        {k.remove}
                      </button>
                    </div>
                  </div>
                )
              })}
            </div>
          )}
          <p className="small faint foot-note">{k.backup}</p>
        </section>
      )}
    </>
  )
}
