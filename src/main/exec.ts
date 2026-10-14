import { execFile } from 'node:child_process'

/** Runs a program (never through a shell) and returns its stdout. */
export function run(file: string, args: string[], timeout = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(file, args, { timeout, windowsHide: true, maxBuffer: 32 * 1024 * 1024, encoding: 'utf8' }, (err, out) => (err ? reject(err) : resolve(out)))
  })
}

/** Same, but '' when the program is missing or fails: for optional details. */
export const tryRun = (file: string, args: string[], timeout?: number) => run(file, args, timeout).catch(() => '')

/** "fe80::1%12" → "fe80::1" */
export const noZone = (ip: string) => ip.replace(/%[^/]*/, '')

/** Wraps a single value (as PowerShell 5 serialises one-item arrays) into a list. */
export const list = <T>(v: T | T[] | null | undefined): T[] => (Array.isArray(v) ? v : v == null ? [] : [v])

/**
 * `load()` at most once per `ms`; calls in between get the last value (`empty` before the first load,
 * which callers wait for). A failed load keeps the last value.
 */
export function cached<T>(ms: number, load: () => Promise<T>, empty: T): () => Promise<T> {
  let value = empty
  let at = 0
  let pending: Promise<T> | null = null
  return () => {
    if (Date.now() - at > ms && !pending) {
      at = Date.now()
      pending = load()
        .then(
          (v) => (value = v),
          () => value
        )
        .finally(() => (pending = null))
    }
    return pending ?? Promise.resolve(value)
  }
}
