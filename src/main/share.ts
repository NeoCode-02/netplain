import { spawn, type ChildProcess } from 'node:child_process'
import crypto from 'node:crypto'
import dns from 'node:dns/promises'
import http from 'node:http'
import https from 'node:https'
import type { Duplex } from 'node:stream'
import type { ShareOptions, ShareRequest, ShareRequestDetail, ShareState } from '../shared/types'

const KEEP = 500
const BODY = 64 * 1024

/** The visitor's address: Cloudflare and localhost.run pass it in a header. */
export function visitor(h: http.IncomingHttpHeaders): string | null {
  const v = h['cf-connecting-ip'] ?? h['x-forwarded-for'] ?? h['x-real-ip']
  return (Array.isArray(v) ? v[0] : v)?.split(',')[0].trim() || null
}

/** The public link in a tunnel program's output. */
export const LINK = { cloudflare: /https:\/\/[a-z0-9-]+\.trycloudflare\.com/, ssh: /https:\/\/[a-z0-9-]+\.lhr\.life/ }

/**
 * Waits (up to a minute) until the name servers of `host`'s zone answer for it, asking them directly so no
 * resolver on the way caches a "no such name" meanwhile. Gives up quietly when they cannot be reached.
 */
export async function published(host: string, timeout = 60_000): Promise<void> {
  const zone = host.split('.').slice(-2).join('.')
  const servers = (await Promise.all((await dns.resolveNs(zone).catch(() => [])).map((n) => dns.resolve4(n).catch(() => [] as string[])))).flat()
  if (!servers.length) return
  const r = new dns.Resolver({ timeout: 2000, tries: 1 })
  r.setServers(servers)
  for (const end = Date.now() + timeout; Date.now() < end; await new Promise((ok) => setTimeout(ok, 1000)))
    if ((await r.resolve4(host).catch(() => [])).length) return
}

const pairs = (raw: string[]) => raw.flatMap((v, i) => (i % 2 ? [] : [[v, raw[i + 1]] as [string, string]]))
const text = (b: Buffer) => (b.includes(0) ? `(${b.length} bytes of binary data)` : b.toString('utf8'))

/** Collects the first 64 KB of a body. */
function sink() {
  const parts: Buffer[] = []
  let size = 0
  return {
    add(c: Buffer) {
      if (size < BODY) parts.push(c.subarray(0, BODY - size))
      size += c.length
    },
    get: () => Buffer.concat(parts)
  }
}

type Entry = ShareRequestDetail & { raw: Buffer }

interface ProxyOptions {
  port: number
  https: boolean
  /** "Basic …" visitors must send, or null for an open link. */
  auth: string | null
  country: (ip: string) => string | null
  changed: () => void
}

/**
 * A local HTTP server the tunnel points at. It forwards every request to localhost:`port`, asks for the
 * password when there is one, and keeps the last 500 requests for the inspector.
 */
export function createProxy(o: ProxyOptions) {
  const log: Entry[] = []
  let seq = 0
  const lib = o.https ? https : http
  const want = o.auth ? crypto.createHash('sha256').update(o.auth).digest() : null
  const allowed = (h: http.IncomingHttpHeaders) => !want || crypto.timingSafeEqual(want, crypto.createHash('sha256').update(h.authorization ?? '').digest())

  // Dev servers often answer only to "localhost" (Vite, webpack), so the Host header is rewritten.
  const forwardHeaders = (h: http.IncomingHttpHeaders): http.OutgoingHttpHeaders => {
    const out: http.OutgoingHttpHeaders = { ...h, host: `localhost:${o.port}`, 'x-forwarded-host': h.host ?? '', 'x-forwarded-proto': 'https' }
    if (want) delete out.authorization
    return out
  }
  const upstream = (method: string, path: string, headers: http.OutgoingHttpHeaders) =>
    // Only ever this computer, so a self-signed certificate is fine.
    lib.request({ host: 'localhost', port: o.port, method, path, headers, rejectUnauthorized: false })

  function add(method: string, path: string, ip: string | null, headers: http.OutgoingHttpHeaders): Entry {
    const e: Entry = {
      id: ++seq,
      at: Date.now(),
      method,
      path,
      status: null,
      ms: null,
      bytes: 0,
      ip,
      country: ip && ip !== 'replay' ? o.country(ip) : null,
      error: null,
      reqHeaders: Object.entries(headers).map(([k, v]) => [k, Array.isArray(v) ? v.join(', ') : String(v)]),
      reqBody: '',
      resHeaders: [],
      resBody: '',
      raw: Buffer.alloc(0)
    }
    log.push(e)
    if (log.length > KEEP) log.shift()
    o.changed()
    return e
  }
  const finish = (e: Entry, status: number | null, error: string | null = null) => {
    e.status = status
    e.error = error
    e.ms = Date.now() - e.at
    o.changed()
  }

  /** Sends a request to the local site; the answer goes to `res` (a visitor) or nowhere (a replay). */
  function pass(e: Entry, headers: http.OutgoingHttpHeaders, body: (up: http.ClientRequest, keep: (c: Buffer) => void) => void, res?: http.ServerResponse) {
    const reqBody = sink()
    const resBody = sink()
    const up = upstream(e.method, e.path, headers)
    up.on('response', (r) => {
      e.resHeaders = pairs(r.rawHeaders)
      if (res) res.writeHead(r.statusCode ?? 502, r.rawHeaders)
      r.on('data', (c: Buffer) => {
        e.bytes += c.length
        resBody.add(c)
        res?.write(c)
      })
      r.on('end', () => {
        res?.end()
        e.resBody = text(resBody.get())
        finish(e, r.statusCode ?? null)
      })
    })
    up.on('error', () => {
      if (res && !res.headersSent) res.writeHead(502, { 'content-type': 'text/plain; charset=utf-8' }).end(`Nothing answers on localhost:${o.port}.`)
      else res?.destroy()
      finish(e, null, 'E_SHARE_LOCAL')
    })
    body(up, (c) => reqBody.add(c))
    up.on('finish', () => {
      e.raw = reqBody.get()
      e.reqBody = text(e.raw)
    })
  }

  const server = http.createServer((req, res) => {
    const headers = forwardHeaders(req.headers)
    const e = add(req.method ?? 'GET', req.url ?? '/', visitor(req.headers), headers)
    if (!allowed(req.headers)) {
      res.writeHead(401, { 'www-authenticate': 'Basic realm="Shared with Netplain", charset="UTF-8"', 'content-type': 'text/plain; charset=utf-8' }).end('This link needs a password.')
      req.resume()
      return finish(e, 401)
    }
    pass(e, headers, (up, keep) => {
      req.on('data', keep)
      req.pipe(up)
    }, res)
  })

  // WebSockets (hot reload, chats): checked like a request, then the two sockets are joined.
  server.on('upgrade', (req: http.IncomingMessage, socket: Duplex, head: Buffer) => {
    const headers = forwardHeaders(req.headers)
    const e = add(req.method ?? 'GET', req.url ?? '/', visitor(req.headers), headers)
    socket.on('error', () => socket.destroy())
    if (!allowed(req.headers)) {
      socket.end('HTTP/1.1 401 Unauthorized\r\nWWW-Authenticate: Basic realm="Shared with Netplain"\r\nContent-Length: 0\r\n\r\n')
      return finish(e, 401)
    }
    const up = upstream(e.method, e.path, headers)
    up.on('upgrade', (r, upSocket, upHead) => {
      socket.write(`HTTP/1.1 101 Switching Protocols\r\n${pairs(r.rawHeaders).map(([k, v]) => `${k}: ${v}\r\n`).join('')}\r\n`)
      if (upHead.length) socket.write(upHead)
      if (head.length) upSocket.write(head)
      upSocket.on('error', () => socket.destroy())
      upSocket.pipe(socket).pipe(upSocket)
      e.resHeaders = pairs(r.rawHeaders)
      finish(e, 101)
    })
    up.on('response', (r) => {
      socket.end(`HTTP/1.1 ${r.statusCode} ${r.statusMessage}\r\nContent-Length: 0\r\n\r\n`)
      finish(e, r.statusCode ?? null)
    })
    up.on('error', () => {
      socket.destroy()
      finish(e, null, 'E_SHARE_LOCAL')
    })
    up.end()
  })

  return {
    listen: () => new Promise<number>((resolve, reject) => server.once('error', reject).listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port))),
    close: () => {
      server.closeAllConnections()
      server.close()
    },
    requests: (after: number): ShareRequest[] =>
      log.filter((e) => e.id > after).map((e) => ({ id: e.id, at: e.at, method: e.method, path: e.path, status: e.status, ms: e.ms, bytes: e.bytes, ip: e.ip, country: e.country, error: e.error })),
    request: (id: number): ShareRequestDetail | null => {
      const e = log.find((x) => x.id === id)
      if (!e) return null
      const { raw: _raw, ...detail } = e
      return { ...detail, reqHeaders: [...e.reqHeaders], resHeaders: [...e.resHeaders] }
    },
    /** Sends a logged request to the local site again; it shows up as a new entry. */
    replay: (id: number) =>
      new Promise<void>((resolve) => {
        const old = log.find((x) => x.id === id)
        if (!old) return resolve()
        const headers = Object.fromEntries(old.reqHeaders)
        const e = add(old.method, old.path, 'replay', headers)
        pass(e, headers, (up, keep) => {
          keep(old.raw)
          up.end(old.raw)
        })
        const done = setInterval(() => e.ms !== null && (clearInterval(done), resolve()), 50)
      })
  }
}

interface Deps {
  /** cloudflared to run, or null when it is not there. */
  cloudflared: () => Promise<{ file: string; where: 'app' | 'system' } | null>
  /** ssh's own list of servers it has met, kept with the app's data. */
  knownHosts: string
  country: (ip: string) => string | null
  push: (s: ShareState) => void
}

/** One shared local site at a time: the proxy plus the tunnel program, restarted when it drops. */
export function createShare(d: Deps) {
  let state: ShareState = { status: 'off', options: null, url: null, login: null, error: null, cloudflared: null }
  let proxy: ReturnType<typeof createProxy> | null = null
  let child: ChildProcess | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let session = 0
  const set = (patch: Partial<ShareState>) => d.push((state = { ...state, ...patch }))

  function connect(o: ShareOptions, port: number, file: string, s: number, attempt: number) {
    if (s !== session) return
    const args =
      o.provider === 'cloudflare'
        ? ['tunnel', '--no-autoupdate', '--url', `http://127.0.0.1:${port}`]
        : ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', `UserKnownHostsFile=${d.knownHosts}`, '-o', 'ServerAliveInterval=30', '-o', 'ExitOnForwardFailure=yes', '-R', `80:127.0.0.1:${port}`, 'nokey@localhost.run']
    const p = spawn(file, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] })
    child = p
    let out = ''
    let linked = false
    const read = (chunk: Buffer) => {
      out = (out + chunk.toString()).slice(-8000)
      const m = LINK[o.provider].exec(out)
      if (!m || linked) return
      linked = true
      // A new Cloudflare link gets its DNS name a few seconds later. Shown earlier, the first visit's resolver
      // would remember "no such name" for minutes; so it is shown once Cloudflare's own name servers know it.
      void (o.provider === 'cloudflare' ? published(new URL(m[0]).hostname) : Promise.resolve()).then(() => {
        if (s === session && child === p) set({ status: 'on', url: m[0], error: null })
      })
    }
    p.stdout?.on('data', read)
    p.stderr?.on('data', read)
    // A link should come within half a minute; otherwise the attempt counts as failed.
    const wait = setTimeout(() => !linked && p.kill(), 30_000)
    p.on('error', (err: NodeJS.ErrnoException) => {
      clearTimeout(wait)
      if (s !== session) return
      stop()
      set({ error: err.code === 'ENOENT' ? (o.provider === 'ssh' ? 'E_NO_SSH' : 'E_NO_CLOUDFLARED') : 'E_SHARE_START' })
    })
    p.on('exit', () => {
      clearTimeout(wait)
      if (s !== session || child !== p) return
      child = null
      // The first attempt failing means it does not work at all; later drops are retried with a growing pause.
      if (!linked && state.status === 'starting') {
        const last = out.trim().split(/\r?\n/).at(-1)?.slice(0, 200)
        stop()
        return set({ error: last ? `E_SHARE_START|${last}` : 'E_SHARE_START' })
      }
      set({ status: 'reconnecting', url: null })
      timer = setTimeout(() => connect(o, port, file, s, linked ? 0 : attempt + 1), Math.min(30_000, 2000 * 2 ** attempt))
    })
  }

  function stop() {
    session++
    clearTimeout(timer)
    child?.kill()
    child = null
    proxy?.close()
    set({ status: 'off', url: null, login: null, error: null })
  }

  return {
    state: async () => {
      set({ cloudflared: (await d.cloudflared())?.where ?? null })
      return state
    },
    async start(o: ShareOptions) {
      stop()
      const file = o.provider === 'cloudflare' ? (await d.cloudflared())?.file : 'ssh'
      if (!file) throw new Error('E_NO_CLOUDFLARED')
      const login = o.password ? { user: 'netplain', password: crypto.randomBytes(9).toString('base64url') } : null
      const s = session
      proxy = createProxy({
        port: o.port,
        https: o.https,
        auth: login ? `Basic ${Buffer.from(`${login.user}:${login.password}`).toString('base64')}` : null,
        country: d.country,
        changed: () => {}
      })
      const port = await proxy.listen()
      set({ status: 'starting', options: o, url: null, login, error: null })
      connect(o, port, file, s, 0)
    },
    stop,
    requests: (after: number) => proxy?.requests(after) ?? [],
    request: (id: number) => proxy?.request(id) ?? null,
    replay: (id: number) => proxy?.replay(id) ?? Promise.resolve()
  }
}
