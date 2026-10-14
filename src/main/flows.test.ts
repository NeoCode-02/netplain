import { describe, expect, it } from 'vitest'
import type { Packet } from '../shared/types'
import { classify, FIELDS, filterError, parseDetail, parseLine } from './capture'
import { createTraffic, summarize, UNKNOWN } from './flows'

const line = (v: Partial<Record<(typeof FIELDS)[number], string>>) => FIELDS.map((f) => v[f] ?? '').join('\t')

describe('tshark lines', () => {
  it('reads a TLS hello with its server name', () => {
    const p = parseLine(
      line({ 'frame.number': '14', 'frame.time_epoch': '1791960758.889243500', 'frame.len': '512', 'ip.src': '192.168.0.2', 'ip.dst': '104.20.23.154', 'tcp.srcport': '65160', 'tcp.dstport': '443', '_ws.col.protocol': 'TLSv1.2', '_ws.col.info': 'Client Hello (SNI=example.com)', 'tls.handshake.extensions_server_name': 'example.com' })
    )
    expect(p).toEqual({ n: 14, t: 1791960758889, len: 512, src: '192.168.0.2', dst: '104.20.23.154', sport: 65160, dport: 443, transport: 'tcp', proto: 'TLSv1.2', info: 'Client Hello (SNI=example.com)', dnsQuery: null, dnsAnswers: [], sni: 'example.com', host: null })
  })
  it('reads DNS answers, IPv6 and nested headers', () => {
    const dns = parseLine(line({ 'frame.number': '7', 'frame.time_epoch': '1', 'frame.len': '103', 'ip.src': '192.168.0.1', 'ip.dst': '192.168.0.2', 'udp.srcport': '53', 'udp.dstport': '58771', 'dns.qry.name': 'example.com', 'dns.a': '104.20.23.154,172.66.147.243' }))!
    expect(dns).toMatchObject({ transport: 'udp', sport: 53, dnsQuery: 'example.com', dnsAnswers: ['104.20.23.154', '172.66.147.243'] })
    expect(parseLine(line({ 'frame.number': '1', 'frame.time_epoch': '1', 'frame.len': '90', 'ipv6.src': 'fe80::1', 'ipv6.dst': 'ff02::fb', 'udp.srcport': '5353', 'udp.dstport': '5353' }))).toMatchObject({ src: 'fe80::1', dst: 'ff02::fb' })
    // An ICMP error carries the IP header of the packet it is about; the outer addresses count.
    expect(parseLine(line({ 'frame.number': '2', 'frame.time_epoch': '1', 'frame.len': '70', 'ip.src': '10.0.0.1,192.168.0.2', 'ip.dst': '192.168.0.2,8.8.8.8' }))).toMatchObject({ src: '10.0.0.1', dst: '192.168.0.2', transport: 'other' })
    expect(parseLine('too\tshort')).toBeNull()
  })
  it('tells a refused capture from other failures', () => {
    expect(classify("tshark: The capture session could not be initiated on interface 'eth0' (You don't have permission to capture on that device).")).toBe('denied')
    expect(classify('tshark: There is no device named "x".')).toBe('error')
  })
})

describe('traffic', () => {
  const pkt = (p: Partial<Packet>): Packet => ({ n: 0, t: 1000, len: 100, src: '', dst: '', sport: null, dport: null, transport: 'tcp', proto: '', info: '', dnsQuery: null, dnsAnswers: [], sni: null, host: null, ...p })
  const geo = (ip: string) => (ip === '104.20.23.154' ? { country: 'US', org: 'Cloudflare, Inc.' } : { country: null, org: null })

  it('counts bytes per program and place, naming places by SNI or DNS', () => {
    const tr = createTraffic()
    tr.setLocal(['192.168.0.2'])
    tr.add(pkt({ src: '192.168.0.1', dst: '192.168.0.2', sport: 53, dport: 5000, transport: 'udp', len: 90, dnsQuery: 'cdn.example.com', dnsAnswers: ['104.20.23.154'] }))
    tr.add(pkt({ src: '192.168.0.2', dst: '104.20.23.154', sport: 50000, dport: 443, len: 60 }))
    tr.add(pkt({ src: '104.20.23.154', dst: '192.168.0.2', sport: 443, dport: 50000, len: 1500 }))
    tr.add(pkt({ src: '192.168.0.2', dst: '104.20.23.154', sport: 50000, dport: 443, len: 500, sni: 'example.com' }))
    tr.add(pkt({ src: '192.168.0.2', dst: '93.184.215.14', sport: 50001, dport: 443, len: 70 }))
    // Not this computer's traffic (someone else's broadcast).
    tr.add(pkt({ src: '192.168.0.9', dst: '255.255.255.255', transport: 'udp', len: 300 }))
    tr.resolve((transport, port) => (transport === 'tcp' && port === 50000 ? 10 : transport === 'udp' && port === 5000 ? 20 : null))

    expect(tr.totals()).toMatchObject({ rx: 1590, tx: 630, since: 1000 })
    const per = tr.perPid()
    expect(per.get(10)?.get('example.com')).toEqual({ rx: 1500, tx: 560, ip: '104.20.23.154' })
    expect(per.get(20)?.get('192.168.0.1')).toMatchObject({ rx: 90 })
    expect(per.get(UNKNOWN)?.get('93.184.215.14')).toMatchObject({ tx: 70 })

    const procs = new Map([[10, { pid: 10, name: 'chrome', path: 'C:\\chrome.exe', title: 'Google Chrome' }]])
    const first = summarize(per, procs, geo, new Map(), 0)
    expect(first.apps[0]).toMatchObject({ key: 'Google Chrome', app: 'chrome', rx: 1500, tx: 560, rxRate: 0 })
    expect(first.apps[0].places[0]).toMatchObject({ name: 'example.com', country: 'US', org: 'Cloudflare, Inc.' })
    expect(first.apps.map((a) => a.key)).toEqual(['Google Chrome', 'PID 20', '?'])

    tr.add(pkt({ src: '104.20.23.154', dst: '192.168.0.2', sport: 443, dport: 50000, len: 1000, t: 2000 }))
    const second = summarize(tr.perPid(), procs, geo, first.next, 2)
    expect(second.apps[0].rxRate).toBe(4000)
  })

  it('folds quiet flows without losing their bytes, and resets', () => {
    const tr = createTraffic()
    tr.setLocal(['192.168.0.2'])
    tr.add(pkt({ src: '192.168.0.2', dst: '8.8.8.8', sport: 40000, dport: 443, len: 100, t: 0 }))
    tr.resolve(() => 7)
    tr.prune(200_000)
    tr.add(pkt({ src: '192.168.0.2', dst: '8.8.8.8', sport: 40000, dport: 443, len: 50, t: 200_000 }))
    tr.resolve(() => 7)
    expect(tr.perPid().get(7)?.get('8.8.8.8')).toMatchObject({ tx: 150 })
    tr.reset()
    expect(tr.perPid().size).toBe(0)
    expect(tr.totals()).toEqual({ rx: 0, tx: 0, since: null })
  })
})

describe('packet details', () => {
  it('turns tshark -V -x output into a tree and a hex dump', () => {
    const text = [
      'Frame 8: Packet, 512 bytes on wire (4096 bits), 512 bytes captured (4096 bits)',
      '    Encapsulation type: Ethernet (1)',
      '    [Protocols in frame: eth:ethertype:ip:tcp:tls]',
      'Internet Protocol Version 4, Src: 192.168.0.2, Dst: 104.20.23.154',
      '    0100 .... = Version: 4',
      '    010. .... = Flags: 0x2, Don\'t fragment',
      '        .1.. .... = Don\'t fragment: Set',
      '    Time to Live: 128',
      '',
      '0000  a4 2b b0 11 22 33 3c 91 80 44 55 66 08 00 45 00   .+.."3<..DUf..E.',
      '0010  01 f2 bd e4 40 00 80 06 00 00 c0 a8 00 02 68 14   ....@.........h.'
    ].join('\r\n')
    const d = parseDetail(text)
    expect(d.tree.map((n) => n.text)).toEqual(['Frame 8: Packet, 512 bytes on wire (4096 bits), 512 bytes captured (4096 bits)', 'Internet Protocol Version 4, Src: 192.168.0.2, Dst: 104.20.23.154'])
    expect(d.tree[1].children.map((n) => n.text)).toEqual(['0100 .... = Version: 4', "010. .... = Flags: 0x2, Don't fragment", 'Time to Live: 128'])
    expect(d.tree[1].children[1].children[0].text).toBe(".1.. .... = Don't fragment: Set")
    expect(d.hex.split('\n')).toHaveLength(2)
    expect(parseDetail('').tree).toEqual([])
  })
  it('tells filter mistakes from a growing file', () => {
    expect(filterError('tshark: Unexpected end of filter expression.')).toBe(true)
    expect(filterError('tshark: "foo" is neither a field nor a protocol name.')).toBe(true)
    expect(filterError('tshark: The file "x.pcapng" appears to have been cut short in the middle of a packet.')).toBe(false)
  })
})
