import { Resolver } from 'node:dns/promises'
import net from 'node:net'
import type { DnsAnswer, DnsReport, MailPolicy, RecordType } from '../shared/types'

export const RECORD_TYPES: RecordType[] = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SOA', 'CAA', 'SRV']
/** Your own DNS first, then three public ones to compare with. */
const SERVERS: [string, string | null][] = [
  ['system', null],
  ['Cloudflare', '1.1.1.1'],
  ['Google', '8.8.8.8'],
  ['Quad9', '9.9.9.9']
]

/** Records as one line each, the way `dig +short` writes them, sorted so two answers compare as text. */
export function lines(type: RecordType | 'PTR', raw: unknown): string[] {
  const list: unknown[] = Array.isArray(raw) ? raw : [raw]
  const one = (r: unknown): string => {
    if (typeof r === 'string') return r
    if (Array.isArray(r)) return r.join('')
    const o = r as Record<string, unknown>
    if (type === 'MX') return `${o.priority} ${o.exchange}`
    if (type === 'SRV') return `${o.priority} ${o.weight} ${o.port} ${o.name}`
    if (type === 'SOA') return `${o.nsname} ${o.hostmaster} ${o.serial} ${o.refresh} ${o.retry} ${o.expire} ${o.minttl}`
    if (type === 'CAA') {
      const tag = Object.keys(o).find((k) => k !== 'critical')
      return tag ? `${o.critical ?? 0} ${tag} "${o[tag]}"` : ''
    }
    return JSON.stringify(o)
  }
  const out = list.map(one).filter(Boolean)
  return type === 'MX' ? out.sort((a, b) => parseInt(a) - parseInt(b) || a.localeCompare(b)) : out.sort()
}

const reason = (code: unknown): DnsAnswer['error'] =>
  code === 'ENODATA' ? 'none' : code === 'ENOTFOUND' ? 'nxdomain' : code === 'ETIMEOUT' || code === 'ECONNREFUSED' ? 'timeout' : 'fail'

/** What SPF ("…-all") and DMARC ("p=reject") say about mail claiming to come from the domain. */
const spfOf = (txt: string[]) => txt.find((t) => /^v=spf1\b/i.test(t)) ?? null
const allOf = (spf: string | null) => (spf ? /(?:^|\s)([-~?+]?)all(?:\s|$)/i.exec(spf)?.[1] : undefined)
/** The domain an SPF record hands over to ("redirect=_spf.google.com"). */
export const redirectOf = (txt: string[]) => /(?:^|\s)redirect=(\S+)/i.exec(spfOf(txt) ?? '')?.[1] ?? null

/** `redirected`: the TXT records of the redirect target, which decide when the record itself has no "all". */
export function mailPolicy(txt: string[], dmarcTxt: string[], redirected: string[] = []): MailPolicy {
  const spf = spfOf(txt)
  const dmarc = dmarcTxt.find((t) => /^v=DMARC1\b/i.test(t)) ?? null
  const all = allOf(spf) ?? allOf(spfOf(redirected))
  const p = dmarc ? /\bp\s*=\s*(\w+)/i.exec(dmarc)?.[1]?.toLowerCase() : undefined
  return {
    spf: !spf ? 'missing' : all === '-' ? 'strict' : all === '~' ? 'soft' : 'open',
    dmarc: !dmarc ? 'missing' : p === 'reject' || p === 'quarantine' ? p : 'none',
    spfRecord: spf,
    dmarcRecord: dmarc
  }
}

/** Asks each server once, timed. An IP is looked up backwards (PTR) whatever the type. */
export async function dnsQuery(name: string, wanted: RecordType): Promise<DnsReport> {
  const type: RecordType | 'PTR' = net.isIP(name) ? 'PTR' : wanted
  const ask = async ([server, ip]: [string, string | null], kind = type, q = name): Promise<DnsAnswer> => {
    const r = new Resolver({ timeout: 3000, tries: 1 })
    if (ip) r.setServers([ip])
    const t0 = performance.now()
    try {
      const records = lines(kind, kind === 'PTR' ? await r.reverse(q) : await r.resolve(q, kind))
      // An empty answer without an error code means the same as ENODATA.
      return { server, ip: ip ?? r.getServers()[0] ?? null, ms: Math.round(performance.now() - t0), records, error: records.length ? null : 'none' }
    } catch (e) {
      return { server, ip: ip ?? r.getServers()[0] ?? null, ms: Math.round(performance.now() - t0), records: [], error: reason((e as NodeJS.ErrnoException).code) }
    }
  }
  const mailOf = async () => {
    const [txt, dmarc] = await Promise.all([ask(SERVERS[0], 'TXT'), ask(SERVERS[0], 'TXT', `_dmarc.${name}`)])
    const to = redirectOf(txt.records)
    return mailPolicy(txt.records, dmarc.records, to ? (await ask(SERVERS[0], 'TXT', to)).records : [])
  }
  const [answers, mail] = await Promise.all([Promise.all(SERVERS.map((s) => ask(s))), type === 'MX' || type === 'TXT' ? mailOf() : null])
  return { name, type, answers, mail }
}
