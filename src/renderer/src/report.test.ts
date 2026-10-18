import { describe, expect, it } from 'vitest'
import type { Exposure, Security } from '../../shared/types'
import { LANGS } from './i18n'
import { reportHtml } from './report'

const sec = {
  at: 0,
  findings: [
    { key: 'hostsRedirect', level: 'warn', params: { lines: '6.6.6.6 <img src=http://evil.example/x>' } },
    { key: 'firewallOk', level: 'ok', params: {} }
  ]
} as unknown as Security
const exp: Exposure = {
  ip: '203.0.113.5',
  org: 'Example Telecom',
  country: 'UZ',
  at: 0,
  db: { ports: [22, 8080], vulns: ['CVE-2023-38408'], tags: [], hostnames: [] },
  upnp: { router: 'Home', externalIp: '100.70.1.2', maps: [{ external: 51413, protocol: 'TCP', client: '192.168.1.23', internal: 51413, description: 'Torrent "x"', enabled: true, lease: 0 }] },
  nat: 'cgnat'
}

describe('security report', () => {
  it('puts the verdict, findings and the view from the internet on one page', () => {
    const html = reportHtml(LANGS.en, 'en', sec, exp, '0.2.0')
    expect(html).toContain('No serious signs · 1 thing to check')
    expect(html).toContain('Firewall is on')
    expect(html).toContain('203.0.113.5')
    expect(html).toContain('Shared by your provider (CGNAT)')
    expect(html).toContain('<li>22 — SSH</li>')
    expect(html).toContain('CVE-2023-38408')
    expect(html).toContain('51413/TCP → 192.168.1.23:51413')
    expect(html).toContain('Netplain 0.2.0')
  })

  it('escapes what the computer reported and loads nothing', () => {
    const html = reportHtml(LANGS.uz, 'uz', sec, exp, '0.2.0')
    expect(html).not.toContain('<img')
    expect(html).toContain('&#60;img src=http://evil.example/x&#62;')
    expect(html).toContain('Torrent &#34;x&#34;')
    expect(html).toContain("default-src 'none'")
    expect(html).not.toMatch(/<(script|link|img|iframe)/)
  })

  it('works with only one of the two parts', () => {
    expect(reportHtml(LANGS.en, 'en', null, exp, '1')).not.toContain('thing to check')
    expect(reportHtml(LANGS.en, 'en', sec, null, '1')).not.toContain('203.0.113.5')
  })
})
