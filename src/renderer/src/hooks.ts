import { useCallback, useState } from 'react'

/**
 * Buttons that ask the main process to do something: which one runs (its key) and the last error.
 * `run` gives the result, or undefined when it failed (ErrNote shows `err`).
 */
export function useAction() {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const run = useCallback(async <T>(key: string, f: () => Promise<T>): Promise<T | undefined> => {
    setBusy(key)
    setErr(null)
    try {
      return await f()
    } catch (e) {
      setErr(e)
      return undefined
    } finally {
      setBusy(null)
    }
  }, [])
  return { busy, err, run }
}

/** One question whose answer is shown (a tool's result): busy, then the answer or the error. */
export function useRun<T>() {
  const { busy, err, run: act } = useAction()
  const [res, setRes] = useState<T | null>(null)
  const run = useCallback(
    async (f: () => Promise<T>) => {
      setRes(null)
      const r = await act('run', f)
      if (r !== undefined) setRes(r)
    },
    [act]
  )
  return { busy: busy !== null, res, err, run }
}
export type Run<T> = ReturnType<typeof useRun<T>>
