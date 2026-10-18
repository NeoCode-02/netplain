import { useEffect, useState } from 'react'
import { systemFile } from '../../../shared/paths'
import { errText, type Dict } from '../i18n'
import { Icon } from '../ui'

const WINDOWS = /Windows/.test(navigator.userAgent)
/** The system's own programs are neither blocked nor stopped (the main process refuses them too). */
export const ours = (path: string | null): path is string => !!path && !systemFile(path)
/** Firewall blocks are Windows only for now. */
export const blockable = (path: string | null): path is string => WINDOWS && ours(path)

/** An action in two clicks: the first asks, the second does it (through the admin prompt when needed). */
export function TwoStep({ t, label, title, sure, done, run }: { t: Dict; label: string; title: string; sure: string; done: string; run(): Promise<unknown> }) {
  const [state, setState] = useState<'idle' | 'armed' | 'busy' | 'done'>('idle')
  const [err, setErr] = useState<unknown>(null)
  // An unanswered question goes away by itself.
  useEffect(() => {
    if (state !== 'armed') return
    const timer = setTimeout(() => setState('idle'), 4000)
    return () => clearTimeout(timer)
  }, [state])
  if (state === 'done') return <span className="tag ok">{done}</span>
  const click = async () => {
    if (state === 'idle') return setState('armed')
    setState('busy')
    setErr(null)
    try {
      await run()
      setState('done')
    } catch (e) {
      setErr(e)
      setState('idle')
    }
  }
  return (
    <span className="row block-button">
      <button className={`btn sm ${state === 'idle' ? 'quiet' : 'danger'}`} title={title} disabled={state === 'busy'} onClick={() => void click()}>
        {state === 'busy' && <Icon name="refresh" className="spin" />}
        {state === 'idle' ? label : sure}
      </button>
      {err !== null && <small className="danger-text">{errText(t, err)}</small>}
    </span>
  )
}

/** "Cut off from the internet" for a program file (Windows Firewall, outbound). */
export const BlockApp = ({ t, path }: { t: Dict; path: string }) => (
  <div className="row conn-actions">
    <TwoStep t={t} label={t.connections.blockApp} title={t.connections.blockAppNote} sure={t.connections.sure} done={t.connections.done} run={() => window.netplain.block({ program: path })} />
  </div>
)
