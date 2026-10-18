import { useEffect, useState } from 'react'
import type { Blocked as Rule } from '../../../shared/types'
import { errText, type Dict } from '../i18n'
import { AppIcon, Empty, Icon } from '../ui'

const file = (p: string) => p.split('\\').pop() ?? p

/** Netplain's own Windows Firewall rules, each with a way back. */
export default function Blocked({ t }: { t: Dict }) {
  const b = t.security.blocked
  const [list, setList] = useState<Rule[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => void window.netplain.blocked().then(setList, setErr), [])

  const unblock = async (name: string) => {
    setBusy(name)
    setErr(null)
    try {
      setList(await window.netplain.unblock(name))
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(null)
    }
  }

  return (
    <>
      <p className="small muted section-lead">{b.lead}</p>
      {err !== null && <p className="note danger">{errText(t, err)}</p>}
      {list?.length === 0 && <Empty icon="shield" title={b.empty} body={b.emptyBody} />}
      {!!list?.length && (
        <div className="list">
          {list.map((x) => (
            <div className="list-row" key={x.name}>
              {x.program ? (
                <AppIcon path={x.program} />
              ) : (
                <span className="app-icon">
                  <Icon name="globe" size={16} />
                </span>
              )}
              <div className="app-main">
                <div className="alert-title ellipsis">{x.program ? file(x.program) : x.ip}</div>
                <p className="small muted ellipsis">{x.program ? `${b.program} · ${x.program}` : b.ip}</p>
              </div>
              <button className="btn sm" disabled={busy !== null} onClick={() => void unblock(x.name)}>
                {busy === x.name && <Icon name="refresh" className="spin" />}
                {b.unblock}
              </button>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
