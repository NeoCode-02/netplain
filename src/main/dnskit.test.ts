import dns from 'node:dns'
import { describe, expect, it } from 'vitest'
import { dnsQuery, lines, mailPolicy, redirectOf } from './dnskit'

describe('dns records', () => {
  it('writes each type as one line, sorted', () => {
    expect(lines('A', ['9.9.9.9', '1.1.1.1'])).toEqual(['1.1.1.1', '9.9.9.9'])
    expect(
      lines('MX', [
        { priority: 20, exchange: 'b.mx.example' },
        { priority: 5, exchange: 'a.mx.example' }
      ])
    ).toEqual(['5 a.mx.example', '20 b.mx.example'])
    expect(lines('TXT', [['v=spf1 ', '-all'], ['hello']])).toEqual(['hello', 'v=spf1 -all'])
    expect(lines('SOA', { nsname: 'ns1.example', hostmaster: 'admin.example', serial: 7, refresh: 1, retry: 2, expire: 3, minttl: 4 })).toEqual(['ns1.example admin.example 7 1 2 3 4'])
    expect(lines('CAA', [{ critical: 0, issue: 'letsencrypt.org' }])).toEqual(['0 issue "letsencrypt.org"'])
    expect(lines('SRV', [{ priority: 10, weight: 5, port: 5060, name: 'sip.example' }])).toEqual(['10 5 5060 sip.example'])
  })

  it('reads what SPF and DMARC promise', () => {
    expect(mailPolicy(['v=spf1 include:_spf.example -all'], ['v=DMARC1; p=reject; rua=mailto:x@example'])).toMatchObject({ spf: 'strict', dmarc: 'reject' })
    expect(mailPolicy(['v=spf1 include:mall.example ~all', 'other'], ['v=DMARC1;p=quarantine'])).toMatchObject({ spf: 'soft', dmarc: 'quarantine' })
    // "mall" is not "all": no all-term means nothing is refused.
    expect(mailPolicy(['v=spf1 include:mall.example'], ['v=DMARC1; p=none'])).toMatchObject({ spf: 'open', dmarc: 'none' })
    expect(mailPolicy(['google-site-verification=x'], [])).toEqual({ spf: 'missing', dmarc: 'missing', spfRecord: null, dmarcRecord: null })
    // A redirect hands the decision to another domain's record.
    expect(redirectOf(['v=spf1 redirect=_spf.example.com'])).toBe('_spf.example.com')
    expect(mailPolicy(['v=spf1 redirect=_spf.example.com'], [], ['v=spf1 ip4:192.0.2.0/24 ~all'])).toMatchObject({ spf: 'soft', spfRecord: 'v=spf1 redirect=_spf.example.com' })
  })
})

describe('live', () => {
  // The system resolver always answers for localhost's reverse name, or says it has none; it never hangs.
  it('asks every server and times it', async () => {
    const r = await dnsQuery('127.0.0.1', 'A')
    expect(r.type).toBe('PTR')
    expect(r.answers.map((a) => a.server)).toEqual(['system', 'Cloudflare', 'Google', 'Quad9'])
    expect(r.answers.every((a) => a.ms >= 0 && (a.records.length > 0 || a.error !== null))).toBe(true)
    expect(r.answers[0].ip).toBe(dns.getServers()[0] ?? null)
  }, 20_000)
})
