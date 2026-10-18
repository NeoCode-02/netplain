// End-to-end check of the built app (`npm run e2e`): the real Electron app on this machine's real
// network, driven over the Chrome DevTools Protocol. No test framework, no extra packages.
// Screenshots of every page in light and dark land in e2e/shots/.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const shots = path.join(root, 'e2e', 'shots')
fs.mkdirSync(shots, { recursive: true })
const data = fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-e2e-'))

/** A capture file with one HTTP request carrying a Basic login (Ethernet/IPv4/TCP, classic pcap). */
function loginPcap() {
  const payload = Buffer.from('GET /admin HTTP/1.1\r\nHost: cam.example\r\nAuthorization: Basic YWRtaW46c2VjcmV0\r\n\r\n')
  const ip = Buffer.alloc(20)
  ip[0] = 0x45
  ip.writeUInt16BE(40 + payload.length, 2)
  ip[8] = 64
  ip[9] = 6
  Buffer.from([192, 168, 1, 10, 203, 0, 113, 80]).copy(ip, 12)
  const tcp = Buffer.alloc(20)
  tcp.writeUInt16BE(50000, 0)
  tcp.writeUInt16BE(80, 2)
  tcp.writeUInt32BE(1, 4)
  tcp.writeUInt32BE(1, 8)
  tcp[12] = 0x50
  tcp[13] = 0x18
  tcp.writeUInt16BE(65535, 14)
  const frame = Buffer.concat([Buffer.from([2, 0, 0x5e, 0, 0, 1, 2, 0, 0x5e, 0, 0, 2, 8, 0]), ip, tcp, payload])
  const head = Buffer.alloc(24)
  head.writeUInt32LE(0xa1b2c3d4, 0)
  head.writeUInt16LE(2, 4)
  head.writeUInt16LE(4, 6)
  head.writeUInt32LE(65535, 16)
  head.writeUInt32LE(1, 20)
  const rec = Buffer.alloc(16)
  rec.writeUInt32LE(1_760_000_000, 0)
  rec.writeUInt32LE(frame.length, 8)
  rec.writeUInt32LE(frame.length, 12)
  return Buffer.concat([head, rec, frame])
}
const pcapFile = path.join(data, 'login.pcap')
fs.writeFileSync(pcapFile, loginPcap())

const require_ = (await import('node:module')).createRequire(import.meta.url)
const electron = require_('electron')
// --inspect opens the main process too (unpacked Electron only), for what the page cannot do, such as a real window close.
const args = [root, '--remote-debugging-port=0', '--inspect=0', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])]
const app = spawn(electron, args, { env: { ...process.env, NETPLAIN_DATA: data, NETPLAIN_CHECK_MS: '2000', NETPLAIN_LAN_MS: '3000', NETPLAIN_PCAP: pcapFile, NETPLAIN_REPORT: path.join(data, 'report.pdf') }, stdio: ['ignore', 'pipe', 'pipe'] })
let appLog = ''
app.stdout.on('data', (d) => (appLog += d))
const devtools = await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error(`The app did not start:\n${appLog}`)), 30_000)
  app.stderr.on('data', (d) => {
    appLog += d
    const m = /DevTools listening on (ws:\/\/[^\s]+)/.exec(appLog)
    if (m) {
      clearTimeout(timer)
      resolve(m[1])
    }
  })
  app.on('exit', (code) => reject(new Error(`The app exited (${code}):\n${appLog}`)))
})

const inspector = /Debugger listening on (ws:\/\/[^\s]+)/.exec(appLog)?.[1]

/** Evaluates `expr` in the app's main process (`process.mainModule.require('electron')` reaches Electron). */
async function inMain(expr) {
  if (!inspector) throw new Error('the main process has no inspector')
  const ws = new WebSocket(inspector)
  await new Promise((resolve, reject) => (ws.addEventListener('open', resolve), ws.addEventListener('error', reject)))
  const r = await new Promise((resolve) => {
    ws.addEventListener('message', (m) => {
      const d = JSON.parse(m.data)
      if (d.id === 1) resolve(d)
    })
    ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: expr, awaitPromise: true, returnByValue: true } }))
  })
  ws.close()
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'main process error')
  return r.result?.result?.value
}

const port = new URL(devtools).port
let page
for (let i = 0; i < 50 && !page; i++) {
  page = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()).find((t) => t.type === 'page')
  if (!page) await new Promise((r) => setTimeout(r, 200))
}
const socket = new WebSocket(page.webSocketDebuggerUrl)
await new Promise((r) => socket.addEventListener('open', r))
let seq = 0
const pending = new Map()
const consoleErrors = []
socket.addEventListener('message', (m) => {
  const d = JSON.parse(m.data)
  if (d.id && pending.has(d.id)) pending.get(d.id)(d)
  if (d.method === 'Runtime.exceptionThrown') consoleErrors.push(d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text)
  if (d.method === 'Runtime.consoleAPICalled' && d.params.type === 'error') consoleErrors.push(d.params.args.map((a) => a.value ?? a.description).join(' '))
})
let gone = null
const cdp = (method, params = {}) =>
  new Promise((resolve, reject) => {
    if (gone) return reject(gone)
    pending.set(++seq, (d) => (d instanceof Error ? reject(d) : resolve(d)))
    socket.send(JSON.stringify({ id: seq, method, params }))
  })
// The page went away (the app quit or crashed): fail with its output instead of waiting forever.
socket.addEventListener('close', () => {
  gone = new Error(`The app closed the page. Its output:\n${appLog.slice(-3000)}`)
  for (const f of pending.values()) f(gone)
  pending.clear()
})
await cdp('Runtime.enable')

async function inPage(fn, ...a) {
  const r = await cdp('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
  return r.result?.result?.value
}

/** `what` is a label, or [label, ms] for a longer wait than 30 s. */
async function until(what, fn, ...a) {
  const [label, ms] = Array.isArray(what) ? what : [what, 30_000]
  const end = Date.now() + ms
  for (;;) {
    const v = await inPage(fn, ...a).catch(() => undefined)
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${label}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

// E2E_DOCS=1: screenshots for the README, with this machine's names and hardware addresses replaced.
const docs = process.env.E2E_DOCS ? [[`\\Users\\${os.userInfo().username}\\`, '\\Users\\you\\'], [os.hostname(), 'MY-PC']] : null
const scrub = async (pairs) => {
  const snap = await window.netplain.snapshot()
  for (const a of snap?.adapters ?? []) if (a.wifi?.ssid) pairs.push([a.wifi.ssid, 'Home Wi-Fi'])
  const fake = (window.__macs ??= new Map())
  // Twice: the second pass also hides the MACs inside the packet hex dump, learnt in the first.
  for (let pass = 0; pass < 2; pass++) {
    const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT)
    for (let n; (n = walk.nextNode()); ) {
      let v = n.nodeValue
      for (const [a, b] of pairs) v = v.split(a).join(b)
      v = v.replace(/\b([0-9a-f]{2}[:-]){5}[0-9a-f]{2}\b/gi, (m) => {
        if (m.startsWith('02:00:5e:00:00:')) return m
        if (!fake.has(m.toLowerCase())) fake.set(m.toLowerCase(), `02:00:5e:00:00:${String(fake.size + 1).padStart(2, '0')}`)
        return fake.get(m.toLowerCase())
      }).replace(/\{[0-9a-f]{8}(-[0-9a-f]{4}){3}-[0-9a-f]{12}\}/gi, '{…}')
      for (const [real, f] of fake) v = v.split(real.replace(/[:-]/g, ' ')).join(f.replace(/:/g, ' '))
      if (v !== n.nodeValue) n.nodeValue = v
    }
  }
  return true
}

async function shot(name) {
  if (docs) await inPage(scrub, docs)
  const r = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

const clickText = (text) => {
  // Navigation items also carry a badge, so their label is matched on its own.
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.querySelector('.label')?.textContent.trim() === text)
  if (!el || el.disabled) return false
  el.click()
  return true
}
const hasText = (text) => document.body.innerText.includes(text)

const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `)
  await fn()
  process.stdout.write('ok\n')
}

let failed = false
try {
  await until('the app', () => document.querySelector('.rail') !== null)
  // Language is switched in Settings, like a person would (the system language decides the first one).
  await until('Settings', () => {
    const b = document.querySelector('.rail-foot button')
    b?.click()
    return b !== null
  })
  await until('English', clickText, 'English')
  // The sidebar in groups, each page with a one-line hint.
  await until('the sidebar groups', () => document.querySelectorAll('.rail-group').length === 5 && [...document.querySelectorAll('.rail-item')].every((b) => b.title))

  for (const theme of ['Light', 'Dark']) {
    await step(`${theme.toLowerCase()} theme`, async () => {
      await until('Settings', clickText, 'Settings')
      await until(theme, clickText, theme)
      await new Promise((r) => setTimeout(r, 300))
      await shot(`settings-${theme.toLowerCase()}`)
    })

    await step(`overview (${theme.toLowerCase()})`, async () => {
      await until('Overview', clickText, 'Overview')
      await until('the story', () => document.querySelectorAll('.story li').length >= 1)
      // A fresh install shows the getting-started list (shot in light), hidden for good with one click.
      if (theme === 'Light') await until('the getting-started list', () => document.querySelectorAll('.setup-row').length === 4)
      await new Promise((r) => setTimeout(r, 3000))
      await shot(`overview-${theme.toLowerCase()}`)
      if (theme === 'Light') {
        await until('Hide this list', clickText, 'Hide this list')
        await until('the list gone', () => document.querySelector('.setup') === null)
      }
    })

    await step(`network page (${theme.toLowerCase()})`, async () => {
      await until('Network', clickText, 'Network')
      // Either the internet adapter's card or the offline sentence, once data arrived.
      await until('adapter data', () => document.querySelector('.internet') !== null || document.body.innerText.includes('No adapter can reach'))
      // A few seconds of history so the chart has a line.
      await new Promise((r) => setTimeout(r, 4000))
      await until('a chart line', () => !document.querySelector('.internet') || document.querySelector('.internet .series.down') !== null)
      await shot(`network-${theme.toLowerCase()}`)
    })

    await step(`devices page (${theme.toLowerCase()})`, async () => {
      await until('Devices', clickText, 'Devices')
      await until('device list', () => document.querySelector('.dev-row, .empty') !== null)
      // With only the router known, the page says how to find the rest.
      const seen = await inPage(() => document.querySelectorAll('.dev-row').length)
      if (seen > 0 && seen <= 2) await until('the scan hint', () => document.querySelector('.devices-hint button') !== null)
      await shot(`devices-${theme.toLowerCase()}`)
    })

    await step(`connections page (${theme.toLowerCase()})`, async () => {
      await until('Connections', clickText, 'Connections')
      await until('connection data', () => document.querySelector('.page-title p')?.textContent !== 'Reading connections…' && document.querySelector('.ad-row, .list-empty') !== null)
      // Without the location database (fresh data folder) the page offers to download it.
      await until('the location banner', () => document.querySelector('.geo-banner') !== null)
      await inPage(() => document.querySelector('.ad-toggle')?.click())
      await shot(`connections-${theme.toLowerCase()}`)
      await inPage(() => document.querySelector('.content').scrollTo(0, 1e6))
      await shot(`connections-ports-${theme.toLowerCase()}`)
      await inPage(() => document.querySelector('.content').scrollTo(0, 0))
    })
  }

  await step('apps page', async () => {
    await until('Apps', clickText, 'Apps')
    // With Wireshark installed the list fills; without it the page explains how to get it.
    await until('traffic, or why there is none', () => document.querySelector('.ad-row, .empty') !== null || /Watching\.|Starting to watch/.test(document.body.innerText))
    // Watching is on by default; "off" here meant a missing Wireshark was reported as switched off.
    if (await inPage(hasText, 'Traffic watching is off')) throw new Error('Apps says watching is off although it is on')
    await shot('apps')
  })

  await step('packets page', async () => {
    await until('Packets', clickText, 'Packets')
    const watching = await until('packets or the Wireshark hint', () => (document.querySelector('.pk-body .pk-row') ? 'yes' : document.querySelector('.empty') ? 'no' : false))
    if (watching === 'yes') {
      await inPage(() => document.querySelector('.pk-body .pk-row').click())
      await until('packet details', () => document.querySelectorAll('.pk-layer').length >= 2)
      const setFilter = (v) => {
        const el = document.querySelector('.pk-filter input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        document.querySelector('.pk-filter button[type=submit]').click()
        return true
      }
      await inPage(setFilter, 'tcp.port ==')
      await until('the filter error', hasText, 'Wireshark did not understand the filter')
      await inPage(setFilter, 'ip')
      await until('filter matches', hasText, 'packets match the filter')
      // Opt-in, because it opens a Wireshark window (closed again right away): E2E_WIRESHARK=1 (Windows)
      if (process.env.E2E_WIRESHARK) {
        await until('Open in Wireshark', clickText, 'Open in Wireshark')
        const { execSync } = await import('node:child_process')
        const running = () => execSync('tasklist /fi "imagename eq Wireshark.exe" /nh').toString().includes('Wireshark.exe')
        const end = Date.now() + 20_000
        while (!running() && Date.now() < end) await new Promise((r) => setTimeout(r, 500))
        if (!running()) throw new Error('Wireshark did not open')
        execSync('taskkill /im Wireshark.exe /f')
      }
    }
    await shot('packets')
  })

  // A capture file needs only Wireshark's engine (the e2e file stands in for the native Open dialog).
  await step('capture file report', async () => {
    const offered = await until('the Open button or the Wireshark hint', () => (document.querySelector('.page-actions, .pk-head .row') ? [...document.querySelectorAll('button')].some((b) => b.textContent === 'Open a file…') ? 'yes' : 'no' : false))
    if (offered !== 'yes') return
    await until('Open a file…', clickText, 'Open a file…')
    await until('the report', () => /1 login was sent readable/.test(document.body.innerText) && document.body.innerText.includes('HTTP basic auth, user “admin”'))
    if (await inPage(() => document.body.innerText.includes('c2VjcmV0') || document.body.innerText.includes('secret'))) throw new Error('the password is on screen')
    await until('cam.example', hasText, 'cam.example')
    await shot('packets-file')
    await until('Back to live packets', clickText, 'Back to live packets')
  })

  // Opt-in, because it downloads 5 MB from Cloudflare's speed test: E2E_TRAFFIC=1 npm run e2e
  if (process.env.E2E_TRAFFIC)
    await step('traffic is counted per app', async () => {
      await until('Apps', clickText, 'Apps')
      const curl = spawn('curl', ['-s', '-o', process.platform === 'win32' ? 'NUL' : '/dev/null', 'https://speed.cloudflare.com/__down?bytes=5000000'])
      await new Promise((r) => curl.on('exit', r))
      const mb = await until('curl in the list', () => {
        const row = [...document.querySelectorAll('.ad-row')].find((r) => /curl/i.test(r.querySelector('h3')?.textContent ?? ''))
        const text = row?.querySelector('.app-bytes span')?.textContent ?? ''
        const m = /([\d.]+)\s*MB/.exec(text)
        return m && Number(m[1]) >= 4.5 ? Number(m[1]) : false
      })
      process.stdout.write(`(curl: ${mb} MB received) `)
      if (mb > 5.6) throw new Error(`curl counted ${mb} MB for a 5 MB download`)
      await shot('apps-traffic')
    })

  // Opt-in, because it downloads ~9 MB from db-ip.com: E2E_GEO=1 npm run e2e
  if (process.env.E2E_GEO)
    await step('location database', async () => {
      await until('Connections', clickText, 'Connections')
      await until('download button', clickText, 'Download (≈9 MB)')
      await until('companies on connections', () => document.querySelector('.geo-banner') === null && document.querySelector('.orgs .tag') !== null)
      await shot('connections-geo')
    })

  await step('history page', async () => {
    await until('History', clickText, 'History')
    await until('history data', () => document.querySelector('.rate-plot, .list-empty') !== null)
    // Earlier days show without a click; a fresh profile has no autostart, so the gaps hint is up.
    const picked = (want) => document.querySelector('.page-tabs [aria-selected="true"]')?.textContent === want
    await until('opens on 7 days', picked, '7 days')
    await until('gaps hint', hasText, 'days it was off stay empty')
    await shot('history')
    // The period picked is kept for the next visit.
    await until('Today', clickText, 'Today')
    await until('Overview', clickText, 'Overview')
    await until('History', clickText, 'History')
    await until('still Today', picked, 'Today')
    await until('7 days', clickText, '7 days')
  })

  await step('an open port raises an alert', async () => {
    // After the first check has recorded the baseline, a new port open to the network is news.
    const deadline = Date.now() + 20_000
    while (!fs.existsSync(path.join(data, 'data', 'seen.json')) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
    const net = await import('node:net')
    const server = net.createServer()
    await new Promise((r) => server.listen(0, '0.0.0.0', r))
    try {
      await until('Alerts', clickText, 'Alerts')
      await until('the alert', () => /opened port \d+ to the network/.test(document.body.innerText) && document.querySelector('.rail .badge') !== null)
      await shot('alerts')
    } finally {
      server.close()
    }
  })

  await step('home network watch', async () => {
    // The first check records the proxy and, on a network with a router, its devices, router and DNS.
    const file = path.join(data, 'data', 'lan.json')
    const deadline = Date.now() + 20_000
    while (!fs.existsSync(file) && Date.now() < deadline) await new Promise((r) => setTimeout(r, 300))
    const lan = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (typeof lan.proxy !== 'string') throw new Error(`no proxy recorded: ${JSON.stringify(lan).slice(0, 200)}`)
    const gateway = await inPage(async () => {
      const s = await window.netplain.snapshot()
      return s?.adapters.find((a) => a.id === s.defaultId)?.gateway ?? null
    })
    if (gateway && !Object.keys(lan.nets).some((k) => k.endsWith(`|${gateway}`))) throw new Error(`the network was not recorded: ${Object.keys(lan.nets)}`)
    await until('the new alert kinds', hasText, 'Router address taken over')
  })

  // Only a program this test started is stopped.
  await step('who holds a port, and stopping it', async () => {
    const child = spawn(process.execPath, ['-e', "require('net').createServer().listen(0, '127.0.0.1', function () { console.log(this.address().port) }); setTimeout(() => {}, 120000)"], { stdio: ['ignore', 'pipe', 'ignore'] })
    const port = await new Promise((r) => child.stdout.once('data', (d) => r(String(d).trim())))
    const exited = new Promise((r) => child.once('exit', () => r(true)))
    try {
      await until('Connections', clickText, 'Connections')
      await inPage((v) => {
        const el = document.querySelector('.search input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      }, port)
      const row = (p) => [...document.querySelectorAll('.port-row')].find((r) => r.querySelector('.port')?.textContent === p)
      const stop = `(${row})`
      await until('its row with a Stop button', (p, f) => !!eval(f)(p)?.querySelector('.block-button button'), port, stop)
      await inPage((p, f) => eval(f)(p).querySelector('.block-button button').click(), port, stop)
      await until('asks first', (p, f) => eval(f)(p)?.textContent.includes('Click again to stop'), port, stop)
      await inPage((p, f) => eval(f)(p).querySelector('.block-button button').click(), port, stop)
      const gone = await Promise.race([exited, new Promise((r) => setTimeout(() => r(false), 15_000))])
      if (!gone) throw new Error('the program was not stopped')
    } finally {
      child.kill()
      await inPage(() => {
        const el = document.querySelector('.search input')
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '')
        el.dispatchEvent(new Event('input', { bubbles: true }))
        return true
      })
    }
  })

  await step('security status', async () => {
    await until('Security', clickText, 'Security')
    // Windows reads its settings (~10 s the first time); elsewhere the page says it is Windows-only.
    const end = Date.now() + 90_000
    while (!(await inPage(() => document.querySelector('.verdict') !== null || document.body.innerText.includes('works on Windows')))) {
      if (Date.now() > end) throw new Error('Timed out waiting for: the security verdict')
      await new Promise((r) => setTimeout(r, 500))
    }
    await shot('security')
    if (await inPage(() => document.querySelector('.verdict') !== null)) {
      // The report goes to the e2e folder's file instead of the native Save dialog.
      const pdf = path.join(data, 'report.pdf')
      await until('Report (PDF)', clickText, 'Report (PDF)')
      const end = Date.now() + 30_000
      while (!fs.existsSync(pdf) && Date.now() < end) await new Promise((r) => setTimeout(r, 300))
      if (!fs.existsSync(pdf) || fs.readFileSync(pdf).subarray(0, 5).toString() !== '%PDF-') throw new Error('no PDF report')
      fs.copyFileSync(pdf, path.join(shots, 'security-report.pdf'))
      await until('Antivirus tab', clickText, 'Antivirus')
      await until('defender cards', () => document.querySelectorAll('.kpi').length === 4)
      await shot('security-antivirus')
      await until('Users tab', clickText, 'Users')
      await until('the accounts', () => [...document.querySelectorAll('.tag')].some((t) => t.textContent === 'You'))
      await shot('security-users')
      await until('Services tab', clickText, 'Services')
      await until('the services', () => document.querySelectorAll('.svc-row').length > 0)
      await shot('security-services')
      await until('Startup tab', clickText, 'Startup')
      await until('startup entries', () => document.querySelectorAll('.list-row.finding').length > 0 || document.body.innerText.includes('Nothing starts by itself'))
      await shot('security-startup')
    }
  })

  await step('seen from the internet', async () => {
    await until('From the internet tab', clickText, 'From the internet')
    await until('the check button', hasText, 'Shodan’s InternetDB')
    // Sends this network's public address to Shodan's InternetDB, so only when asked for.
    if (process.env.E2E_EXPOSURE) {
      await until('Check', clickText, 'Check')
      await until(['the result', 30_000], () => document.body.innerText.includes('Ports your router opened') || document.querySelector('.note.danger') !== null)
      await shot('security-exposure')
    }
  })

  // Reads the firewall and arms a block button once; the second click (UAC, a real rule) never happens here.
  if (process.platform === 'win32')
    await step('firewall block asks first', async () => {
      await until('Blocked tab', clickText, 'Blocked')
      await until('the rules', () => document.querySelector('.empty, .list') !== null)
      if (await inPage(() => document.querySelector('.note.danger') !== null)) throw new Error('reading the firewall failed')
      await shot('security-blocked')
      await until('Connections', clickText, 'Connections')
      await until('a group', () => document.querySelector('.ad-toggle') !== null)
      const armed = await inPage(async () => {
        for (const g of document.querySelectorAll('.ad-toggle')) {
          if (g.getAttribute('aria-expanded') !== 'true') g.click()
          await new Promise((r) => setTimeout(r, 150))
          const b = document.querySelector('.block-button button')
          if (b) {
            b.focus()
            b.click()
            return true
          }
        }
        return false
      })
      if (armed) {
        await until('asks first', hasText, 'Click again to block')
        await shot('connections-block')
        await until('back to idle by itself', () => !document.body.innerText.includes('Click again to block'))
      }
    })

  await step('tools page', async () => {
    await until('Tools', clickText, 'Tools')
    await until('Check', clickText, 'Check')
    await until('the diagnosis', () => document.querySelectorAll('.steps-list li').length === 5)
    const ask = (i, host) => {
      const form = document.querySelectorAll('.tool-form')[i]
      const input = form.querySelector('input')
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, host)
      input.dispatchEvent(new Event('input', { bubbles: true }))
      setTimeout(() => form.querySelector('button[type=submit]').click(), 50)
      return true
    }
    await inPage(ask, 0, '127.0.0.1')
    await until('ping result', hasText, 'answered')
    await inPage(ask, 1, 'localhost')
    await until('lookup result', hasText, 'Answered in')
    await inPage(ask, 2, '127.0.0.1')
    await until('port result', () => /Open:|Closed:|No answer:/.test(document.body.innerText))
    await inPage(ask, 3, '127.0.0.1')
    // Some Linux systems have neither traceroute nor tracepath; the page then says what to install.
    await until('route', () => document.querySelectorAll('.hops li').length >= 1 || document.body.innerText.includes('No route tool on this computer'))
    if (process.env.E2E_FIXES) {
      await until('Clear DNS cache', () => {
        const row = [...document.querySelectorAll('.list-row')].find((r) => r.textContent.includes('Clear DNS cache'))
        row?.querySelector('button').click()
        return !!row
      })
      await until('the fix result', hasText, 'Clear DNS cache: Done.')
    }
    await shot('tools')
  })

  const fill = (i, v) => {
    const el = document.querySelectorAll('.tool-form input')[i]
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
    el.dispatchEvent(new Event('input', { bubbles: true }))
    return true
  }

  await step('subnet calculator', async () => {
    await until('Subnet', clickText, 'Subnet')
    await inPage(fill, 0, '10.1.2.3/8')
    await until('the network', hasText, '10.0.0.0/8')
    await inPage(fill, 1, '10.200.0.1')
    await until('the inside answer', hasText, 'Inside')
    await shot('tools-subnet')
  })

  // Reading only: every change goes through the admin prompt.
  await step('hosts file', async () => {
    await until('Hosts file', clickText, 'Hosts file')
    await until('the entries', () => /\d+ entr(y|ies)|No entries/.test(document.body.innerText) && document.querySelector('.note.danger') === null)
    await shot('tools-hosts')
  })

  await step('port scanner', async () => {
    // A device's Ports button opens the scanner on that address and starts it (CI runners may list no device).
    await until('Devices', clickText, 'Devices')
    await until('device list', () => document.querySelector('.dev-row, .empty') !== null)
    const ip = await inPage(() => {
      const row = document.querySelector('.dev-row')
      row?.querySelector('button').click()
      return row?.querySelector('.mono').textContent ?? null
    })
    if (ip) {
      await until('the scanner on that device', (v) => document.querySelector('[role=tab][aria-selected=true]')?.textContent === 'Port scan' && document.querySelector('.tool-form input')?.value === v, ip)
      await until('its scan', (v) => document.body.innerText.includes(`on ${v}`), ip)
    } else {
      await until('Tools', clickText, 'Tools')
      await until('Port scan', clickText, 'Port scan')
    }
    const net = await import('node:net')
    const greeter = net.createServer((c) => c.end('SSH-2.0-E2E\r\n'))
    await new Promise((r) => greeter.listen(0, '127.0.0.1', r))
    try {
      await inPage(fill, 0, '127.0.0.1')
      await until('Custom', clickText, 'Custom')
      await inPage(fill, 1, `${greeter.address().port}, 1-50`)
      await until('Scan', clickText, 'Scan')
      await until('the open port and what it said', hasText, 'SSH-2.0-E2E')
      await until('the end of the scan', () => /open ports? on 127\.0\.0\.1/.test(document.body.innerText))
      await shot('tools-scan')
    } finally {
      greeter.close()
    }
  })

  await step('dns records', async () => {
    await until('DNS', clickText, 'DNS')
    await until('TXT', clickText, 'TXT')
    await inPage(fill, 0, 'example.com')
    await until('Look up', clickText, 'Look up')
    // Four servers answer (or say they can't), and TXT also explains the domain's mail rules.
    await until('four server rows', () => document.querySelectorAll('.list .list-row').length === 4)
    await until('the mail section', hasText, 'E-mail protection')
    await shot('tools-dns')
  })

  await step('whois', async () => {
    await until('Whois', clickText, 'Whois')
    await inPage(fill, 0, 'example.com')
    await until('Look up', clickText, 'Look up')
    // The registry answers through rdap.org; if it is down the page says so instead.
    await until('the registration or a reason', () => document.body.innerText.includes('Registered') || document.querySelector('.note.danger') !== null)
    await shot('tools-whois')
  })

  await step('website check', async () => {
    const http = await import('node:http')
    const site = http.createServer((q, r) => (q.url === '/' ? r.writeHead(301, { location: '/home' }).end() : r.writeHead(200, { 'x-content-type-options': 'nosniff', server: 'E2E' }).end('hi')))
    await new Promise((r) => site.listen(0, '127.0.0.1', r))
    try {
      await until('Website', clickText, 'Website')
      await inPage(fill, 0, `http://127.0.0.1:${site.address().port}/`)
      await until('Check', clickText, 'Check')
      await until('the redirect and the verdicts', () => document.querySelectorAll('.hops li').length === 2 && document.body.innerText.includes('1 of 6 protective headers'))
      await until('the plain-http warning', hasText, 'No encryption')
      await shot('tools-web')
    } finally {
      site.close()
    }
  })

  await step('speed test', async () => {
    await until('Speed', clickText, 'Speed')
    await until('the start button', hasText, 'Start test')
    // E2E_SPEED=1: a real test (about 20 s, and a lot of data).
    if (process.env.E2E_SPEED) {
      await until('Start test', clickText, 'Start test')
      await until(['the verdicts', 60_000], () => document.querySelectorAll('.verdicts li').length >= 2 && !document.body.innerText.includes('Measuring'))
      await shot('tools-speed')
    }
  })

  await step('wi-fi around', async () => {
    await until('Wi-Fi', clickText, 'Wi-Fi')
    // CI runners have no Wi-Fi: then the page says so.
    await until('the networks or a reason', () => document.querySelector('.chan-chart') !== null || document.querySelector('.note.danger') !== null)
    await shot('tools-wifi')
  })

  await step('share page', async () => {
    // A site running here is found by itself and offered by its page title.
    const http = await import('node:http')
    const site = http.createServer((_q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<title>Netplain e2e shop</title>'))
    await new Promise((r) => site.listen(0, '127.0.0.1', r))
    try {
      await until('Share', clickText, 'Share')
      await until('the steps', () => document.querySelectorAll('.share-steps li').length === 3)
      await until('the running site', () => {
        const card = [...document.querySelectorAll('.site-card')].find((c) => c.textContent.includes('Netplain e2e shop'))
        card?.click()
        return card?.getAttribute('aria-checked') === 'true'
      })
      await until('the share button names it', () => document.querySelector('.share-go .btn.primary')?.textContent.includes('Netplain e2e shop'))
      await shot('share')
    } finally {
      site.close()
    }
  })

  // Opt-in, because it opens a public link: E2E_SHARE=ssh (localhost.run) or E2E_SHARE=cloudflare
  // (downloads cloudflared, ~55 MB, the first time). A local page is shared and fetched through the link.
  if (process.env.E2E_SHARE)
    await step(`sharing over ${process.env.E2E_SHARE}`, async () => {
      const http = await import('node:http')
      const site = http.createServer((_q, r) => r.end('hello from netplain e2e'))
      await new Promise((r) => site.listen(0, '127.0.0.1', r))
      try {
        const setPort = (p) => {
          const el = document.querySelector('.share-port')
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, String(p))
          el.dispatchEvent(new Event('input', { bubbles: true }))
          return true
        }
        await inPage(setPort, site.address().port)
        const provider = process.env.E2E_SHARE === 'cloudflare' ? 'Cloudflare' : 'localhost.run'
        await until(provider, clickText, provider)
        // Cloudflare's connector is downloaded by the Share button itself the first time.
        await until('the Share button', () => {
          const b = document.querySelector('.share-go .btn.primary')
          if (!b || b.disabled) return false
          b.click()
          return true
        })
        const url = await until(['the public link', 300_000], () => document.querySelector('.share-url')?.textContent || document.querySelector('.note.danger')?.textContent.replace(/^/, 'ERROR '))
        if (url.startsWith('ERROR')) throw new Error(url)
        const login = await inPage(() => [...document.querySelectorAll('.share-login .tag')].map((t) => t.textContent.split(': ')[1]))
        const auth = `Basic ${Buffer.from(login.join(':')).toString('base64')}`
        // A new tunnel's name takes a few seconds to resolve everywhere.
        let body = ''
        for (let i = 0; i < 20 && body !== 'hello from netplain e2e'; i++) {
          await new Promise((r) => setTimeout(r, 2000))
          body = await fetch(url, { headers: { authorization: auth } }).then(
            (r) => r.text(),
            (e) => `(${e.cause?.code ?? e.message})`
          )
        }
        if (body !== 'hello from netplain e2e') throw new Error(`${url} answered: ${body.slice(0, 200)}`)
        if ((await fetch(url).then((r) => r.status)) !== 401) throw new Error('the link opened without the password')
        await until('the visit in the list', () => document.querySelectorAll('.share-row').length >= 2)
        process.stdout.write(`(${url}) `)
        await inPage(() => [...document.querySelectorAll('.share-row')].find((r) => r.textContent.includes('200'))?.click())
        await until('the visit details', () => document.querySelectorAll('.share-pre').length === 4)
        await shot('share-live')
        await until('Stop sharing', clickText, 'Stop sharing')
        await until('the form again', () => document.querySelector('.share-port') !== null)
      } finally {
        site.close()
      }
    })

  // Late in the run, so a few minutes of checks are there to draw.
  await step('uptime page', async () => {
    await until('Uptime', clickText, 'Uptime')
    await until('the latest check', () => {
      const v = [...document.querySelectorAll('.uptime-tile strong')].map((s) => s.textContent)
      // Internet answers on a runner and here; the router may ignore checks.
      return v.length === 3 && /\d+ ms/.test(v[1]) && v[0] !== '—' ? v : false
    })
    if (await inPage(hasText, 'No internet since')) throw new Error('the internet looks down, while the tests reach it')
    await until(['the response-time chart', 120_000], () => document.querySelector('.rate-plot .series.down')?.getAttribute('d')?.includes('L') ?? false)
    await shot('uptime')
  })

  await step('watched sites and servers', async () => {
    const http = await import('node:http')
    const site = http.createServer((_q, r) => r.end('ok'))
    await new Promise((r) => site.listen(0, '127.0.0.1', r))
    const setField = (sel, v) => {
      const el = document.querySelector(sel)
      const select = el.tagName === 'SELECT'
      Object.getOwnPropertyDescriptor((select ? HTMLSelectElement : HTMLInputElement).prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }))
      return true
    }
    const watch = async (kind, target) => {
      await inPage(setField, '.monitor-form select', kind)
      await inPage(setField, '.monitor-form input', target)
      await inPage(() => (document.querySelector('.monitor-form button[type=submit]').click(), true))
    }
    try {
      await watch('tcp', 'no-port-here')
      await until('the address error', hasText, 'Check the address')
      const url = `http://127.0.0.1:${site.address().port}/`
      await watch('http', url)
      await until('the local site up', (u) => [...document.querySelectorAll('.monitor-row')].some((r) => r.textContent.includes(u) && / ms/.test(r.textContent) && r.querySelector('.tag.ok')), url)
      // A real https site: its certificate is read too.
      await watch('http', 'https://one.one.one.one')
      await until('the certificate', () => /certificate: \d+ days left/.test(document.body.innerText))
      await shot('monitors')
      await until('both removed', () => {
        const b = document.querySelector('.monitor-row button[aria-label="Stop watching"]:not(:disabled)')
        b?.click()
        return document.body.innerText.includes('Nothing watched yet')
      })
    } finally {
      site.close()
    }
  })

  await step('monthly data limit', async () => {
    await until('Settings', clickText, 'Settings')
    await until('the limit form', () => document.querySelector('.cap-form') !== null)
    const setField = (i, v) => {
      const el = document.querySelectorAll('.cap-form input')[i]
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event('input', { bubbles: true }))
      return true
    }
    await inPage(setField, 0, '0.5')
    await inPage(setField, 1, '1')
    await until('Save', clickText, 'Save')
    await until('saved', hasText, 'Saved.')
    await until('History', clickText, 'History')
    await until('the limit meter', () => document.querySelector('.meter[role=meter]') !== null && /of 500 MB used/.test(document.body.innerText))
    await shot('history-limit')
    await until('Settings', clickText, 'Settings')
    await until('Remove limit', clickText, 'Remove limit')
    await until('History', clickText, 'History')
    await until('no meter', () => document.querySelector('.rate-plot, .list-empty') !== null && document.querySelector('.meter[role=meter]') === null)
  })

  await step('running in the background', async () => {
    await until('Settings', clickText, 'Settings')
    await until('the background switches', () => document.querySelectorAll('.switch').length >= 4)
    await shot('settings-background')
    // Linux keeps the old behaviour by default (not every desktop shows a tray icon).
    if (process.platform !== 'linux') {
      // As the title bar's ✕ does (the page's own window.close() skips the window's close event).
      await inMain("process.mainModule.require('electron').BrowserWindow.getAllWindows()[0].close()")
      await until('the window to hide', () => document.visibilityState === 'hidden')
      if (app.exitCode !== null) throw new Error('closing the window quit the app')
      if (!fs.existsSync(path.join(data, 'tray-told'))) throw new Error('the first close did not explain the tray')
      await inPage(() => window.netplain.showWindow().then(() => true))
      await until('the window to come back', () => document.visibilityState === 'visible')
    }
    // Only on CI runners: it writes the login items of the machine it runs on.
    if (process.env.CI) {
      const { execSync } = await import('node:child_process')
      const registered = () =>
        process.platform === 'win32'
          ? execSync('reg query HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run')
              .toString()
              .split('\n')
              .some((l) => l.includes('--hidden') && l.toLowerCase().includes(root.toLowerCase()))
          : fs.existsSync(path.join(os.homedir(), '.config', 'autostart', 'netplain.desktop'))
      const flip = (label) => {
        const b = document.querySelector(`.switch[aria-label="${label}"]`)
        b.click()
        return b.getAttribute('aria-checked')
      }
      const label = process.platform === 'win32' ? 'Start with Windows' : 'Start at login'
      await inPage(flip, label)
      await until('the switch on', () => document.querySelector('.switch[aria-checked="true"][aria-label^="Start"]') !== null)
      if (!registered()) throw new Error('start at login was not registered')
      await inPage(flip, label)
      await until('the switch off', () => document.querySelector('.switch[aria-checked="false"][aria-label^="Start"]') !== null)
      if (registered()) throw new Error('start at login was not removed')
    }
  })

  await step('Uzbek', async () => {
    await until('Settings', clickText, 'Settings')
    await until('O‘zbekcha', clickText, 'O‘zbekcha')
    await until('Uzbek navigation', hasText, 'Qurilmalar')
    await until('Tarmoq', clickText, 'Tarmoq')
    await until('adapter data', () => document.querySelector('.internet') !== null || document.body.innerText.includes('internetga chiqa olmayapti'))
    await shot('network-uz')
  })

  if (consoleErrors.length) throw new Error(`Console errors:\n${consoleErrors.join('\n')}`)
} catch (e) {
  failed = true
  console.error(`\n${e.message}`)
  if (gone) console.error(gone.message)
  await shot('failure').catch(() => {})
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=E2E::${e.message.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')}`)
} finally {
  socket.close()
  if (app.exitCode === null && app.signalCode === null) {
    const exited = new Promise((r) => app.once('exit', r))
    app.kill()
    await exited
  }
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
if (failed) process.exit(1)
if (docs) {
  const dir = path.join(root, 'docs')
  fs.mkdirSync(dir, { recursive: true })
  for (const n of ['overview-dark', 'apps-traffic', 'connections-geo', 'packets', 'security'])
    if (fs.existsSync(path.join(shots, `${n}.png`))) fs.copyFileSync(path.join(shots, `${n}.png`), path.join(dir, `${n}.png`))
}
console.log(`e2e passed; screenshots in ${path.relative(root, shots)}`)
