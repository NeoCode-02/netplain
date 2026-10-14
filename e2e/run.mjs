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

const require_ = (await import('node:module')).createRequire(import.meta.url)
const electron = require_('electron')
const args = [root, '--remote-debugging-port=0', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])]
const app = spawn(electron, args, { env: { ...process.env, NETPLAIN_DATA: data, NETPLAIN_CHECK_MS: '2000' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
const cdp = (method, params = {}) => new Promise((r) => (pending.set(++seq, r), socket.send(JSON.stringify({ id: seq, method, params }))))
await cdp('Runtime.enable')

async function inPage(fn, ...a) {
  const r = await cdp('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
  return r.result?.result?.value
}

async function until(what, fn, ...a) {
  const end = Date.now() + 30_000
  for (;;) {
    const v = await inPage(fn, ...a).catch(() => undefined)
    if (v) return v
    if (Date.now() > end) throw new Error(`Timed out waiting for: ${what}`)
    await new Promise((r) => setTimeout(r, 200))
  }
}

async function shot(name) {
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

  for (const theme of ['Light', 'Dark']) {
    await step(`${theme.toLowerCase()} theme`, async () => {
      await until('Settings', clickText, 'Settings')
      await until(theme, clickText, theme)
      await new Promise((r) => setTimeout(r, 300))
      await shot(`settings-${theme.toLowerCase()}`)
    })

    await step(`overview (${theme.toLowerCase()})`, async () => {
      await until('Overview', clickText, 'Overview')
      await until('the story', () => document.querySelectorAll('.story li').length >= 2)
      await new Promise((r) => setTimeout(r, 3000))
      await shot(`overview-${theme.toLowerCase()}`)
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
      await shot(`devices-${theme.toLowerCase()}`)
    })

    await step(`connections page (${theme.toLowerCase()})`, async () => {
      await until('Connections', clickText, 'Connections')
      await until('connection data', () => document.querySelector('.page-head p')?.textContent !== 'Reading connections…' && document.querySelector('.ad-row, .list-empty') !== null)
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
    await until('traffic or the Wireshark hint', () => document.querySelector('.ad-row') !== null || document.body.innerText.includes('Get Wireshark'))
    await shot('apps')
  })

  await step('packets page', async () => {
    await until('Packets', clickText, 'Packets')
    const watching = await until('packets or the Wireshark hint', () => (document.querySelector('.pk-body .pk-row') ? 'yes' : document.body.innerText.includes('Get Wireshark') ? 'no' : false))
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

  // Opt-in, because it downloads 5 MB from Cloudflare's speed test: E2E_TRAFFIC=1 npm run e2e
  if (process.env.E2E_TRAFFIC)
    await step('traffic is counted per app', async () => {
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
    await shot('history')
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
      await until('Antivirus tab', clickText, 'Antivirus')
      await until('defender cards', () => document.querySelectorAll('.kpi').length === 4)
      await shot('security-antivirus')
      await until('Users tab', clickText, 'Users')
      await until('the accounts', () => [...document.querySelectorAll('.tag')].some((t) => t.textContent === 'You'))
      await shot('security-users')
      await until('Services tab', clickText, 'Services')
      await until('the services', () => document.querySelectorAll('.svc-row').length > 0)
      await shot('security-services')
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
    await until('route', () => document.querySelectorAll('.hops li').length >= 1)
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
  await shot('failure').catch(() => {})
  if (process.env.GITHUB_ACTIONS) console.log(`::error title=E2E::${e.message.replace(/%/g, '%25').replace(/\r/g, '').replace(/\n/g, '%0A')}`)
} finally {
  socket.close()
  const exited = new Promise((r) => app.once('exit', r))
  app.kill()
  await exited
  fs.rmSync(data, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 })
}
if (failed) process.exit(1)
console.log(`e2e passed; screenshots in ${path.relative(root, shots)}`)
