import { spawn } from 'node:child_process'
import fs from 'node:fs'
import type { SecService, SecStartup, SecThreat, Security, Signer } from '../shared/types'
import { list } from './exec'
import { exeOf, findings } from './findings'

/**
 * Everything the security page reads, in one PowerShell run (~4 s, no admin rights needed).
 * Fed through stdin, one complete statement per line, so nothing has to survive command-line quoting.
 */
const SCRIPT = String.raw`
$ErrorActionPreference = 'SilentlyContinue'
$o = [ordered]@{}
$s = Get-MpComputerStatus
if ($s) { $o.defender = @{ av = [bool]$s.AntivirusEnabled; rt = [bool]$s.RealTimeProtectionEnabled; sigAge = [long]$s.AntivirusSignatureAge; quickAge = [long]$s.QuickScanAge; fullAge = [long]$s.FullScanAge; tamper = [bool]$s.IsTamperProtected; mode = [string]$s.AMRunningMode } } else { $o.defender = $null }
$o.threats = @(Get-MpThreat | ForEach-Object { @{ id = [string]$_.ThreatID; name = [string]$_.ThreatName; severity = [int]$_.SeverityID; active = [bool]$_.IsActive; resources = @($_.Resources | ForEach-Object { [string]$_ }) } })
$o.detections = @(Get-MpThreatDetection | ForEach-Object { @{ id = [string]$_.ThreatID; at = $_.InitialDetectionTime.ToUniversalTime().ToString('o'); status = [int]$_.ThreatStatusID; resources = @($_.Resources | ForEach-Object { [string]$_ }) } })
$o.me = [string][Security.Principal.WindowsIdentity]::GetCurrent().User.Value
$o.users = @(Get-LocalUser | ForEach-Object { @{ name = [string]$_.Name; enabled = [bool]$_.Enabled; last = $(if ($_.LastLogon) { $_.LastLogon.ToUniversalTime().ToString('o') } else { $null }); sid = [string]$_.SID; desc = [string]$_.Description } })
$o.admins = @(Get-LocalGroupMember -SID S-1-5-32-544 | ForEach-Object { @{ name = [string]$_.Name; sid = [string]$_.SID; source = [string]$_.PrincipalSource; kind = [string]$_.ObjectClass } })
$o.services = @(Get-CimInstance Win32_Service | ForEach-Object { @{ name = [string]$_.Name; display = [string]$_.DisplayName; desc = [string]$_.Description; state = [string]$_.State; start = [string]$_.StartMode; account = [string]$_.StartName; path = [string]$_.PathName } })
$o.tasks = @(Get-ScheduledTask | Where-Object { $_.TaskPath -notlike '\Microsoft\*' } | ForEach-Object { @{ path = $_.TaskPath + $_.TaskName; state = [string]$_.State; author = [string]$_.Author; exec = @($_.Actions | Where-Object { $_.Execute } | ForEach-Object { ([string]$_.Execute + ' ' + [string]$_.Arguments).Trim() }) } })
$sa = 'Software\Microsoft\Windows\CurrentVersion\Explorer\StartupApproved'
$cv = 'Software\Microsoft\Windows\CurrentVersion'
$keys = @(@('HKCU', ($cv + '\Run'), ($sa + '\Run')), @('HKCU', ($cv + '\RunOnce'), ''), @('HKLM', ($cv + '\Run'), ($sa + '\Run')), @('HKLM', ($cv + '\RunOnce'), ''), @('HKLM', 'Software\WOW6432Node\Microsoft\Windows\CurrentVersion\Run', ($sa + '\Run32')))
$run = New-Object System.Collections.ArrayList
foreach ($k in $keys) { $p = Get-ItemProperty ($k[0] + ':\' + $k[1]); $ap = $null; if ($k[2]) { $ap = Get-ItemProperty ($k[0] + ':\' + $k[2]) }; if ($p) { foreach ($prop in $p.PSObject.Properties) { if ($prop.Name -like 'PS*' -or $prop.Name -eq '(default)' -or -not $prop.Value) { continue }; $b = $null; if ($ap) { $b = $ap.($prop.Name) }; [void]$run.Add(@{ hive = $k[0]; key = $k[1]; approved = $k[2]; name = [string]$prop.Name; command = [string]$prop.Value; enabled = ((-not $b) -or (($b[0] -band 1) -eq 0)) }) } } }
$sh = New-Object -ComObject WScript.Shell
foreach ($f in @(@('HKCU', [Environment]::GetFolderPath('Startup')), @('HKLM', [Environment]::GetFolderPath('CommonStartup')))) { $ap = Get-ItemProperty ($f[0] + ':\' + $sa + '\StartupFolder'); Get-ChildItem -LiteralPath $f[1] -File | Where-Object { $_.Name -ne 'desktop.ini' } | ForEach-Object { $b = $null; if ($ap) { $b = $ap.($_.Name) }; $target = $_.FullName; if ($_.Extension -eq '.lnk') { $target = $sh.CreateShortcut($_.FullName).TargetPath }; [void]$run.Add(@{ hive = $f[0]; key = 'StartupFolder'; approved = ($sa + '\StartupFolder'); name = [string]$_.Name; command = [string]$target; enabled = ((-not $b) -or (($b[0] -band 1) -eq 0)) }) } }
$o.startup = @($run)
$o.firewall = @(Get-NetFirewallProfile | ForEach-Object { @{ name = [string]$_.Name; on = ([string]$_.Enabled -eq 'True') } })
$u = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Policies\System'
$o.uac = @{ lua = [int]$u.EnableLUA; consent = [int]$u.ConsentPromptBehaviorAdmin }
$o.rdpDenied = [int](Get-ItemProperty 'HKLM:\System\CurrentControlSet\Control\Terminal Server').fDenyTSConnections
$o.sac = (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy').VerifiedAndReputablePolicyState
$i = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Internet Settings'
$o.proxy = @{ on = [int]$i.ProxyEnable; server = [string]$i.ProxyServer; pac = [string]$i.AutoConfigURL }
$o.hosts = @(Get-Content ($env:SystemRoot + '\System32\drivers\etc\hosts') | Where-Object { $_ -match '^\s*[^#\s]' } | ForEach-Object { $_.Trim() })
$o.updated = @(Get-CimInstance Win32_QuickFixEngineering | Where-Object { $_.InstalledOn -is [datetime] } | ForEach-Object { $_.InstalledOn.ToString('yyyy-MM-dd') } | Sort-Object -Descending | Select-Object -First 1)
[Console]::OutputEncoding = [Text.Encoding]::UTF8
[Console]::Out.WriteLine(($o | ConvertTo-Json -Depth 6 -Compress))
`

/** Runs a script through stdin and returns its last output line. */
export function powershell(script: string, timeout = 60_000): Promise<string> {
  return new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '-'], { windowsHide: true })
    let out = ''
    ps.stdout.setEncoding('utf8')
    ps.stdout.on('data', (d: string) => (out += d))
    const timer = setTimeout(() => ps.kill(), timeout)
    ps.on('error', reject)
    ps.on('exit', () => {
      clearTimeout(timer)
      resolve(out.trim().split(/\r?\n/).at(-1) ?? '')
    })
    ps.stdin.end(script.trim() + '\n')
  })
}

interface Raw {
  defender: Security['defender'] & { mode?: string }
  threats: (Omit<SecThreat, 'at' | 'status'> & { resources: string[] | string })[] | null
  detections: { id: string; at: string; status: number; resources: string[] | string | null }[] | null
  me: string
  users: { name: string; enabled: boolean; last: string | null; sid: string }[] | null
  admins: { sid: string }[] | null
  services: Omit<SecService, 'exe' | 'signer'>[] | null
  tasks: { path: string; state: string; exec: string[] | string | null }[] | null
  startup: { hive: string; key: string; approved: string; name: string; command: string; enabled: boolean }[] | null
  firewall: Security['firewall'] | null
  uac: Security['uac']
  rdpDenied: number
  sac: number | null
  proxy: Security['proxy']
  hosts: string[] | string | null
  updated: string[] | string | null
}

/** `Get-AuthenticodeSignature` for many files at once; catalog-signed Windows files count as signed. */
const signScript = (paths: string[]) =>
  [
    "$ErrorActionPreference = 'SilentlyContinue'",
    '$r = @{}',
    `foreach ($p in @(${paths.map((p) => `'${p.replace(/'/g, "''")}'`).join(',')})) { $s = Get-AuthenticodeSignature -LiteralPath $p; $pub = $null; if ($s.SignerCertificate) { $pub = $s.SignerCertificate.GetNameInfo('SimpleName', $false) }; $r[$p] = @{ status = [string]$s.Status; publisher = $pub } }`,
    '[Console]::OutputEncoding = [Text.Encoding]::UTF8',
    '[Console]::Out.WriteLine(($r | ConvertTo-Json -Compress -Depth 3))'
  ].join('\n')

export const toSigner = (v: { status?: string; publisher?: string | null } | undefined): Signer => ({
  status: v?.status === 'Valid' ? 'valid' : v?.status === 'NotSigned' ? 'unsigned' : 'invalid',
  publisher: v?.publisher || null
})

interface Deps {
  /** Programs talking to the internet right now. */
  online: () => Promise<{ app: string; path: string | null }[]>
  dns: () => string[]
  geo: (ip: string) => { org: string | null }
}

/** Reads the security picture of this computer (Windows), with signatures cached per file version. */
export function createSecurity(deps: Deps) {
  const signed = new Map<string, { mtime: number; s: Signer }>()
  let last: Security | null = null
  let pending: Promise<Security> | null = null

  async function sign(paths: (string | null)[]): Promise<Map<string, Signer>> {
    const out = new Map<string, Signer>()
    const need: [string, number][] = []
    for (const p of new Set(paths.filter((x): x is string => !!x))) {
      let mtime: number
      try {
        mtime = fs.statSync(p).mtimeMs
      } catch {
        continue
      }
      const c = signed.get(p)
      if (c && c.mtime === mtime) out.set(p, c.s)
      else need.push([p, mtime])
    }
    for (let i = 0; i < need.length; i += 150) {
      const batch = need.slice(i, i + 150)
      const json = JSON.parse((await powershell(signScript(batch.map(([p]) => p)), 120_000)) || '{}') as Record<string, { status?: string; publisher?: string }>
      // PowerShell hashtables ignore case, so "System32" and "system32" came back as one key.
      const r = new Map(Object.entries(json).map(([k, v]) => [k.toLowerCase(), v]))
      for (const [p, mtime] of batch) {
        const s = toSigner(r.get(p.toLowerCase()))
        signed.set(p, { mtime, s })
        out.set(p, s)
      }
    }
    return out
  }

  async function build(): Promise<Security> {
    const raw = JSON.parse(await powershell(SCRIPT)) as Raw
    const admins = new Set(list(raw.admins).map((a) => a.sid))
    const latest = new Map<string, { at: string; status: number; resources: string[] }>()
    for (const d of list(raw.detections)) if (!latest.has(d.id) || d.at > latest.get(d.id)!.at) latest.set(d.id, { at: d.at, status: d.status, resources: list(d.resources).filter(Boolean) })
    const services = list(raw.services).map((x) => ({ ...x, exe: exeOf(x.path), signer: null as Signer | null }))
    const startup: SecStartup[] = [
      ...list(raw.startup).map((x) => ({
        id: `${x.key === 'StartupFolder' ? 'folder' : 'run'}|${x.hive}|${x.approved}|${x.name}`,
        kind: (x.key === 'StartupFolder' ? 'folder' : 'run') as SecStartup['kind'],
        hive: x.hive,
        approved: x.approved,
        name: x.name,
        command: x.command,
        enabled: x.enabled,
        exe: exeOf(x.command),
        signer: null
      })),
      ...list(raw.tasks).map((x) => {
        const command = list(x.exec)[0] ?? ''
        return { id: `task||${x.path}|`, kind: 'task' as const, hive: '', approved: '', name: x.path, command, enabled: x.state !== 'Disabled', exe: exeOf(command), signer: null }
      })
    ]
    const online = await deps.online().catch(() => [])
    const signers = await sign([...services.map((x) => x.exe), ...startup.map((x) => x.exe), ...online.map((o) => o.path)])
    for (const x of [...services, ...startup]) x.signer = x.exe ? (signers.get(x.exe) ?? null) : null
    const sec: Omit<Security, 'findings'> = {
      at: Date.now(),
      defender: raw.defender ? { av: raw.defender.av, rt: raw.defender.rt, sigAge: raw.defender.sigAge, quickAge: raw.defender.quickAge, fullAge: raw.defender.fullAge, tamper: raw.defender.tamper } : null,
      threats: list(raw.threats).map((x) => {
        const d = latest.get(x.id)
        const own = list(x.resources).filter(Boolean)
        // The threat record may lack the file or command; its latest detection has it.
        return { ...x, resources: own.length ? own : (d?.resources ?? []), at: d?.at ?? null, status: d?.status ?? null }
      }),
      users: list(raw.users).map((u) => ({ name: u.name, enabled: u.enabled, last: u.last, sid: u.sid, admin: admins.has(u.sid), me: u.sid === raw.me })),
      services,
      startup,
      firewall: list(raw.firewall),
      uac: raw.uac,
      rdpDenied: raw.rdpDenied,
      sac: raw.sac ?? null,
      proxy: raw.proxy,
      hosts: list(raw.hosts),
      updated: list(raw.updated)[0] ?? null
    }
    return { ...sec, findings: findings(sec, { now: Date.now(), dns: deps.dns(), online, signers, geo: deps.geo }) }
  }

  return {
    /** The last reading if younger than a minute (unless `fresh`), else a new one (~5 s; signatures add a few seconds the first time). */
    get(fresh = false): Promise<Security> {
      if (!fresh && last && Date.now() - last.at < 60_000) return Promise.resolve(last)
      pending ??= build()
        .then((s) => (last = s))
        .finally(() => (pending = null))
      return pending
    }
  }
}
