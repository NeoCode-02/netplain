import http from 'node:http'
import https from 'node:https'
import type { Conn, LocalSite } from '../shared/types'

/** Programs people develop and run their own sites with (others: background apps with a page of their own). */
export const DEV = /^(node|python\d*|py|php|php-cgi|java|javaw|dotnet|iisexpress|ruby|go|deno|bun|docker|com\.docker\.backend|wslrelay|vmmem|nginx|httpd|caddy|hugo|uvicorn|gunicorn|beam\.smp)(\.exe)?$/i

/** The page title of an HTML document, tidied; null when there is none. */
export function titleOf(html: string): string | null {
  const m = /<title[^>]*>([^<]*)<\/title>/i.exec(html)
  const t = m?.[1]
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim()
  return t ? t.slice(0, 80) : null
}

/** Asks localhost:port for its front page: a web site answers with HTTP (or HTTPS); anything else is not one. */
function ask(port: number, secure: boolean): Promise<{ title: string | null } | null> {
  return new Promise((resolve) => {
    let body = ''
    const req = (secure ? https : http).get(
      { host: 'localhost', port, path: '/', timeout: 1200, agent: false, rejectUnauthorized: false, headers: { accept: 'text/html,*/*' } },
      (res) => {
        if (!/html/i.test(String(res.headers['content-type'] ?? ''))) {
          res.destroy()
          return resolve({ title: null })
        }
        res.setEncoding('utf8')
        res.on('data', (c: string) => {
          body += c
          if (body.length > 32_000 || /<\/title>/i.test(body)) res.destroy()
        })
        res.on('close', () => resolve({ title: titleOf(body) }))
      }
    )
    req.on('timeout', () => req.destroy())
    req.on('error', () => resolve(null))
  })
}

/**
 * Web sites running on this computer, found among its listening TCP ports (Netplain's own are left out).
 * Each port is asked over HTTP, then HTTPS; ports that answer neither (databases, system services) are skipped.
 */
export async function localSites(listening: Conn[], self = process.pid): Promise<LocalSite[]> {
  const ports = new Map<number, Conn>()
  // Not Windows' own HTTP service (pid 4) nor the share tunnel's metrics page.
  for (const c of listening) if (c.proto === 'tcp' && c.pid !== null && c.pid !== self && c.pid > 4 && !/cloudflared/i.test(c.app) && !ports.has(c.localPort)) ports.set(c.localPort, c)
  const found = await Promise.all(
    [...ports.values()].slice(0, 60).map(async (c): Promise<LocalSite | null> => {
      const plain = await ask(c.localPort, false)
      const secure = plain ? null : await ask(c.localPort, true)
      const hit = plain ?? secure
      return hit && { port: c.localPort, https: !plain, title: hit.title, app: c.title ?? c.app, dev: DEV.test(c.app) }
    })
  )
  return found.filter((s): s is LocalSite => s !== null).sort((a, b) => Number(b.dev) - Number(a.dev) || a.port - b.port)
}
