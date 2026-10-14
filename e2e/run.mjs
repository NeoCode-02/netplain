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
const app = spawn(electron, args, { env: { ...process.env, NETPLAIN_DATA: data }, stdio: ['ignore', 'pipe', 'pipe'] })
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
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text)
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

  // Opt-in, because it downloads ~9 MB from db-ip.com: E2E_GEO=1 npm run e2e
  if (process.env.E2E_GEO)
    await step('location database', async () => {
      await until('download button', clickText, 'Download (≈9 MB)')
      await until('companies on connections', () => document.querySelector('.geo-banner') === null && document.querySelector('.orgs .tag') !== null)
      await shot('connections-geo')
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
