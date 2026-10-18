import http from 'node:http'
import https from 'node:https'
import type { PeerCertificate, TLSSocket } from 'node:tls'
import type { CertInfo, SecHeader, SiteReport, TlsInfo } from '../shared/types'

const SEC: SecHeader[] = ['hsts', 'csp', 'frames', 'nosniff', 'referrer', 'permissions']

/** "example.com" → http://example.com/ (to see whether it moves to https); null for anything not a web address. */
export function siteUrl(input: string): URL | null {
  try {
    const u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `http://${input}`)
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname ? u : null
  } catch {
    return null
  }
}

/** Security headers present on the answer; frames count as protected by X-Frame-Options or CSP frame-ancestors. */
export function securityHeaders(h: Record<string, string | string[] | undefined>, secure: boolean): SiteReport['headers'] {
  const get = (k: string) => {
    const v = h[k]
    return v === undefined ? null : Array.isArray(v) ? v.join(', ') : v
  }
  const csp = get('content-security-policy')
  const value: Record<SecHeader, string | null> = {
    // Browsers ignore HSTS sent over plain http.
    hsts: secure ? get('strict-transport-security') : null,
    csp,
    frames: get('x-frame-options') ?? (csp && /frame-ancestors[^;]*/i.exec(csp)?.[0]) ?? null,
    nosniff: get('x-content-type-options'),
    referrer: get('referrer-policy'),
    permissions: get('permissions-policy')
  }
  return SEC.map((key) => ({ key, value: value[key] }))
}

/** Certificate fields can repeat; the first one names it. */
const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v)
const name = (c: PeerCertificate['subject'] | undefined) => one(c?.CN) ?? one(c?.O) ?? ''
const day = (d: string) => new Date(d).toISOString().slice(0, 10)

/** The certificate chain from the site up to its root, as the server sent it. */
export function chainOf(cert: PeerCertificate & { issuerCertificate?: PeerCertificate }): CertInfo[] {
  const out: CertInfo[] = []
  for (let c: typeof cert | undefined = cert; c?.subject && out.length < 6; c = c.issuerCertificate === c ? undefined : c.issuerCertificate) {
    out.push({
      subject: name(c.subject),
      issuer: [one(c.issuer?.O), one(c.issuer?.CN)].filter(Boolean).join(' · '),
      validFrom: day(c.valid_from),
      validTo: day(c.valid_to),
      names: (c.subjectaltname ?? '').split(/,\s*/).flatMap((n) => (n.startsWith('DNS:') ? [n.slice(4)] : n.startsWith('IP Address:') ? [n.slice(11)] : []))
    })
  }
  return out
}

type Hop = { status: number; location: string | null; headers: http.IncomingHttpHeaders; tls: TlsInfo | null }

/** One request; certificate problems are reported, not refused, since finding them is the point. */
function hop(u: URL, timeout = 10_000): Promise<Hop> {
  return new Promise((resolve, reject) => {
    const secure = u.protocol === 'https:'
    const req = (secure ? https : http).request(u, { method: 'GET', timeout, agent: false, rejectUnauthorized: false, headers: { 'user-agent': 'Netplain site check', accept: 'text/html,*/*' } }, (res) => {
      const s = res.socket as TLSSocket
      const tls: TlsInfo | null = secure
        ? { protocol: s.getProtocol?.() ?? null, cipher: s.getCipher?.()?.name ?? null, authorized: s.authorized, error: s.authorizationError ? String(s.authorizationError) : null, chain: chainOf(s.getPeerCertificate(true)) }
        : null
      resolve({ status: res.statusCode ?? 0, location: res.headers.location ?? null, headers: res.headers, tls })
      req.destroy()
    })
    req.on('timeout', () => req.destroy(new Error('E_SITE|timeout')))
    req.on('error', (e: NodeJS.ErrnoException) => reject(new Error(e.message.startsWith('E_SITE') ? e.message : `E_SITE|${e.code ?? e.message}`)))
    req.end()
  })
}

/** Follows redirects (up to 10), then grades the final answer's security headers and its TLS. Throws E_SITE|reason. */
export async function inspectSite(input: string): Promise<SiteReport> {
  let u = siteUrl(input)
  if (!u) throw new Error('E_BAD_ARGS')
  const typedScheme = /^https?:\/\//i.test(input)
  const hops: SiteReport['hops'] = []
  let last: Hop
  for (;;) {
    try {
      last = await hop(u)
    } catch (e) {
      // A bare name whose http side does not answer: try https before giving up.
      if (!hops.length && !typedScheme && u.protocol === 'http:') {
        u = new URL(u.href.replace(/^http:/, 'https:'))
        continue
      }
      throw e
    }
    hops.push({ url: u.href, status: last.status })
    if (last.status < 300 || last.status >= 400 || !last.location || hops.length >= 10) break
    u = new URL(last.location, u)
  }
  const secure = u.protocol === 'https:'
  const first = new URL(hops[0].url)
  return {
    url: u.href,
    hops,
    status: last.status,
    server: one(last.headers.server) ?? null,
    headers: securityHeaders(last.headers, secure),
    tls: last.tls,
    upgrade: first.protocol === 'http:' ? secure : null
  }
}
