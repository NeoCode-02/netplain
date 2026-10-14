import fs from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'
import { adapterKind, normMac } from './kind'
import { parseNmcli, parseProcArp, parseProcNet, parseResolv, parseRoute, parseWireless } from './linux'
import { parseAirport, parseArpMac, parseDefaultRoute, parseIfconfig, parseLsof, parseNetstat as parseMacNetstat, parsePorts, parsePs, parseScutil } from './mac'
import { parseArp, parseNetstat, parseProcs, parseSnapshot, parseWlan } from './win'

const fixture = (f: string) => fs.readFileSync(path.join(__dirname, 'fixtures', f), 'utf8')

describe('kind', () => {
  it('lets names refine what the OS reports', () => {
    expect(adapterKind('Local Area Connection* 9', 'Microsoft Wi-Fi Direct Virtual Adapter', 'wifi')).toBe('virtual')
    expect(adapterKind('Ethernet', 'TAP-Windows Adapter V9', 'ethernet')).toBe('vpn')
    expect(adapterKind('vEthernet (WSL (Hyper-V firewall))', 'Hyper-V Virtual Ethernet Adapter', 'ethernet')).toBe('virtual')
    expect(adapterKind('WiFi', 'Intel(R) Wi-Fi 6 AX201 160MHz', 'wifi')).toBe('wifi')
    expect(adapterKind('utun3', '', 'other')).toBe('vpn')
    expect(adapterKind('docker0', '', 'virtual')).toBe('virtual')
    expect(adapterKind('enp3s0', '', 'ethernet')).toBe('ethernet')
  })
  it('normalises MACs and drops empty ones', () => {
    expect(normMac('3C9180445566')).toBe('3c:91:80:44:55:66')
    expect(normMac('3c-91-80-44-55-66')).toBe('3c:91:80:44:55:66')
    expect(normMac('2:1a:3b:4c:5d:6e')).toBe('02:1a:3b:4c:5d:6e')
    expect(normMac('00:00:00:00:00:00')).toBe('')
    expect(normMac('')).toBe('')
  })
})

describe('windows', () => {
  it('reads a real snapshot line', () => {
    const list = parseSnapshot(fixture('win-snapshot.json'))
    const wifi = list.find((a) => a.name === 'WiFi')!
    expect(wifi).toMatchObject({ kind: 'wifi', up: true, mac: '3c:91:80:44:55:66', ipv4: ['192.168.0.102/24'], gateway: '192.168.0.1', dns: ['192.168.0.1'], dhcp: true })
    expect(wifi.ipv6[0]).not.toContain('%')
    expect(wifi.wifi).toMatchObject({ ssid: 'Home WiFi', bssid: 'a4:2b:b0:11:22:33', band: '2.4 GHz', channel: 5, radio: '802.11n', auth: 'WPA2-Personal', rxMbps: 54 })
    expect(list.find((a) => a.name === 'Ethernet 2')).toMatchObject({ kind: 'virtual', dns: [], gateway: null })
    expect(list.find((a) => a.name === 'Ethernet')?.kind).toBe('vpn')
    expect(list.find((a) => a.name.startsWith('Loopback'))?.kind).toBe('loopback')
  })
  it('finds Wi-Fi facts by value on translated Windows', () => {
    const ru = ['    Имя                    : WiFi', '    Физический адрес       : 3c:91:80:44:55:66', '    SSID                   : Дом', '    BSSID                  : a4:2b:b0:11:22:33', '    Диапазон               : 5 ГГц', '    Тип радио              : 802.11ax', '    Сигнал                 : 72%'].join('\r\n')
    expect(parseWlan(ru).get('3c:91:80:44:55:66')).toMatchObject({ ssid: 'Дом', bssid: 'a4:2b:b0:11:22:33', signal: 72, band: '5 ГГц', radio: '802.11ax', channel: null })
    expect(parseWlan('There is 1 interface on the system:\n\n    Name : WiFi\n    State : disconnected\n').size).toBe(0)
  })
  it('reads arp -a', () => {
    const list = parseArp(fixture('win-arp.txt'))
    expect(list[0]).toEqual({ ip: '192.168.0.1', mac: 'a4:2b:b0:11:22:33', via: '192.168.0.102', vendor: null })
    expect(list.find((n) => n.ip === '172.27.16.226')?.via).toBe('172.27.16.1')
  })
})

describe('linux', () => {
  it('reads the default gateway per interface', () => {
    const text = 'Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask\t\tMTU\tWindow\tIRTT\nwlan0\t00000000\t0100A8C0\t0003\t0\t0\t600\t00000000\t0\t0\t0\nwlan0\t0000A8C0\t00000000\t0001\t0\t0\t600\t00FFFFFF\t0\t0\t0\n'
    expect([...parseRoute(text)]).toEqual([['wlan0', '192.168.0.1']])
  })
  it('reads /proc/net/arp without incomplete entries', () => {
    const text = 'IP address       HW type     Flags       HW address            Mask     Device\n192.168.0.1      0x1         0x2         a4:2b:b0:11:22:33     *        wlan0\n192.168.0.50     0x1         0x0         00:00:00:00:00:00     *        wlan0\n'
    expect(parseProcArp(text)).toEqual([{ ip: '192.168.0.1', mac: 'a4:2b:b0:11:22:33', via: 'wlan0', vendor: null }])
  })
  it('reads wireless quality, resolvers and nmcli', () => {
    expect(parseWireless('Inter-| sta-|   Quality        |\n face | tus | link level noise |\n wlan0: 0000   54.  -56.  -256        0      0\n').get('wlan0')).toBe(77)
    expect(parseResolv('# generated\nnameserver 192.168.0.1\nnameserver 1.1.1.1\nsearch lan\n')).toEqual(['192.168.0.1', '1.1.1.1'])
    const nm = parseNmcli('no:Neighbour:11\\:22\\:33\\:44\\:55\\:66:30:1:2412 MHz:65 Mbit/s:WPA2:wlan0\nyes:Home\\:WiFi:A4\\:2B\\:B0\\:11\\:22\\:33:77:36:5180 MHz:540 Mbit/s:WPA2:wlan0\n')
    expect(nm.get('wlan0')).toMatchObject({ ssid: 'Home:WiFi', bssid: 'a4:2b:b0:11:22:33', signal: 77, channel: 36, band: '5 GHz', rxMbps: 540 })
  })
})

describe('macos', () => {
  const ifconfig = [
    'lo0: flags=8049<UP,LOOPBACK,RUNNING,MULTICAST> mtu 16384',
    '\tinet 127.0.0.1 netmask 0xff000000',
    'en0: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
    '\tether 3c:91:80:44:55:66',
    '\tinet6 fe80::1c2b:3d4e:5f60:7182%en0 prefixlen 64 secured scopeid 0xe',
    '\tinet 192.168.0.23 netmask 0xffffff00 broadcast 192.168.0.255',
    '\tmedia: autoselect',
    '\tstatus: active',
    'en1: flags=8963<UP,BROADCAST,SMART,RUNNING,PROMISC,SIMPLEX,MULTICAST> mtu 1500',
    '\tether 36:7d:1c:00:00:01',
    '\tstatus: inactive',
    'en7: flags=8863<UP,BROADCAST,SMART,RUNNING,SIMPLEX,MULTICAST> mtu 1500',
    '\tether 00:e0:4c:68:00:01',
    '\tinet 10.0.0.5 netmask 0xffffff00 broadcast 10.0.0.255',
    '\tmedia: autoselect (1000baseT <full-duplex>)',
    '\tstatus: active',
    'utun3: flags=8051<UP,POINTOPOINT,RUNNING,MULTICAST> mtu 1380',
    '\tinet6 fe80::ce81:b1c:bd2c:69e%utun3 prefixlen 64 scopeid 0x10'
  ].join('\n')

  it('reads ifconfig', () => {
    const list = parseIfconfig(ifconfig)
    expect(list.map((i) => i.name)).toEqual(['lo0', 'en0', 'en1', 'en7', 'utun3'])
    expect(list[1]).toEqual({ name: 'en0', up: true, mac: '3c:91:80:44:55:66', ipv4: ['192.168.0.23/24'], ipv6: ['fe80::1c2b:3d4e:5f60:7182/64'], speed: null })
    expect(list[2].up).toBe(false)
    expect(list[3].speed).toBe(1e9)
  })
  it('reads counters, ports, route, resolvers and arp', () => {
    const netstat = [
      'Name       Mtu   Network       Address            Ipkts Ierrs     Ibytes    Opkts Oerrs     Obytes  Coll',
      'lo0        16384 <Link#1>                         10000     0    2000000    10000     0    2000001     0',
      'en0        1500  <Link#14>   3c:91:80:44:55:66   500000     0  600000000   300000     0   40000000     0',
      'en0        1500  192.168.0     192.168.0.23        500000     -  590000000   300000     -   39000000     -'
    ].join('\n')
    expect(parseMacNetstat(netstat).get('lo0')).toEqual({ rx: 2000000, tx: 2000001 })
    expect(parseMacNetstat(netstat).get('en0')).toEqual({ rx: 600000000, tx: 40000000 })
    expect(parsePorts('\nHardware Port: Wi-Fi\nDevice: en0\nEthernet Address: 3c:91:80:44:55:66\n\nHardware Port: USB 10/100/1000 LAN\nDevice: en7\n').get('en7')).toBe('USB 10/100/1000 LAN')
    expect(parseDefaultRoute('   route to: default\n    gateway: 192.168.0.1\n  interface: en0\n')).toEqual({ gateway: '192.168.0.1', iface: 'en0' })
    expect(parseScutil('DNS configuration\n\nresolver #1\n  nameserver[0] : 192.168.0.1\n  nameserver[1] : fe80::1%en0\n\nresolver #2\n  nameserver[0] : 10.0.0.1\n')).toEqual(['192.168.0.1', 'fe80::1'])
    const arp = '? (192.168.0.1) at a4:2b:b0:11:22:33 on en0 ifscope [ethernet]\n? (192.168.0.42) at (incomplete) on en0 ifscope [ethernet]\n? (192.168.0.77) at 2:1a:3b:4c:5d:6e on en0 ifscope [ethernet]\n? (192.168.0.255) at ff:ff:ff:ff:ff:ff on en0 ifscope [ethernet]\n'
    expect(parseArpMac(arp).map((n) => n.mac)).toEqual(['a4:2b:b0:11:22:33', '02:1a:3b:4c:5d:6e'])
  })
  it('reads system_profiler Wi-Fi details', () => {
    const json = JSON.stringify({
      SPAirPortDataType: [
        {
          spairport_airport_interfaces: [
            {
              _name: 'en0',
              spairport_current_network_information: {
                _name: '<redacted>',
                spairport_network_channel: '36 (5GHz, 80MHz)',
                spairport_network_phymode: '802.11ax',
                spairport_network_rate: 864,
                spairport_security_mode: 'spairport_security_mode_wpa2_personal',
                spairport_signal_noise: '-55 dBm / -92 dBm'
              }
            }
          ]
        }
      ]
    })
    expect(parseAirport(json).get('en0')).toMatchObject({ ssid: '', signal: 90, channel: 36, band: '5 GHz', radio: '802.11ax', auth: 'WPA2 PERSONAL', rxMbps: 864 })
    expect(parseAirport('not json').size).toBe(0)
  })
})

describe('sockets', () => {
  it('reads netstat -ano, including translated states', () => {
    const text = [
      'Active Connections',
      '',
      '  Proto  Local Address          Foreign Address        State           PID',
      '  TCP    0.0.0.0:135            0.0.0.0:0              LISTENING       2012',
      '  TCP    192.168.0.102:52345    140.82.112.25:443      ESTABLISHED     5678',
      '  TCP    192.168.0.102:52399    13.107.42.14:443       HERGESTELLT     5678',
      '  TCP    [::1]:6432             [::]:0                 LISTENING       6020',
      '  TCP    [fe80::12%3]:50000     [fe80::1%3]:443        TIME_WAIT       0',
      '  UDP    0.0.0.0:5353           *:*                                    2345'
    ].join('\r\n')
    const s = parseNetstat(text)
    expect(s).toHaveLength(6)
    expect(s[0]).toEqual({ proto: 'tcp', localIp: '0.0.0.0', localPort: 135, remoteIp: null, remotePort: null, state: 'listen', pid: 2012 })
    expect(s[1]).toMatchObject({ remoteIp: '140.82.112.25', remotePort: 443, state: 'established', pid: 5678 })
    expect(s[2].state).toBe('established')
    expect(s[3]).toMatchObject({ localIp: '::1', state: 'listen' })
    expect(s[4]).toMatchObject({ localIp: 'fe80::12', remoteIp: 'fe80::1', state: 'time_wait', pid: 0 })
    expect(s[5]).toMatchObject({ proto: 'udp', localPort: 5353, remoteIp: null, state: 'bound', pid: 2345 })
  })

  it('reads Windows processes', () => {
    expect(parseProcs('4\tSystem\t\t\n5678\tchrome\tC:\\Program Files\\Google\\Chrome\\Application\\chrome.exe\tGoogle Chrome\n')).toEqual([
      { pid: 4, name: 'System', path: null, title: null },
      { pid: 5678, name: 'chrome', path: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe', title: 'Google Chrome' }
    ])
  })

  it('reads lsof -F and ps on macOS', () => {
    const lsof = ['p812', 'f23', 'PTCP', 'n192.168.0.23:52345->140.82.112.25:443', 'TST=ESTABLISHED', 'TQR=0', 'f24', 'PUDP', 'n*:5353', 'p90', 'f5', 'PTCP', 'n[::1]:631', 'TST=LISTEN', ''].join('\n')
    expect(parseLsof(lsof)).toEqual([
      { proto: 'tcp', localIp: '192.168.0.23', localPort: 52345, remoteIp: '140.82.112.25', remotePort: 443, state: 'established', pid: 812 },
      { proto: 'udp', localIp: '0.0.0.0', localPort: 5353, remoteIp: null, remotePort: null, state: 'bound', pid: 812 },
      { proto: 'tcp', localIp: '::1', localPort: 631, remoteIp: null, remotePort: null, state: 'listen', pid: 90 }
    ])
    const ps = parsePs('  812 /Applications/Google Chrome.app/Contents/MacOS/Google Chrome\n   90 cupsd\n')
    expect(ps[0]).toEqual({ pid: 812, name: 'Google Chrome', path: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', title: 'Google Chrome' })
    expect(ps[1]).toEqual({ pid: 90, name: 'cupsd', path: null, title: null })
  })

  it('reads /proc/net/tcp and tcp6', () => {
    const head = '  sl  local_address rem_address   st tx_queue rx_queue tr tm->when retrnsmt   uid  timeout inode\n'
    const tcp = `${head}   0: 0100007F:0277 00000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22188 1\n   1: 6600A8C0:CC39 1970528C:01BB 01 00000000:00000000 00:00000000 00000000  1000        0 33445 1\n`
    expect(parseProcNet(tcp, 'tcp')).toEqual([
      { proto: 'tcp', localIp: '127.0.0.1', localPort: 631, remoteIp: null, remotePort: null, state: 'listen', pid: null, inode: 22188 },
      { proto: 'tcp', localIp: '192.168.0.102', localPort: 52281, remoteIp: '140.82.112.25', remotePort: 443, state: 'established', pid: null, inode: 33445 }
    ])
    const tcp6 = `${head}   0: 00000000000000000000000001000000:0277 00000000000000000000000000000000:0000 0A 00000000:00000000 00:00000000 00000000     0        0 22189 1\n   1: 0000000000000000FFFF00006600A8C0:A1B2 0000000000000000FFFF00000100A8C0:0035 01 00000000:00000000 00:00000000 00000000     0        0 5 1\n`
    const six = parseProcNet(tcp6, 'tcp')
    expect(six[0]).toMatchObject({ localIp: '::1', localPort: 631, state: 'listen' })
    expect(six[1]).toMatchObject({ localIp: '192.168.0.102', remoteIp: '192.168.0.1', remotePort: 53 })
  })
})
