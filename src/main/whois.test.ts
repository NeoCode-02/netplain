import { describe, expect, it } from 'vitest'
import { parseRdap } from './whois'

const vcard = (fn: string, email?: string) => ['vcard', [['version', {}, 'text', '4.0'], ['fn', {}, 'text', fn], ...(email ? [['email', {}, 'text', email]] : [])]]

describe('rdap', () => {
  it('reads an IP block: the holder behind maintainer handles, range, abuse contact', () => {
    const r = parseRdap({
      objectClassName: 'ip network',
      name: 'EXAMPLE-NET',
      country: 'UZ',
      startAddress: '192.0.2.0',
      endAddress: '192.0.2.255',
      status: ['active'],
      events: [{ eventAction: 'registration', eventDate: '2008-12-17T10:43:39Z' }],
      entities: [
        { roles: ['registrant'], vcardArray: vcard('EXAMPLE-MNT') },
        { roles: ['abuse'], vcardArray: vcard('Abuse desk', 'abuse@example.net'), entities: [{ roles: ['registrant'], vcardArray: vcard('"Example Telecom" Joint Stock Company') }] }
      ]
    } as never)
    expect(r).toMatchObject({ kind: 'ip', name: 'EXAMPLE-NET', holder: '"Example Telecom" Joint Stock Company', country: 'UZ', range: '192.0.2.0 – 192.0.2.255', created: '2008-12-17', abuse: 'abuse@example.net', expires: null })
  })

  it('reads a domain: registrar, dates, name servers; privacy-hidden names stay empty', () => {
    const r = parseRdap({
      objectClassName: 'domain',
      ldhName: 'EXAMPLE.COM',
      status: ['client transfer prohibited'],
      events: [
        { eventAction: 'registration', eventDate: '1995-08-14T04:00:00Z' },
        { eventAction: 'expiration', eventDate: '2027-08-13T04:00:00Z' },
        { eventAction: 'last changed', eventDate: '2026-08-14T08:01:43Z' }
      ],
      entities: [
        { roles: ['registrant'], vcardArray: vcard('REDACTED FOR PRIVACY') },
        { roles: ['registrar'], vcardArray: vcard('Example Registrar, Inc.') }
      ],
      nameservers: [{ ldhName: 'NS1.EXAMPLE.NET.' }, { ldhName: 'not.defined.' }],
      remarks: [{ title: 'description', description: ['Example network'] }]
    } as never)
    expect(r).toEqual({
      kind: 'domain',
      name: 'example.com',
      holder: null,
      about: 'Example network',
      registrar: 'Example Registrar, Inc.',
      country: null,
      range: null,
      created: '1995-08-14',
      updated: '2026-08-14',
      expires: '2027-08-13',
      abuse: null,
      status: ['client transfer prohibited'],
      nameservers: ['ns1.example.net']
    })
  })
})
