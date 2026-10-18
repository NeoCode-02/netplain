// The e2e harness: starts the built app on a fresh data folder and drives its window over the Chrome
// DevTools Protocol (its main process over the inspector). The steps are in run.mjs.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { LOGIN, pcap } from './pcap.ts'

export const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
export const shots = path.join(root, 'e2e', 'shots')
fs.mkdirSync(shots, { recursive: true })
export const data = fs.mkdtempSync(path.join(os.tmpdir(), 'netplain-e2e-'))

if (process.env.E2E_GEO_FROM) fs.cpSync(process.env.E2E_GEO_FROM, path.join(data, 'geo'), { recursive: true })
const pcapFile = path.join(data, 'login.pcap')
fs.writeFileSync(pcapFile, pcap([LOGIN]))

const require_ = (await import('node:module')).createRequire(import.meta.url)
const electron = require_('electron')
// --inspect opens the main process too (unpacked Electron only), for what the page cannot do, such as a real window close.
const args = [root, '--remote-debugging-port=0', '--inspect=0', ...(process.platform === 'linux' && process.env.CI ? ['--no-sandbox'] : [])]
export const app = spawn(electron, args, { env: { ...process.env, NETPLAIN_DATA: data, NETPLAIN_CHECK_MS: '2000', NETPLAIN_LAN_MS: '3000' }, stdio: ['ignore', 'pipe', 'pipe'] })
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
export async function inMain(expr) {
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

// Native Open and Save dialogs cannot be driven: the main process gets its answers from this test
// (the capture file below; saved files land in the test's data folder under their suggested names).
await inMain(`(() => {
  const { dialog } = process.mainModule.require('electron')
  const path = process.mainModule.require('path')
  dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [${JSON.stringify(pcapFile)}] })
  dialog.showSaveDialog = async (_win, o) => ({ canceled: false, filePath: path.join(${JSON.stringify(data)}, o.defaultPath) })
  return true
})()`)
/** A file the app saved into the data folder, by name pattern (waits up to 30 s). */
export async function saved(pattern) {
  const end = Date.now() + 30_000
  for (;;) {
    const name = fs.readdirSync(data).find((n) => pattern.test(n))
    if (name) return path.join(data, name)
    if (Date.now() > end) throw new Error(`Timed out waiting for a saved ${pattern}`)
    await new Promise((r) => setTimeout(r, 300))
  }
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

export async function inPage(fn, ...a) {
  const r = await cdp('Runtime.evaluate', { expression: `(${fn})(...${JSON.stringify(a)})`, awaitPromise: true, returnByValue: true })
  if (r.result?.exceptionDetails) throw new Error(r.result.exceptionDetails.exception?.description ?? 'page error')
  return r.result?.result?.value
}

/** `what` is a label, or [label, ms] for a longer wait than 30 s. */
export async function until(what, fn, ...a) {
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

export async function shot(name) {
  if (docs) await inPage(scrub, docs)
  const r = await cdp('Page.captureScreenshot', { format: 'png' })
  fs.writeFileSync(path.join(shots, `${name}.png`), Buffer.from(r.result.data, 'base64'))
}

export const clickText = (text) => {
  // Navigation items also carry a badge, so their label is matched on its own.
  const el = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === text || b.querySelector('.label')?.textContent.trim() === text)
  if (!el || el.disabled) return false
  el.click()
  return true
}
export const hasText = (text) => document.body.innerText.includes(text)

export const step = async (name, fn) => {
  process.stdout.write(`• ${name} … `)
  await fn()
  process.stdout.write('ok\n')
}

/** Sets a form field from outside the way React notices: the browser's own value setter, then its event. */
export const setInput = (selector, value, index = 0) =>
  inPage(
    (sel, v, i) => {
      const found = document.querySelectorAll(sel)[i]
      const el = found.matches('input, select') ? found : found.querySelector('input, select')
      const select = el.tagName === 'SELECT'
      Object.getOwnPropertyDescriptor((select ? HTMLSelectElement : HTMLInputElement).prototype, 'value').set.call(el, v)
      el.dispatchEvent(new Event(select ? 'change' : 'input', { bubbles: true }))
      return true
    },
    selector,
    String(value),
    index
  )

/** Runs the steps; whatever happens, closes the app and removes its data folder. Exits with 1 on a failure. */
export async function run(steps) {
  let failed = false
  try {
    await steps()
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
}
