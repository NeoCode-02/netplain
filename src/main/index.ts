import { app, BrowserWindow, dialog, ipcMain, nativeTheme, powerMonitor, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHANNELS, type Api } from '../shared/api'
import type { Release, Snapshot } from '../shared/types'
import { createAlerts } from './alerts'
import { collector } from './collectors'
import { join } from './connections'
import { cached, run } from './exec'
import { createGeo } from './geodb'
import { internetIp, realDevices, sweep } from './net'
import { allowCaptureLinux, createTrafficWatch } from './traffic'
import { vendorTable } from './tshark'
import { isSettings, loadSettings, normalize, saveSettings } from './settings'
import { autostart, setAutostart } from './autostart'
import { createTray } from './tray'
import { createUptime } from './uptime'
import { createMonitors } from './monitors'
import { createUsage } from './usage'
import { checkPort, diagnose, isHost, lookup, ping, publicIp, trace } from './tools'
import { elevate, flushDns, renewIp, restartAdapter, safeService, safeUser, serviceCommand, startupChange, userCommand, userGuard } from './admin'
import { createSecurity } from './security'
import { createScanner } from './defender'
import { checkRelease } from './update'
import { findCloudflared, installCloudflared } from './cloudflared'
import { createShare } from './share'
import type { ShareOptions } from '../shared/types'

// Separate data folder for tests / portable use.
if (process.env.NETPLAIN_DATA) app.setPath('userData', process.env.NETPLAIN_DATA)

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

const settingsFile = path.join(app.getPath('userData'), 'settings.json')
let settings = loadSettings(settingsFile)
nativeTheme.themeSource = settings.theme
const dataDir = path.join(app.getPath('userData'), 'data')

let win: BrowserWindow | null = null
let tray: ReturnType<typeof createTray> | null = null
/** Set once the app is really quitting, so closing the window no longer just hides it. */
let quitting = false
let latest: Snapshot | null = null
let problem: string | null = null
let release: Promise<Release | null> | undefined

const send = (channel: string, ...args: unknown[]) => {
  if (win && !win.isDestroyed()) win.webContents.send(channel, ...args)
}

function report(code: string | null) {
  if (code === problem) return
  problem = code
  send(CHANNELS.problem, code)
}

const geo = createGeo(path.join(app.getPath('userData'), 'geo'))
const icons = new Map<string, string | null>()
/** Program files seen running this session: the only paths the UI may ask an icon for. */
const knownPaths = new Set<string>()
const freshProcesses = async () => {
  const list = await collector.processes()
  for (const p of list) if (p.path) knownPaths.add(p.path)
  return list
}
// The process list costs ~0.4 s on Windows (PowerShell start), the DNS cache ~1 s.
const processes = cached(5000, freshProcesses, [])
const dnsNames = cached(30_000, async () => new Map(await collector.dnsCache()), new Map<string, string>())

// Capture files live only while the app runs; anything left by a crash goes now.
const captureDir = path.join(app.getPath('userData'), 'capture')
if (primary) fs.rmSync(captureDir, { recursive: true, force: true })

const usage = createUsage(path.join(dataDir, 'usage'))
if (primary) usage.prune()
const alerts = createAlerts(dataDir, (a) => send(CHANNELS.alert, a))
alerts.setOwnBlocklist(settings.blocklist)

const traffic = primary
  ? createTrafficWatch(
      {
        collector,
        processes,
        freshProcesses,
        hosts: dnsNames,
        geo: geo.lookup,
        publish: (t) => {
          send(CHANNELS.traffic, t)
          usage.apps(t)
        },
        dir: captureDir,
        plaintext: (app, target) => alerts.plaintext(settings.alerts, app, target)
      },
      settings.capture
    )
  : null

async function currentConnections() {
  const [sockets, procs, hosts] = await Promise.all([collector.sockets(), processes(), dnsNames()])
  return join(sockets, procs, hosts, geo.lookup)
}

const security =
  process.platform === 'win32'
    ? createSecurity({
        online: async () => (await currentConnections()).conns.filter((c) => c.scope === 'internet').map((c) => ({ app: c.title ?? c.app, path: c.path })),
        dns: () => latest?.adapters.find((a) => a.id === latest?.defaultId)?.dns ?? [],
        geo: geo.lookup
      })
    : null
const binDir = path.join(app.getPath('userData'), 'bin')
const share = createShare({
  cloudflared: () => findCloudflared(binDir),
  knownHosts: path.join(app.getPath('userData'), 'known_hosts'),
  country: (ip) => geo.lookup(ip).country,
  push: (s) => send(CHANNELS.share, s)
})

// After a scan the threat list and the last-scan dates change.
const scanner = createScanner(() => void security?.get(true).catch(console.error))

const monitors = primary ? createMonitors(dataDir, (e, target) => alerts.monitor(settings.alerts, e, target)) : null
const uptime = primary ? createUptime({ dir: dataDir, snapshot: () => latest, on: () => settings.uptime, onEnd: (o) => alerts.outage(settings.alerts, o) }) : null

if (primary) {
  setInterval(() => {
    usage.save()
    uptime?.save()
    monitors?.save()
  }, 60_000)
  // Signals are checked in the background, whichever page is open.
  setInterval(() => currentConnections().then((c) => alerts.connections(c, settings.alerts), console.error), Number(process.env.NETPLAIN_CHECK_MS) || 15_000)
  // The first security reading takes ~10 s (file signatures); have it ready before the page is opened.
  setTimeout(() => security?.get().catch(console.error), 15_000)
}

const stopWatch = primary
  ? collector.watch(
      async (adapters) => {
        const ip = await internetIp()
        const internet = ip ? adapters.find((a) => a.ipv4.some((c) => c.split('/')[0] === ip)) : undefined
        const prev = latest
        latest = { at: Date.now(), adapters: adapters.filter((a) => a.kind !== 'loopback'), defaultId: internet?.id ?? null }
        // The tray tooltip: speed of the adapter the internet goes through.
        const now = latest.adapters.find((a) => a.id === latest?.defaultId)
        const was = prev?.adapters.find((a) => a.id === now?.id)
        const dt = prev ? (latest.at - prev.at) / 1000 : 0
        if (now && was && dt > 0) tray?.rate((Math.max(0, now.rx - was.rx) * 8) / dt, (Math.max(0, now.tx - was.tx) * 8) / dt)
        report(null)
        send(CHANNELS.snapshot, latest)
        traffic?.follow(latest)
        usage.adapters(latest)
      },
      (e) => {
        console.error(e)
        report('E_COLLECT')
      }
    )
  : () => {}

async function devices() {
  const [list, vendors] = await Promise.all([collector.neighbors(), vendorTable()])
  return realDevices(list).map((n) => ({ ...n, vendor: vendors.get(n.mac.slice(0, 8)) ?? null }))
}

const overlay = () => ({ color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#a1a4ab' : '#3f4148', height: 48 })
const rendererFile = pathToFileURL(path.join(__dirname, '../renderer/index.html')).href

/** `hidden`: started at login, so it waits in the tray until opened. */
function createWindow(hidden = false) {
  win = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 960,
    minHeight: 620,
    show: false,
    title: 'Netplain',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#0f1113' : '#f6f7f7',
    titleBarStyle: 'hidden',
    titleBarOverlay: overlay(),
    trafficLightPosition: { x: 16, y: 17 },
    webPreferences: { preload: path.join(__dirname, '../preload/index.js'), sandbox: true, contextIsolation: true }
  })
  win.once('ready-to-show', () => !hidden && win?.show())
  // Closing hides the window to the tray, so watching, history and alerts go on.
  win.on('close', (e) => {
    if (quitting || !settings.background || !tray) return
    e.preventDefault()
    win?.hide()
    const told = path.join(app.getPath('userData'), 'tray-told')
    if (!fs.existsSync(told)) {
      fs.writeFileSync(told, '')
      tray.tellHidden()
    }
  })
  // Logging off or shutting down Windows must not be held up by a window that only hides.
  win.on('query-session-end', () => (quitting = true))
  win.on('session-end', () => (quitting = true))
  // Links never open inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (process.env.ELECTRON_RENDERER_URL) void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void win.loadFile(path.join(__dirname, '../renderer/index.html'))
}

nativeTheme.on('updated', () => {
  if (win && process.platform !== 'darwin') win.setTitleBarOverlay(overlay())
})

const handlers: Api = {
  appInfo: () => ({ version: app.getVersion(), platform: process.platform }),
  update: () => (settings.updates ? (release ??= checkRelease(app.getVersion()).catch(() => null)) : Promise.resolve(null)),
  getSettings: () => ({ ...settings, autostart: autostart() }),
  saveSettings: (s) => {
    const before = settings
    settings = normalize(s)
    nativeTheme.themeSource = settings.theme
    saveSettings(settingsFile, settings)
    if (settings.capture !== before.capture) {
      traffic?.setEnabled(settings.capture, latest)
      tray?.refresh()
    }
    if (settings.blocklist !== before.blocklist) alerts.setOwnBlocklist(settings.blocklist)
    if (settings.autostart !== autostart()) setAutostart(settings.autostart)
    if (before.uptime && !settings.uptime) uptime?.pause()
  },
  uptime: () => uptime?.view() ?? { on: false, now: null, points: [], outages: [] },
  monitors: () => monitors?.list() ?? [],
  addMonitor: (kind, target, every) => monitors!.add(kind, target, every),
  removeMonitor: (id) => monitors!.remove(id),
  checkMonitor: (id) => monitors!.checkNow(id),
  showWindow: () => show(),
  uiLang: (lang) => tray?.setLang(lang),
  snapshot: () => latest,
  neighbors: devices,
  scan: async () => {
    const ip = await internetIp()
    if (!ip) throw new Error('E_OFFLINE')
    await sweep(ip)
    return devices()
  },
  openUrl: (url) => void shell.openExternal(url),
  connections: currentConnections,
  appIcon: async (file) => {
    if (!icons.has(file))
      icons.set(
        file,
        await app.getFileIcon(file, { size: 'normal' }).then(
          (i) => i.toDataURL(),
          () => null
        )
      )
    return icons.get(file) ?? null
  },
  geoInfo: () => geo.info(),
  geoUpdate: () => geo.update(),
  traffic: () => traffic?.view() ?? null,
  retryCapture: () => traffic?.setEnabled(settings.capture, latest),
  allowCapture: () => allowCaptureLinux(),
  packets: (session, after) => traffic?.packets(session, after) ?? { session: 0, rows: [] },
  packetDetail: (n) => traffic!.detail(n),
  packetFilter: (expr) => traffic!.filter(expr),
  savePackets: async () => {
    const copy = traffic!.snapshotFile()
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')
    const r = await dialog.showSaveDialog(win!, { defaultPath: `netplain-${stamp}.pcapng`, filters: [{ name: 'pcapng', extensions: ['pcapng'] }] })
    if (r.canceled || !r.filePath) return false
    fs.copyFileSync(copy, r.filePath)
    return true
  },
  openInWireshark: () => traffic!.openInWireshark(traffic!.snapshotFile()),
  usage: (range) => usage.query(range),
  alerts: () => alerts.list(),
  markAlertsRead: () => alerts.markRead(),
  clearAlerts: () => alerts.clear(),
  blocklistInfo: () => alerts.blocklistInfo(),
  updateFirehol: () => alerts.updateFirehol(),
  removeFirehol: () => alerts.removeFirehol(),
  ping: (host) => ping(host),
  trace: (host) => trace(host, geo.lookup),
  lookup: (name) => lookup(name, geo.lookup),
  checkPort: (host, port) => checkPort(host, port),
  publicIp: () => publicIp(geo.lookup),
  diagnose: () => diagnose(latest),
  flushDns: () => flushDns(),
  renewIp: (id) => renewIp(adapter(id)),
  restartAdapter: (id) => restartAdapter(adapter(id)),
  security: (fresh) => {
    if (!security) throw new Error('E_UNSUPPORTED')
    return security.get(fresh)
  },
  scanState: () => scanner.state(),
  startScan: (kind, admin) => scanner.start(kind, admin),
  updateDefinitions: () => scanner.updateDefinitions(),
  removeThreats: () => scanner.removeThreats(),
  setStartup: async (id, on) => {
    const e = (await security!.get()).startup.find((x) => x.id === id)
    if (!e) throw new Error('E_BAD_ARGS')
    const change = startupChange(e, on)
    // Your own entries switch without admin rights; others ask through UAC.
    const done = change.direct ? await run(...change.direct).then(() => true, () => false) : false
    if (!done) await elevate(change.line)
    await security!.get(true)
  },
  setService: async (name, action) => {
    if (!(await security!.get()).services.some((x) => x.name === name)) throw new Error('E_BAD_ARGS')
    await elevate(serviceCommand(name, action))
    await security!.get(true)
  },
  setUser: async (name, action) => {
    const sec = await security!.get()
    const refused = userGuard(sec.users, name, action)
    if (refused) throw new Error(refused)
    await elevate(userCommand(name, action))
    await security!.get(true)
  },
  shareState: () => share.state(),
  shareStart: (o) => share.start(o),
  shareStop: () => share.stop(),
  shareRequests: (after) => share.requests(after),
  shareRequest: (id) => share.request(id),
  shareReplay: (id) => share.replay(id),
  installCloudflared: async () => {
    await installCloudflared(binDir)
    await share.state()
  },
  fixFinding: async (fix) => {
    if (fix === 'openDefender') return void shell.openExternal('windowsdefender:')
    await elevate('netsh advfirewall set allprofiles state on')
  }
}

function show() {
  if (!win || win.isDestroyed()) return createWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
}

function adapter(id: string) {
  const a = latest?.adapters.find((x) => x.id === id)
  if (!a) throw new Error('E_BAD_ARGS')
  return a
}

const none = (a: unknown[]) => a.length === 0
const isShare = (v: unknown): v is ShareOptions => {
  const o = v as ShareOptions
  return typeof v === 'object' && v !== null && Number.isInteger(o.port) && o.port > 0 && o.port < 65536 && typeof o.https === 'boolean' && ['cloudflare', 'ssh'].includes(o.provider) && typeof o.password === 'boolean'
}
const int = (v: unknown) => Number.isSafeInteger(v) && (v as number) >= 0
const httpsUrl = (v: unknown) => {
  try {
    return typeof v === 'string' && v.length < 2048 && new URL(v).protocol === 'https:'
  } catch {
    return false
  }
}
const ARGS: Record<keyof Api, (a: unknown[]) => boolean> = {
  appInfo: none,
  update: none,
  getSettings: none,
  saveSettings: (a) => isSettings(a[0]),
  showWindow: none,
  uiLang: (a) => a[0] === 'en' || a[0] === 'uz',
  uptime: none,
  monitors: none,
  addMonitor: (a) => ['http', 'tcp', 'ping'].includes(a[0] as string) && typeof a[1] === 'string' && a[1].length <= 2048 && (a[2] === 60 || a[2] === 300),
  removeMonitor: (a) => typeof a[0] === 'string' && a[0].length <= 64,
  checkMonitor: (a) => typeof a[0] === 'string' && a[0].length <= 64,
  snapshot: none,
  neighbors: none,
  scan: none,
  openUrl: (a) => httpsUrl(a[0]),
  connections: none,
  appIcon: (a) => typeof a[0] === 'string' && knownPaths.has(a[0]),
  geoInfo: none,
  geoUpdate: none,
  traffic: none,
  retryCapture: none,
  allowCapture: none,
  packets: (a) => int(a[0]) && int(a[1]),
  packetDetail: (a) => int(a[0]) && (a[0] as number) > 0,
  packetFilter: (a) => typeof a[0] === 'string' && a[0].trim().length > 0 && a[0].length <= 2000,
  savePackets: none,
  openInWireshark: none,
  usage: (a) => a[0] === 'day' || a[0] === 'week' || a[0] === 'month',
  alerts: none,
  markAlertsRead: none,
  clearAlerts: none,
  blocklistInfo: none,
  updateFirehol: none,
  removeFirehol: none,
  ping: (a) => isHost(a[0]),
  trace: (a) => isHost(a[0]),
  lookup: (a) => isHost(a[0]),
  checkPort: (a) => isHost(a[0]) && int(a[1]) && (a[1] as number) >= 1 && (a[1] as number) <= 65535,
  publicIp: none,
  diagnose: none,
  flushDns: none,
  renewIp: (a) => typeof a[0] === 'string' && a[0].length <= 200,
  restartAdapter: (a) => typeof a[0] === 'string' && a[0].length <= 200,
  security: (a) => a[0] === undefined || typeof a[0] === 'boolean',
  fixFinding: (a) => a[0] === 'firewallOn' || a[0] === 'openDefender',
  scanState: none,
  startScan: (a) => (a[0] === 'quick' || a[0] === 'full') && typeof a[1] === 'boolean',
  updateDefinitions: none,
  removeThreats: none,
  setStartup: (a) => typeof a[0] === 'string' && a[0].length <= 1000 && typeof a[1] === 'boolean',
  setService: (a) => typeof a[0] === 'string' && safeService(a[0]) && ['start', 'stop', 'auto', 'manual', 'disabled'].includes(a[1] as string),
  setUser: (a) => typeof a[0] === 'string' && safeUser(a[0]) && (a[1] === 'disable' || a[1] === 'enable' || a[1] === 'unadmin'),
  shareState: none,
  shareStart: (a) => isShare(a[0]),
  shareStop: none,
  shareRequests: (a) => int(a[0]),
  shareRequest: (a) => int(a[0]),
  shareReplay: (a) => int(a[0]),
  installCloudflared: none
}

/** Only our own window's page may call the main process. */
function trusted(e: IpcMainInvokeEvent): boolean {
  if (!win || e.sender !== win.webContents) return false
  const url = e.senderFrame?.url ?? ''
  const dev = process.env.ELECTRON_RENDERER_URL
  if (dev) {
    try {
      return new URL(url).origin === new URL(dev).origin
    } catch {
      return false
    }
  }
  return url.split(/[?#]/)[0] === rendererFile
}

for (const [key, fn] of Object.entries(handlers)) {
  const check = ARGS[key as keyof Api]
  ipcMain.handle(key, (e, ...args: unknown[]) => {
    if (!trusted(e) || !check(args)) throw new Error('E_BAD_ARGS')
    return (fn as (...a: unknown[]) => unknown)(...args)
  })
}

app.on('second-instance', show)
// macOS: clicking the Dock icon brings the hidden window back.
app.on('activate', show)

if (primary)
  void app.whenReady().then(() => {
    try {
      tray = createTray({ show, quit: () => app.quit(), capture: () => settings.capture, setCapture: (on) => handlers.saveSettings({ ...settings, autostart: autostart(), capture: on }) })
    } catch (e) {
      console.error(e)
    }
    // Started at login: stay in the tray (only when there is one to come back from).
    createWindow(process.argv.includes('--hidden') && tray !== null)
    powerMonitor.on('shutdown', () => (quitting = true))
    // Sleep is not a connection drop.
    powerMonitor.on('suspend', () => uptime?.pause())
    powerMonitor.on('resume', () => uptime?.resume())
  })
app.on('before-quit', () => {
  quitting = true
  stopWatch()
  traffic?.stop()
  share.stop()
  uptime?.stop()
  monitors?.stop()
  usage.save()
})
app.on('window-all-closed', () => app.quit())
