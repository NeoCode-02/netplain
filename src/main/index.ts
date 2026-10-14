import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHANNELS, type Api } from '../shared/api'
import type { Snapshot } from '../shared/types'
import { createAlerts } from './alerts'
import { collector } from './collectors'
import { join } from './connections'
import { cached } from './exec'
import { createGeo } from './geodb'
import { internetIp, realDevices, sweep } from './net'
import { allowCaptureLinux, createTrafficWatch } from './traffic'
import { vendorTable } from './tshark'
import { isSettings, loadSettings, saveSettings } from './settings'
import { createUsage } from './usage'

// Separate data folder for tests / portable use.
if (process.env.NETPLAIN_DATA) app.setPath('userData', process.env.NETPLAIN_DATA)

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

const settingsFile = path.join(app.getPath('userData'), 'settings.json')
let settings = loadSettings(settingsFile)
nativeTheme.themeSource = settings.theme
const dataDir = path.join(app.getPath('userData'), 'data')

let win: BrowserWindow | null = null
let latest: Snapshot | null = null
let problem: string | null = null

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

if (primary) {
  setInterval(() => usage.save(), 60_000)
  // Signals are checked in the background, whichever page is open.
  setInterval(() => currentConnections().then((c) => alerts.connections(c, settings.alerts), console.error), Number(process.env.NETPLAIN_CHECK_MS) || 15_000)
}

const stopWatch = primary
  ? collector.watch(
      async (adapters) => {
        const ip = await internetIp()
        const internet = ip ? adapters.find((a) => a.ipv4.some((c) => c.split('/')[0] === ip)) : undefined
        latest = { at: Date.now(), adapters: adapters.filter((a) => a.kind !== 'loopback'), defaultId: internet?.id ?? null }
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

function createWindow() {
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
  win.once('ready-to-show', () => win?.show())
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
  getSettings: () => settings,
  saveSettings: (s) => {
    const before = settings
    settings = { theme: s.theme, capture: s.capture, alerts: { ...s.alerts }, blocklist: s.blocklist }
    nativeTheme.themeSource = settings.theme
    saveSettings(settingsFile, settings)
    if (settings.capture !== before.capture) traffic?.setEnabled(settings.capture, latest)
    if (settings.blocklist !== before.blocklist) alerts.setOwnBlocklist(settings.blocklist)
  },
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
  removeFirehol: () => alerts.removeFirehol()
}

const none = (a: unknown[]) => a.length === 0
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
  getSettings: none,
  saveSettings: (a) => isSettings(a[0]),
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
  removeFirehol: none
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

app.on('second-instance', () => {
  if (!win) return
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
})

if (primary) void app.whenReady().then(createWindow)
app.on('before-quit', () => {
  stopWatch()
  traffic?.stop()
  usage.save()
})
app.on('window-all-closed', () => app.quit())
