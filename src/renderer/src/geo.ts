import { useEffect, useState } from 'react'
import type { GeoInfo } from '../../shared/types'

/** The location database's state, and the download behind the button that offers it. */
export function useGeo(onReady?: () => void) {
  const [info, setInfo] = useState<GeoInfo | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<unknown>(null)

  useEffect(() => {
    void window.netplain.geoInfo().then(setInfo)
  }, [])

  const update = async () => {
    setBusy(true)
    setErr(null)
    try {
      setInfo(await window.netplain.geoUpdate())
      onReady?.()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }
  return { info, busy, err, update }
}
