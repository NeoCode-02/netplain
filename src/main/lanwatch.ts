import fs from 'node:fs'
import net from 'node:net'
import path from 'node:path'
import type { Adapter, Neighbor } from '../shared/types'
import { networkOf } from './usage'

export type LanKind = 'newDevice' | 'arpSpoof' | 'netChange'

/** What the watch remembers about one network. */
interface Net {
  first: number
  /** The user's first scan here is the starting list, not news. */
  swept: boolean
  macs: string[]
  gatewayMac: string | null
  dns: string[]
}

/**
 * A network is learnt for its first day: devices seen then, or in the first scan, are its own.
 * After that a stranger is news, and so is a router whose hardware address changed (ARP spoofing),
 * a DNS server swapped, or a proxy switched on. A café visited once never gets past learning.
 */
export const LEARN = 24 * 3_600_000

export function createLanWatch(file: string, tell: (kind: LanKind, app: string, detail: string) => void) {
  let st: { nets: Record<string, Net>; proxy: string | null } = { nets: {}, proxy: null }
  try {
    st = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    // first run
  }
  const save = () => {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(st))
    fs.renameSync(`${file}.tmp`, file)
  }

  return {
    /** The internet adapter's neighbours; `scan` when they come from the user's scan. */
    check(a: Adapter, list: Neighbor[], scan = false, now = Date.now()) {
      if (!a.gateway) return
      // ponytail: networks are told apart by name and router address; two cabled networks with the same router address look like one.
      const key = `${networkOf(a).key}|${a.gateway}`
      const mine = list.filter((d) => a.ipv4.some((c) => c.split('/')[0] === d.via))
      const dns = a.dns.filter((d) => net.isIPv4(d)).sort()
      const n = (st.nets[key] ??= { first: now, swept: false, macs: [], gatewayMac: null, dns })
      const learning = now - n.first < LEARN || (scan && !n.swept)
      if (scan) n.swept = true

      const gw = mine.find((d) => d.ip === a.gateway)
      if (gw && n.gatewayMac && gw.mac !== n.gatewayMac) {
        // The address of the router now leads to another card: someone may be in the middle.
        const twin = mine.find((d) => d.mac === gw.mac && d.ip !== gw.ip)
        tell('arpSpoof', '', [gw.ip, n.gatewayMac, gw.mac, twin?.ip ?? ''].join('|'))
      }
      if (gw) n.gatewayMac = gw.mac
      for (const d of mine) {
        if (n.macs.includes(d.mac)) continue
        n.macs.push(d.mac)
        if (!learning && d !== gw) tell('newDevice', d.vendor ?? '', `${d.ip}|${d.mac}`)
      }
      if (dns.length && n.dns.length && dns.join() !== n.dns.join()) tell('netChange', '', `dns|${n.dns.join(', ')}|${dns.join(', ')}`)
      if (dns.length) n.dns = dns
      save()
    },

    /** The system proxy as Chromium resolves it ("DIRECT", "PROXY host:port"…). */
    proxy(p: string) {
      if (st.proxy === p) return
      if (st.proxy !== null) tell('netChange', '', `proxy|${st.proxy}|${p}`)
      st.proxy = p
      save()
    }
  }
}
