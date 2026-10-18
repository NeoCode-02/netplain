import type { Exposure, Finding, Security } from '../../shared/types'
import { service, where } from './explain'
import type { Dict } from './i18n'

const esc = (s: unknown) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`)
const MARK: Record<Finding['level'], string> = { bad: '●', warn: '▲', info: '·', ok: '✓' }

/** A self-contained page for printing to PDF: no scripts, nothing loaded from anywhere (the CSP says so too). */
export function reportHtml(t: Dict, lang: string, sec: Security | null, exp: Exposure | null, version: string): string {
  const s = t.security
  const r = t.report
  const x = s.exposure
  const parts: string[] = []
  if (sec) {
    const bad = sec.findings.filter((f) => f.level === 'bad').length
    const warn = sec.findings.filter((f) => f.level === 'warn').length
    parts.push(`<h2>${esc(bad ? s.verdictBad(bad) : warn ? s.verdictWarn(warn) : s.verdictOk)}</h2>`)
    parts.push(
      `<table>${sec.findings
        .map((f) => {
          const [title, body] = s.findings[f.key] ?? [f.key, () => '']
          return `<tr class="${f.level}"><td class="mark">${MARK[f.level]}</td><td><b>${esc(title)}</b><br>${esc(body(f.params))}</td></tr>`
        })
        .join('')}</table>`
    )
  }
  if (exp) {
    const nat = x.nat[exp.nat]
    const ports = exp.db?.ports ?? []
    parts.push(`<h2>${esc(s.tabs.exposure)}</h2>`)
    parts.push(`<p>${esc(x.address)}: <b>${esc(exp.ip)}</b> ${esc(where(exp, lang))}${nat ? `<br>NAT: ${esc(nat[0])}. ${esc(nat[1])}` : ''}</p>`)
    parts.push(`<h3>${esc(x.shodan)}</h3>`)
    parts.push(
      ports.length
        ? `<ul>${ports
            .map((p) => {
              const key = service('tcp', p)
              return `<li>${p}${key ? ` — ${esc(t.services[key][0])}` : ''}</li>`
            })
            .join('')}</ul>`
        : `<p>${esc(x.shodanNone)}</p>`
    )
    if (exp.db?.vulns.length) parts.push(`<p class="warn">${esc(x.vulns(exp.db.vulns.length))} ${esc(exp.db.vulns.join(', '))}</p>`)
    parts.push(`<h3>${esc(x.router)}</h3>`)
    parts.push(
      !exp.upnp
        ? `<p>${esc(x.upnpOff)}</p>`
        : exp.upnp.maps.length
          ? `<ul>${exp.upnp.maps.map((m) => `<li>${m.external}/${esc(m.protocol)} → ${esc(m.client)}:${m.internal} ${esc(m.description)}</li>`).join('')}</ul><p class="warn">${esc(x.upnpWhy)}</p>`
          : `<p>${esc(x.upnpNone)}</p>`
    )
  }
  const when = new Date().toLocaleString(lang, { dateStyle: 'long', timeStyle: 'short' })
  return `<!doctype html><html lang="${esc(lang)}"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${esc(r.title)}</title>
<style>
body { font: 11pt/1.45 system-ui, sans-serif; color: #17181b; margin: 0; }
h1 { font-size: 18pt; margin: 0 0 2pt; } h2 { font-size: 13pt; margin: 18pt 0 6pt; } h3 { font-size: 11pt; margin: 12pt 0 4pt; }
.meta { color: #666; margin: 0 0 12pt; } table { border-collapse: collapse; width: 100%; }
td { padding: 6pt 4pt; border-top: 1px solid #e3e4e6; vertical-align: top; } .mark { width: 14pt; font-weight: 700; }
.bad .mark { color: #c62828; } .warn .mark, p.warn { color: #9a5b00; } .ok .mark { color: #2e7d32; } .info .mark { color: #888; }
.foot { margin-top: 18pt; color: #666; font-size: 9pt; }
</style></head><body>
<h1>${esc(r.title)}</h1>
<p class="meta">${esc(r.made(when, version))}</p>
${parts.join('\n')}
<p class="foot">${esc(s.honest)}</p>
</body></html>`
}
