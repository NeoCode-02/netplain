import { useEffect, useState, type ReactNode } from 'react'
import type { AdapterKind } from '../../shared/types'
import { errText, useT } from './i18n'

const PATHS = {
  wifi: 'M2 8.8a15 15 0 0 1 20 0M5 12.4a10 10 0 0 1 14 0M8.5 15.9a5 5 0 0 1 7 0M12 19.5h.01',
  ethernet: 'M4 7h16v10H4zM8 17v-3M12 17v-3M16 17v-3M9 7V4h6v3',
  shield: 'M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10Z',
  box: 'M21 8 12 3 3 8v8l9 5 9-5ZM3 8l9 5 9-5M12 13v8',
  bluetooth: 'M7 7l10 10-5 5V2l5 5L7 17',
  cell: 'M3 20h.01M8 20v-4M13 20v-8M18 20V8',
  globe: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18ZM3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18',
  router: 'M3 14h18v6H3zM7 17h.01M11 17h.01M8.5 10.5a5 5 0 0 1 7 0M5.5 7.5a9 9 0 0 1 13 0',
  devices: 'M3 5h12v9H3zM6 18h6M9 14v4M17 9h4v11h-4z',
  phone: 'M8 2h8a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H8a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1ZM12 18h.01',
  monitor: 'M3 4h18v12H3zM8 20h8M12 16v4',
  sliders: 'M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0M14 4v4M8 10v4M16 16v4',
  refresh: 'M21 12a9 9 0 1 1-2.6-6.4M21 4v5h-5',
  alert: 'M12 9v4M12 17h.01M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z',
  chevron: 'M9 6l6 6-6 6',
  down: 'M12 5v14M5 12l7 7 7-7',
  up: 'M12 19V5M5 12l7-7 7 7',
  dot: 'M12 12h.01',
  link: 'M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7',
  search: 'M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14ZM20 20l-4-4',
  chart: 'M5 20v-8M11 20V5M17 20v-5M3 20h18',
  grid: 'M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 14h6v6h-6z',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  clock: 'M12 7v5l3 2M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0Z',
  bell: 'M6 8a6 6 0 1 1 12 0c0 7 3 9 3 9H3s3-2 3-9M10.3 21a1.9 1.9 0 0 0 3.4 0',
  user: 'M20 21a8 8 0 0 0-16 0M12 13a5 5 0 1 0 0-10 5 5 0 0 0 0 10Z',
  wrench: 'M14.7 6.3a4 4 0 0 0 5 5l-9.4 9.4a2.1 2.1 0 0 1-3-3l9.4-9.4a4 4 0 0 0-2-2Z',
  pulse: 'M3 12h4l2.5-6 5 12 2.5-6h4',
  close: 'M6 6l12 12M18 6 6 18',
  check: 'M5 12.5l4.5 4.5L19 7.5',
  share: 'M4 13v6a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-6M16 7l-4-4-4 4M12 3v12',
  copy: 'M9 9h11v11H9zM5 15H4V4h11v1',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5'
} as const
export type IconName = keyof typeof PATHS

export function Icon({ name, size = 16, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d={PATHS[name]} />
    </svg>
  )
}

export const KIND_ICON: Record<AdapterKind, IconName> = {
  wifi: 'wifi',
  ethernet: 'ethernet',
  virtual: 'box',
  vpn: 'shield',
  bluetooth: 'bluetooth',
  cellular: 'cell',
  loopback: 'dot',
  other: 'globe'
}

/** Brand mark: a calm signal line in a rounded frame. */
export function Mark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="brand-mark" aria-hidden>
      <rect x="2.5" y="2.5" width="19" height="19" rx="6" stroke="currentColor" strokeWidth="1.6" />
      <path d="M6 13.5h2.6l2-5.5 2.8 9 2-3.5H17" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="17.6" cy="13.5" r="1.7" fill="var(--accent)" />
    </svg>
  )
}

/** The frame every page shares: the title with its actions on one line, a short note, then the tabs. */
export function Page({ title, note, actions, tabs, children }: { title: string; note?: ReactNode; actions?: ReactNode; tabs?: ReactNode; children?: ReactNode }) {
  return (
    <div className="page">
      <header className="page-head">
        <div className="page-title">
          <h2>{title}</h2>
          {note && <p>{note}</p>}
        </div>
        {actions && <div className="row page-actions">{actions}</div>}
      </header>
      {tabs}
      {children}
    </div>
  )
}

/** A page's tabs (or a range that switches the whole page). */
export function Tabs<T extends string>({ value, options, text, label, onChange }: { value: T; options: readonly T[]; text(v: NoInfer<T>): string; label?: string; onChange(v: NoInfer<T>): void }) {
  return (
    <div className="seg page-tabs" role="tablist" aria-label={label}>
      {options.map((v) => (
        <button key={v} role="tab" aria-selected={value === v} className={value === v ? 'on' : ''} onClick={() => onChange(v)}>
          {text(v)}
        </button>
      ))}
    </div>
  )
}

export function Empty({ icon, title, body, children }: { icon: IconName; title: string; body?: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-mark">
        <Icon name={icon} size={20} />
      </div>
      <h3>{title}</h3>
      {body && <p>{body}</p>}
      {children}
    </div>
  )
}

/** One labelled value in a `<dl className="facts">`, with an optional plain-language note. */
export function Fact({ label, value, note, mono }: { label: string; value: string; note?: string; mono?: boolean }) {
  return (
    <div className="fact">
      <dt>{label}</dt>
      <dd>
        <span className={mono ? 'mono' : undefined}>{value}</span>
        {note && <small>{note}</small>}
      </dd>
    </div>
  )
}

const icons = new Map<string, Promise<string | null>>()
/** A running program's own icon (asked from the OS once per path), or a neutral box. */
export function AppIcon({ path }: { path: string | null }) {
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    if (!path) return
    if (!icons.has(path)) icons.set(path, window.netplain.appIcon(path).catch(() => null))
    let live = true
    void icons.get(path)!.then((s) => live && setSrc(s))
    return () => {
      live = false
    }
  }, [path])
  return <span className="app-icon">{src ? <img src={src} alt="" /> : <Icon name="box" size={16} />}</span>
}

/** An error from the main process in the reader's language; nothing when there is none. */
export function ErrNote({ e }: { e: unknown }) {
  const t = useT()
  return e === null || e === undefined ? null : <p className="note danger">{errText(t, e)}</p>
}
