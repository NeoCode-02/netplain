import type { WifiNet, WifiSecurity } from '../shared/types'
import { list, tryRun } from './exec'
import { normMac } from './collectors/kind'
import { powershell } from './security'
import { vendorTable } from './tshark'

/**
 * Windows: a fresh scan through the WinRT Wi-Fi API (no compiled helper, no admin rights), then its report.
 * netsh only shows a cached list, often just the network in use, and its labels are translated.
 */
const WIN = String.raw`
$ErrorActionPreference = 'Stop'
$o = @{ access = ''; nets = @() }
try { Add-Type -AssemblyName System.Runtime.WindowsRuntime; $m = [System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 }; $op = ($m | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation${'`'}1' })[0]; $act = ($m | Where-Object { $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncAction' })[0]; $null = [Windows.Devices.WiFi.WiFiAdapter, Windows.Devices.WiFi, ContentType = WindowsRuntime]; $acc = $op.MakeGenericMethod([Windows.Devices.WiFi.WiFiAccessStatus]).Invoke($null, @([Windows.Devices.WiFi.WiFiAdapter]::RequestAccessAsync())); [void]$acc.Wait(5000); $o.access = [string]$acc.Result; if ($o.access -eq 'Allowed') { $l = $op.MakeGenericMethod([System.Collections.Generic.IReadOnlyList[Windows.Devices.WiFi.WiFiAdapter]]).Invoke($null, @([Windows.Devices.WiFi.WiFiAdapter]::FindAllAdaptersAsync())); [void]$l.Wait(5000); foreach ($a in $l.Result) { $s = $act.Invoke($null, @($a.ScanAsync())); [void]$s.Wait(10000); $o.nets += @($a.NetworkReport.AvailableNetworks | ForEach-Object { @{ ssid = [string]$_.Ssid; bssid = [string]$_.Bssid; dbm = [int]$_.NetworkRssiInDecibelMilliwatts; khz = [long]$_.ChannelCenterFrequencyInKilohertz; auth = [string]$_.SecuritySettings.NetworkAuthenticationType; enc = [string]$_.SecuritySettings.NetworkEncryptionType } }) } } } catch { $o.access = 'Error' }
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 4 -Compress))
`

export const channelOf = (mhz: number) => Math.round(mhz >= 5950 ? (mhz - 5950) / 5 : mhz >= 5000 ? (mhz - 5000) / 5 : mhz === 2484 ? 14 : (mhz - 2407) / 5)
export const bandOf = (mhz: number): WifiNet['band'] => (mhz >= 5925 ? '6' : mhz >= 4900 ? '5' : mhz >= 2400 ? '2.4' : null)
/** dBm → the 0–100 % Windows shows. */
export const percent = (dbm: number) => Math.max(0, Math.min(100, 2 * (dbm + 100)))

/** WinRT's NetworkAuthenticationType and NetworkEncryptionType names. */
export function winSecurity(auth: string, enc: string): WifiSecurity {
  if (/^(Open80211|None)$/i.test(auth)) return /wep/i.test(enc) ? 'wep' : 'open'
  if (/^SharedKey80211$/i.test(auth) || /wep/i.test(enc)) return 'wep'
  if (/^Wpa3Sae$/i.test(auth)) return 'wpa3'
  if (/^RsnaPsk$/i.test(auth)) return 'wpa2'
  if (/^(Rsna|Wpa3|Wpa3Enterprise.*)$/i.test(auth)) return 'enterprise'
  if (/^Wpa(Psk|None)?$/i.test(auth)) return 'wpa'
  return 'other'
}

/** nmcli's SECURITY ("WPA1 WPA2", "WPA3", "802.1X", "") and macOS's mode names: the weakest mode allowed. */
export function textSecurity(s: string): WifiSecurity {
  const v = s.toLowerCase()
  if (!v.trim() || /(^|_)none$/.test(v) || v === '--') return 'open'
  if (v.includes('wep')) return 'wep'
  if (v.includes('802.1x') || v.includes('enterprise')) return 'enterprise'
  // WPA1, plain "WPA" or macOS's wpa_personal(_mixed), but not WPA2/WPA3.
  if (/wpa1|wpa(?![23])/.test(v)) return 'wpa'
  if (v.includes('wpa2')) return 'wpa2'
  if (v.includes('wpa3')) return 'wpa3'
  return 'other'
}

type Base = Omit<WifiNet, 'vendor'>

export function parseWinScan(json: string): { access: string; nets: Base[] } {
  const o = JSON.parse(json || '{}') as { access?: string; nets?: { ssid: string; bssid: string; dbm: number; khz: number; auth: string; enc: string }[] }
  return {
    access: o.access ?? '',
    nets: list(o.nets).map((n) => ({
      ssid: n.ssid,
      bssid: normMac(n.bssid) || null,
      signal: percent(n.dbm),
      dbm: n.dbm,
      channel: channelOf(n.khz / 1000),
      band: bandOf(n.khz / 1000),
      security: winSecurity(n.auth, n.enc),
      tkip: /tkip/i.test(n.enc)
    }))
  }
}

/** `nmcli -t -f SSID,BSSID,FREQ,SIGNAL,SECURITY dev wifi list`: ':' separates, '\:' is a colon inside a field. */
export function parseNmcli(text: string): Base[] {
  return text
    .split(/\r?\n/)
    .filter(Boolean)
    .map((l) => l.split(/(?<!\\):/).map((f) => f.replace(/\\(.)/g, '$1')))
    .filter((f) => f.length >= 5)
    .map(([ssid, bssid, freq, signal, security]) => {
      const mhz = parseInt(freq, 10)
      return { ssid, bssid: normMac(bssid) || null, signal: Number(signal) || 0, dbm: null, channel: channelOf(mhz), band: bandOf(mhz), security: textSecurity(security), tkip: false }
    })
}

/** `system_profiler SPAirPortDataType -json`: networks nearby (macOS hides BSSIDs). */
export function parseAirport(json: string): Base[] {
  type Net = { _name?: string; spairport_network_channel?: string | number; spairport_security_mode?: string; spairport_signal_noise?: string }
  const data = JSON.parse(json || '{}') as { SPAirPortDataType?: { spairport_airport_interfaces?: { spairport_airport_other_local_wireless_networks?: Net[]; spairport_current_network_information?: Net }[] }[] }
  const ifaces = data.SPAirPortDataType?.flatMap((x) => x.spairport_airport_interfaces ?? []) ?? []
  return ifaces
    .flatMap((i) => [...(i.spairport_current_network_information ? [i.spairport_current_network_information] : []), ...(i.spairport_airport_other_local_wireless_networks ?? [])])
    .map((n) => {
      const ch = String(n.spairport_network_channel ?? '')
      const ghz = /\((\d)GHz/i.exec(ch)?.[1]
      const dbm = parseInt(/(-\d+)\s*dBm/.exec(n.spairport_signal_noise ?? '')?.[1] ?? '', 10)
      return {
        ssid: n._name ?? '',
        bssid: null,
        signal: Number.isNaN(dbm) ? 0 : percent(dbm),
        dbm: Number.isNaN(dbm) ? null : dbm,
        channel: parseInt(ch, 10) || null,
        band: ghz === '2' ? '2.4' : ghz === '5' ? '5' : ghz === '6' ? '6' : null,
        security: textSecurity(n.spairport_security_mode ?? ''),
        tkip: false
      }
    })
}

/** Nearby Wi-Fi networks, strongest first, with each access point's maker. Throws E_WIFI_ACCESS, E_NO_WIFI. */
export async function wifiScan(): Promise<WifiNet[]> {
  let nets: Base[]
  if (process.platform === 'win32') {
    const r = parseWinScan(await powershell(WIN, 30_000))
    if (r.access === 'DeniedBySystem' || r.access === 'DeniedByUser') throw new Error('E_WIFI_ACCESS')
    nets = r.nets
  } else if (process.platform === 'darwin') {
    nets = parseAirport(await tryRun('system_profiler', ['SPAirPortDataType', '-json'], 30_000))
  } else {
    nets = parseNmcli(await tryRun('nmcli', ['-t', '-f', 'SSID,BSSID,FREQ,SIGNAL,SECURITY', 'dev', 'wifi', 'list', '--rescan', 'auto'], 30_000))
  }
  if (!nets.length) throw new Error('E_NO_WIFI')
  const vendors = await vendorTable()
  return nets.map((n) => ({ ...n, vendor: n.bssid ? (vendors.get(n.bssid.slice(0, 8)) ?? null) : null })).sort((a, b) => b.signal - a.signal)
}
