import dns from 'node:dns/promises'
import https from 'node:https'
import path from 'node:path'
import type { SpeedPhase, SpeedResult } from '../shared/types'
import { knock } from './uptime'
import { readJson, writeJson } from './store'

const HOST = 'speed.cloudflare.com'
const STREAMS = 4
const SECONDS = 8
const KEEP = 100
/** A ping that gets no answer under load counts as this long: a stuck queue is the thing being measured. */
const LOST = 2000

export const median = (xs: number[]) => {
  if (!xs.length) return null
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2)
}
/** Average change between neighbouring samples. */
export const jitter = (xs: number[]) => (xs.length < 2 ? null : Math.round(xs.slice(1).reduce((a, x, i) => a + Math.abs(x - xs[i]), 0) / (xs.length - 1)))
export const mbps = (bytes: number, ms: number) => (ms > 0 ? Math.round(((bytes * 8) / ms / 1000) * 10) / 10 : 0)

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
/** "a4c3f04a0925f56d-WAW" → "WAW": the Cloudflare site (airport code) that answered. */
export const colo = (ray: unknown) => (typeof ray === 'string' ? (/-([A-Z]{3})$/.exec(ray)?.[1] ?? null) : null)

/** One request to the test server; resolves true when it completed, false when it failed or was aborted. */
function request(pathname: string, signal: AbortSignal, onData: (n: number) => void, body?: Buffer, onHeaders?: (h: Record<string, unknown>) => void): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) return resolve(false)
    const headers = { 'user-agent': 'Netplain speed test', ...(body ? { 'content-type': 'application/octet-stream', 'content-length': body.length } : {}) }
    const req = https.request({ host: HOST, path: pathname, method: body ? 'POST' : 'GET', agent: false, signal, headers }, (res) => {
      onHeaders?.(res.headers)
      res.on('data', (c: Buffer) => onData(c.length))
      res.on('end', () => resolve(!signal.aborted && (res.statusCode ?? 0) < 400))
      res.on('error', () => resolve(false))
    })
    req.on('error', () => resolve(false))
    req.end(body)
  })
}

/** Connect times to the test server until `signal` aborts (or `max` samples); null for no answer. */
async function sample(ip: string, signal: AbortSignal, every: number, max = Infinity): Promise<(number | null)[]> {
  const out: (number | null)[] = []
  while (!signal.aborted && out.length < max) {
    out.push(await knock(ip, 443, LOST))
    await sleep(every)
  }
  return out
}

/**
 * The speed test, one phase per call so the page can show progress: latency at rest, then download and
 * upload, each with latency measured under that load. Finished tests are kept in `dir`/speed.json.
 */
export function createSpeed(dir: string) {
  const file = path.join(dir, 'speed.json')
  let run: SpeedResult | null = null
  let busy = false

  const history = (): SpeedResult[] => {
    const list = readJson<unknown>(file, [])
    return Array.isArray(list) ? list : []
  }

  const loaded = async (ip: string, direction: 'down' | 'up', r: SpeedResult) => {
    const stop = new AbortController()
    const t0 = performance.now()
    const deadline = setTimeout(() => stop.abort(), SECONDS * 1000)
    let bytes = 0
    let warm = 0
    // The first second (TCP slow start) is left out of the download rate.
    const warmup = setTimeout(() => (warm = bytes), 1000)
    let last = t0
    const zero = direction === 'up' ? Buffer.alloc(16 * 1024 * 1024) : null
    const pings = sample(ip, stop.signal, 300)
    const stream = async () => {
      let size = 256 * 1024
      while (!stop.signal.aborted) {
        const t = performance.now()
        const ok =
          direction === 'down'
            ? await request('/__down?bytes=25000000', stop.signal, (n) => (bytes += n), undefined, (h) => (r.server ??= colo(h['cf-ray'])))
            : await request('/__up', stop.signal, () => {}, zero!.subarray(0, size))
        if (ok && direction === 'up') {
          // An upload counts once the server has all of it; pieces grow until one takes about half a second.
          bytes += size
          last = performance.now()
          if (last - t < 500) size = Math.min(size * 2, zero!.length)
        }
        // A failing network must not turn this into a tight loop.
        if (!ok && !stop.signal.aborted) await sleep(500)
      }
    }
    await Promise.all(Array.from({ length: STREAMS }, stream))
    clearTimeout(deadline)
    clearTimeout(warmup)
    r.bytes += bytes
    const latency = median((await pings).map((x) => x ?? LOST))
    return { rate: direction === 'down' ? mbps(bytes - warm, performance.now() - t0 - 1000) : mbps(bytes, last - t0), latency }
  }

  return {
    history,
    async phase(p: SpeedPhase): Promise<SpeedResult> {
      if (busy) throw new Error('E_BUSY')
      busy = true
      try {
        const ip = (await dns.lookup(HOST).catch(() => null))?.address
        if (!ip) throw new Error('E_SPEED')
        if (p === 'latency') {
          const pings = (await sample(ip, new AbortController().signal, 100, 10)).filter((x): x is number => x !== null)
          if (!pings.length) throw new Error('E_SPEED')
          run = { at: Date.now(), down: null, up: null, idle: median(pings), jitter: jitter(pings), loadedDown: null, loadedUp: null, server: null, bytes: 0 }
          return run
        }
        if (!run) throw new Error('E_BAD_ARGS')
        const r = await loaded(ip, p, run)
        if (p === 'down') [run.down, run.loadedDown] = [r.rate, r.latency]
        else {
          ;[run.up, run.loadedUp] = [r.rate, r.latency]
          writeJson(file, [...history(), run].slice(-KEEP))
        }
        return { ...run }
      } finally {
        busy = false
      }
    }
  }
}
