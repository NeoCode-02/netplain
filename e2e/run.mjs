// End-to-end check of the built app (`npm run e2e`): the real Electron app on this machine's real
// network, driven over the Chrome DevTools Protocol. No test framework, no extra packages.
// Screenshots of every page in light and dark land in e2e/shots/.
import { spawn } from 'node:child_process'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { app, clickText, data, hasText, inMain, inPage, root, run, saved, setInput, shot, shots, step, until } from './lib.mjs'

await run(async () => {
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
      if (!process.env.E2E_GEO_FROM) await until('the location banner', () => document.querySelector('.geo-banner') !== null)
      await inPage(() => document.querySelector('.ad-toggle')?.click())
      await shot(`connections-${theme.toLowerCase()}`)
      await inPage(() => document.querySelector('.content').scrollTo(0, 1e6))
      await shot(`connections-ports-${theme.toLowerCase()}`)
      await inPage(() => document.querySelector('.content').scrollTo(0, 0))
    })

    await step(`map (${theme.toLowerCase()})`, async () => {
      await until('Map', clickText, 'Map')
      await until('the world', () => document.querySelectorAll('.world .land').length >= 150)
      // Countries show once the location database is there; without it the page offers it, like Connections.
      await until('countries or the location banner', () => document.querySelector('.map-row, .geo-banner') !== null)
      await shot(`map-${theme.toLowerCase()}`)
      // Opt-in: a traceroute takes up to a minute and needs the internet: E2E_TRACE=1
      if (process.env.E2E_TRACE && theme === 'Light' && (await inPage(() => document.querySelector('.map-row') !== null))) {
        await inPage(() => (document.querySelector('.map-row').click(), true))
        await until('Show route', clickText, 'Show route')
        await until(['the route', 120_000], () => document.querySelectorAll('.map-stops li').length > 0 || document.querySelector('.note.danger') !== null)
        await shot('map-route')
      }
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
      const filter = async (v) => {
        await setInput('.pk-filter input', v)
        await inPage(() => (document.querySelector('.pk-filter button[type=submit]').click(), true))
      }
      await filter('tcp.port ==')
      await until('the filter error', hasText, 'Wireshark did not understand the filter')
      await filter('ip')
      await until('filter matches', hasText, 'packets match the filter')
      await until('Save (.pcapng)', clickText, 'Save (.pcapng)')
      await saved(/^netplain-[\d-]+\.pcapng$/)
      await until('saved', hasText, 'Saved')
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
    const offered = await until('the Open button or the Wireshark hint', () => (document.querySelector('.page-head, .pk-head') ? ([...document.querySelectorAll('button')].some((b) => b.textContent === 'Open a file…') ? 'yes' : 'no') : false))
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
      await setInput('.search input', port)
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
      await setInput('.search input', '')
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
      await until('Report (PDF)', clickText, 'Report (PDF)')
      const pdf = await saved(/^netplain-report-.*\.pdf$/)
      await new Promise((r) => setTimeout(r, 300))
      if (fs.readFileSync(pdf).subarray(0, 5).toString() !== '%PDF-') throw new Error('no PDF report')
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
    // Outside Windows it is the only tab, so there is no tab bar to click.
    await inPage(clickText, 'From the internet')
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
      // The Apps page offers the same for a program with traffic (when Wireshark watches it).
      await until('Apps', clickText, 'Apps')
      const offered = await inPage(async () => {
        for (const g of document.querySelectorAll('.ad-toggle')) {
          if (g.getAttribute('aria-expanded') !== 'true') g.click()
          await new Promise((r) => setTimeout(r, 150))
          if ([...document.querySelectorAll('.block-button button')].some((b) => b.textContent === 'Cut off from the internet')) return 'yes'
        }
        return document.querySelector('.ad-toggle') ? 'no' : 'no apps'
      })
      if (offered === 'no') throw new Error('no block button on the Apps page')
      process.stdout.write(`(apps: ${offered}) `)
    })

  await step('tools page', async () => {
    await until('Tools', clickText, 'Tools')
    await until('Check', clickText, 'Check')
    await until('the diagnosis', () => document.querySelectorAll('.steps-list li').length === 5)
    const ask = async (i, host) => {
      await setInput('.tool-form', host, i)
      await inPage((n) => (document.querySelectorAll('.tool-form')[n].querySelector('button[type=submit]').click(), true), i)
    }
    await ask(0, '127.0.0.1')
    await until('ping result', hasText, 'answered')
    await ask(1, 'localhost')
    await until('lookup result', hasText, 'Answered in')
    await ask(2, '127.0.0.1')
    await until('port result', () => /Open:|Closed:|No answer:/.test(document.body.innerText))
    await ask(3, '127.0.0.1')
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

  const fill = (i, v) => setInput('.tool-form input', v, i)

  await step('subnet calculator', async () => {
    await until('Subnet', clickText, 'Subnet')
    await fill(0, '10.1.2.3/8')
    await until('the network', hasText, '10.0.0.0/8')
    await fill(1, '10.200.0.1')
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
      await fill(0, '127.0.0.1')
      await until('Custom', clickText, 'Custom')
      await fill(1, `${greeter.address().port}, 1-50`)
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
    await fill(0, 'example.com')
    await until('Look up', clickText, 'Look up')
    // Four servers answer (or say they can't), and TXT also explains the domain's mail rules.
    await until('four server rows', () => document.querySelectorAll('.list .list-row').length === 4)
    await until('the mail section', hasText, 'E-mail protection')
    await shot('tools-dns')
  })

  await step('whois', async () => {
    await until('Whois', clickText, 'Whois')
    await fill(0, 'example.com')
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
      await fill(0, `http://127.0.0.1:${site.address().port}/`)
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
        await setInput('.share-port', site.address().port)
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
    const watch = async (kind, target) => {
      await setInput('.monitor-form select', kind)
      await setInput('.monitor-form input', target)
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
    await setInput('.cap-form input', '0.5', 0)
    await setInput('.cap-form input', '1', 1)
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
})
