import { app, BrowserWindow, ipcMain, nativeTheme, shell, type IpcMainInvokeEvent } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { CHANNELS, type Api } from '../shared/api'
import type { Settings, Snapshot } from '../shared/types'
import { collector } from './collectors'
import { join } from './connections'
import { cached } from './exec'
import { createGeo } from './geodb'
import { internetIp, realDevices, sweep } from './net'
import { vendorTable } from './tshark'

// Separate data folder for tests / portable use.
if (process.env.NETPLAIN_DATA) app.setPath('userData', process.env.NETPLAIN_DATA)

const primary = app.requestSingleInstanceLock()
if (!primary) app.quit()

const THEMES: readonly Settings['theme'][] = ['system', 'light', 'dark']
const isSettings = (v: unknown): v is Settings =>
  typeof v === 'object' && v !== null && Object.getPrototypeOf(v) === Object.prototype && THEMES.includes((v as Settings).theme)

const settingsFile = path.join(app.getPath('userData'), 'settings.json')
function loadSettings(): Settings {
  try {
    const s: unknown = JSON.parse(fs.readFileSync(settingsFile, 'utf8'))
    if (isSettings(s)) return { theme: s.theme }
  } catch {
    // first run or unreadable: defaults
  }
  return { theme: 'system' }
}

let settings = loadSettings()
nativeTheme.themeSource = settings.theme

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

const stopWatch = primary
  ? collector.watch(
      async (adapters) => {
        const ip = await internetIp()
        const internet = ip ? adapters.find((a) => a.ipv4.some((c) => c.split('/')[0] === ip)) : undefined
        latest = { at: Date.now(), adapters: adapters.filter((a) => a.kind !== 'loopback'), defaultId: internet?.id ?? null }
        report(null)
        send(CHANNELS.snapshot, latest)
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

const geo = createGeo(path.join(app.getPath('userData'), 'geo'))
// The process list costs ~0.4 s on Windows (PowerShell start), the DNS cache ~1 s.
const processes = cached(5000, () => collector.processes(), [])
const dnsNames = cached(30_000, async () => new Map(await collector.dnsCache()), new Map<string, string>())
const icons = new Map<string, string | null>()
let knownPaths = new Set<string>()

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
    settings = { theme: s.theme }
    nativeTheme.themeSource = settings.theme
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true })
    fs.writeFileSync(settingsFile, JSON.stringify(settings, null, 2))
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
  connections: async () => {
    const [sockets, procs, hosts] = await Promise.all([collector.sockets(), processes(), dnsNames()])
    knownPaths = new Set(procs.flatMap((p) => (p.path ? [p.path] : [])))
    return join(sockets, procs, hosts, geo.lookup)
  },
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
  geoUpdate: () => geo.update()
}

const none = (a: unknown[]) => a.length === 0
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
  geoUpdate: none
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
app.on('before-quit', () => stopWatch())
app.on('window-all-closed', () => app.quit())
