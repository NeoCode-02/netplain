import { describe, expect, it } from 'vitest'
import { bandOf, channelOf, parseAirport, parseNmcli, parseWinScan, percent, textSecurity, winSecurity } from './wifiscan'

// Made-up networks and documentation MACs only.
describe('wifi scan', () => {
  it('turns frequencies into channels and bands', () => {
    expect([2412, 2437, 2472, 2484, 5180, 5745, 5955, 6115].map(channelOf)).toEqual([1, 6, 13, 14, 36, 149, 1, 33])
    expect([2437, 5180, 6115].map(bandOf)).toEqual(['2.4', '5', '6'])
    expect([percent(-40), percent(-75), percent(-110), percent(-20)]).toEqual([100, 50, 0, 100])
  })

  it('names the weakest protection a network allows', () => {
    expect(['Open80211|None', 'Open80211|Wep', 'SharedKey80211|Wep', 'WpaPsk|Tkip', 'RsnaPsk|Ccmp', 'Wpa3Sae|Ccmp', 'Rsna|Ccmp', 'Ihv|Ihv'].map((x) => winSecurity(...(x.split('|') as [string, string])))).toEqual([
      'open',
      'wep',
      'wep',
      'wpa',
      'wpa2',
      'wpa3',
      'enterprise',
      'other'
    ])
    expect(['', '--', 'WEP', 'WPA1 WPA2', 'WPA2', 'WPA2 WPA3', 'WPA3', 'WPA2 802.1X', 'spairport_security_mode_none', 'spairport_security_mode_wpa_personal_mixed', 'spairport_security_mode_wpa2_personal', 'spairport_security_mode_wpa3_personal'].map(textSecurity)).toEqual([
      'open',
      'open',
      'wep',
      'wpa',
      'wpa2',
      'wpa2',
      'wpa3',
      'enterprise',
      'open',
      'wpa',
      'wpa2',
      'wpa3'
    ])
  })

  it('reads the Windows scan, nmcli and macOS', () => {
    const win = parseWinScan(
      JSON.stringify({
        access: 'Allowed',
        nets: [
          { ssid: 'Cafe', bssid: '00-00-5E-00-53-01', dbm: -60, khz: 2437000, auth: 'WpaPsk', enc: 'Tkip' },
          { ssid: '', bssid: '00:00:5e:00:53:02', dbm: -80, khz: 5180000, auth: 'RsnaPsk', enc: 'Ccmp' }
        ]
      })
    )
    expect(win).toEqual({
      access: 'Allowed',
      nets: [
        { ssid: 'Cafe', bssid: '00:00:5e:00:53:01', signal: 80, dbm: -60, channel: 6, band: '2.4', security: 'wpa', tkip: true },
        { ssid: '', bssid: '00:00:5e:00:53:02', signal: 40, dbm: -80, channel: 36, band: '5', security: 'wpa2', tkip: false }
      ]
    })
    // One network in PowerShell 5 JSON is an object, not a list.
    expect(parseWinScan('{"access":"Allowed","nets":{"ssid":"A","bssid":"00:00:5e:00:53:03","dbm":-50,"khz":2412000,"auth":"Open80211","enc":"None"}}').nets[0].security).toBe('open')

    expect(parseNmcli('Home\\:5G:00\\:00\\:5E\\:00\\:53\\:04:5200 MHz:72:WPA2\n:00\\:00\\:5E\\:00\\:53\\:05:2462 MHz:30:\n')).toEqual([
      { ssid: 'Home:5G', bssid: '00:00:5e:00:53:04', signal: 72, dbm: null, channel: 40, band: '5', security: 'wpa2', tkip: false },
      { ssid: '', bssid: '00:00:5e:00:53:05', signal: 30, dbm: null, channel: 11, band: '2.4', security: 'open', tkip: false }
    ])

    const mac = {
      SPAirPortDataType: [
        {
          spairport_airport_interfaces: [
            {
              spairport_current_network_information: { _name: 'Home', spairport_network_channel: '36 (5GHz, 80MHz)', spairport_security_mode: 'spairport_security_mode_wpa3_personal', spairport_signal_noise: '-55 dBm / -92 dBm' },
              spairport_airport_other_local_wireless_networks: [{ _name: 'Shop', spairport_network_channel: '6 (2GHz, 20MHz)', spairport_security_mode: 'spairport_security_mode_none' }]
            }
          ]
        }
      ]
    }
    expect(parseAirport(JSON.stringify(mac))).toEqual([
      { ssid: 'Home', bssid: null, signal: 90, dbm: -55, channel: 36, band: '5', security: 'wpa3', tkip: false },
      { ssid: 'Shop', bssid: null, signal: 0, dbm: null, channel: 6, band: '2.4', security: 'open', tkip: false }
    ])
  })
})
