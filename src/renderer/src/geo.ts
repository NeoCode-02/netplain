import { useEffect, useState } from 'react'
import type { GeoInfo } from '../../shared/types'
import { useAction } from './hooks'

/** The location database's state, and the download behind the button that offers it. */
export function useGeo(onReady?: () => void) {
  const [info, setInfo] = useState<GeoInfo | null>(null)
  const { busy, err, run } = useAction()

  useEffect(() => {
    void window.netplain.geoInfo().then(setInfo)
  }, [])

  const update = async () => {
    const next = await run('geo', () => window.netplain.geoUpdate())
    if (!next) return
    setInfo(next)
    onReady?.()
  }
  return { info, busy: busy !== null, err, update }
}
