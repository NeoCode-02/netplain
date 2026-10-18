import { useCallback, useEffect, useState } from 'react'
import type { Exposure as ExposureData, Security as Data, SecurityTab } from '../../../shared/types'
import { useAction, useRun } from '../hooks'
import { getLang, useT, type Dict } from '../i18n'
import { WINDOWS } from '../live'
import { reportHtml } from '../report'
import { ErrNote, Icon, Page, Tabs } from '../ui'
import Antivirus from './security/Antivirus'
import Blocked from './security/Blocked'
import Exposure from './security/Exposure'
import Services from './security/Services'
import Startup from './security/Startup'
import Status from './security/Status'
import Users from './security/Users'

// Only the view from the internet works outside Windows.
const TABS: SecurityTab[] = WINDOWS ? ['status', 'exposure', 'antivirus', 'users', 'services', 'startup', 'blocked'] : ['exposure']

/** The Windows security reading; kept by the page because the report needs it whichever tab is open. */
function useSecurity() {
  const [sec, setSec] = useState<Data | null>(null)
  const { busy, err, run } = useAction()
  const load = useCallback((fresh: boolean) => void run('load', () => window.netplain.security(fresh)).then((s) => s && setSec(s)), [run])
  useEffect(() => {
    if (WINDOWS) load(false)
  }, [load])
  return { sec, busy: busy !== null, err, load }
}

/** The tabs built on the reading: when it was taken and a way to take it again, then the tab itself. */
function FromReading({ r, tab, t, onTab }: { r: ReturnType<typeof useSecurity>; tab: SecurityTab; t: Dict; onTab(tab: SecurityTab): void }) {
  const s = t.security
  const { sec } = r
  const changed = () => r.load(true)
  return (
    <>
      <div className="row sec-bar">
        {sec && <span className="small faint">{s.checkedAt(new Date(sec.at).toLocaleTimeString(getLang(), { hour: '2-digit', minute: '2-digit' }))}</span>}
        <button className="btn sm" onClick={changed} disabled={r.busy || !sec}>
          <Icon name="refresh" className={r.busy ? 'spin' : undefined} />
          {s.recheck}
        </button>
      </div>
      <ErrNote e={r.err} />
      {!sec ? (
        r.err === null && <p className="muted">{s.reading}</p>
      ) : tab === 'status' ? (
        <Status sec={sec} t={t} onTab={onTab} onChanged={changed} />
      ) : tab === 'antivirus' ? (
        <Antivirus sec={sec} t={t} onChanged={changed} />
      ) : tab === 'users' ? (
        <Users sec={sec} t={t} onChanged={changed} />
      ) : tab === 'services' ? (
        <Services sec={sec} t={t} onChanged={changed} />
      ) : (
        <Startup sec={sec} t={t} onChanged={changed} onTab={onTab} />
      )}
    </>
  )
}

export default function Security() {
  const t = useT()
  const s = t.security
  const [tab, setTab] = useState<SecurityTab>(TABS[0])
  const reading = useSecurity()
  const view = useRun<ExposureData>()
  const report = useAction()
  const [saved, setSaved] = useState(false)

  const saveReport = () =>
    report.run('report', async () => {
      const { version } = await window.netplain.appInfo()
      if (!(await window.netplain.saveReport(reportHtml(t, getLang(), reading.sec, view.res, version)))) return
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    })

  return (
    <Page
      title={s.title}
      note={s.lead}
      actions={
        (reading.sec || view.res) && (
          <button className="btn sm" onClick={() => void saveReport()} disabled={report.busy !== null}>
            <Icon name={report.busy ? 'refresh' : 'down'} className={report.busy ? 'spin' : undefined} />
            {saved ? t.report.saved : t.report.save}
          </button>
        )
      }
      tabs={TABS.length > 1 && <Tabs value={tab} options={TABS} text={(x) => s.tabs[x]} onChange={setTab} />}
    >
      {!WINDOWS && <p className="note">{s.windowsOnly}</p>}
      <ErrNote e={report.err} />
      {tab === 'exposure' ? <Exposure t={t} q={view} /> : tab === 'blocked' ? <Blocked t={t} /> : <FromReading r={reading} tab={tab} t={t} onTab={setTab} />}
    </Page>
  )
}
