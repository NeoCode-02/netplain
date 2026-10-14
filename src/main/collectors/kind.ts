import type { AdapterKind } from '../../shared/types'

const RULES: [AdapterKind, RegExp][] = [
  ['loopback', /loopback|^lo\d*\b/i],
  ['vpn', /wireguard|wintun|tap-windows|openvpn|tailscale|zerotier|anyconnect|fortinet|globalprotect|nordlynx|proton|\b(tun|tap|wg|utun|ipsec|ppp)\d+\b/i],
  ['virtual', /virtualbox|vmware|hyper-v|vethernet|\bwsl\b|docker|wi-fi direct|parallels|\b(veth\w*|docker\d+|br-\w+|virbr\d+|vboxnet\d+|vmnet\d+|bridge\d+|awdl\d+|llw\d+|anpi\d+|ap\d+|gif\d+|stf\d+)\b/i],
  ['bluetooth', /bluetooth|\bbnep\d+\b/i],
  ['cellular', /cellular|mobile broadband|\bwwan\d*\b|\brmnet\w*\b/i]
]

/** `hint` is what the OS itself says about the link; name-based rules refine it (a "Wi-Fi Direct" adapter is virtual). */
export function adapterKind(name: string, description: string, hint: AdapterKind): AdapterKind {
  if (hint === 'loopback') return 'loopback'
  const text = `${name} ${description}`
  for (const [kind, re] of RULES) if (re.test(text)) return kind
  return hint
}

/** "3C9180445566", "3c-91-80-44-55-66", "0:1c:42:0:0:8" → "3c:91:80:44:55:66". */
export function normMac(raw: string): string {
  const s = raw.trim().toLowerCase()
  const parts = /^[0-9a-f]{12}$/.test(s) ? s.match(/../g)! : s.split(/[:-]/)
  if (parts.length !== 6 || parts.some((p) => !/^[0-9a-f]{1,2}$/.test(p))) return ''
  const mac = parts.map((p) => p.padStart(2, '0')).join(':')
  return mac === '00:00:00:00:00:00' ? '' : mac
}
