'use client'

// Shared application building blocks (styles in app/(dashboard)/app.css).
import { useEffect, useId, useRef, useState } from 'react'
import { Ban, Check, CheckCircle2, Copy, Info, OctagonAlert, PauseCircle, RefreshCw, Scissors } from 'lucide-react'
import type { Resource } from '@/lib/useResource'
import { describe } from '@/lib/api'
import { VERDICT, type Verdict } from '@/lib/verdict'

const ICONS = { allowed: CheckCircle2, rewritten: Scissors, paused: PauseCircle, blocked: Ban, critical: OctagonAlert }

/** A verdict as a label with an icon: never colour alone. */
export function VerdictBadge({ v, solid, title }: { v: Verdict; solid?: boolean; title?: string }) {
  const Icon = ICONS[v]
  return (
    <span className={`v-badge v-${v}${solid ? ' v-solid' : ''}`} title={title}>
      <Icon aria-hidden="true" strokeWidth={2.4} />{VERDICT[v].label}
    </span>
  )
}

type StateKind = 'loading' | 'empty' | 'error' | 'sleeping'

export function StatePanel({ kind, title, children, onRetry, compact }: { kind: StateKind; title: string; children?: React.ReactNode; onRetry?: () => void; compact?: boolean }) {
  return (
    <div className={`app-state app-state-${kind}`} style={compact ? { padding: '20px 16px' } : undefined}
      role={kind === 'error' || kind === 'sleeping' ? 'alert' : 'status'} aria-busy={kind === 'loading'}>
      {kind === 'loading' && <RefreshCw className="w-4 h-4 animate-spin text-[#6b6158]" aria-hidden="true" />}
      <span className="app-state-title">{title}</span>
      {children && <span className="max-w-[60ch]">{children}</span>}
      {onRetry && kind !== 'loading' && <button type="button" className="app-btn app-btn-secondary app-btn-sm mt-1" onClick={onRetry}><RefreshCw className="w-3.5 h-3.5" aria-hidden="true" />Try again</button>}
    </div>
  )
}

/** Renders a resource's non-data states; children render only with data. */
export function ResourceGate<T>({ r, loading = 'Loading…', isEmpty, empty, children, compact }: {
  r: Resource<T>; loading?: string; isEmpty?: (d: T) => boolean; empty?: React.ReactNode; compact?: boolean; children: (d: T) => React.ReactNode
}) {
  if (r.status === 'loading') return <StatePanel kind="loading" title={loading} compact={compact} />
  if (r.status === 'error' || !r.data) {
    const sleeping = r.error?.kind === 'sleeping' || r.error?.kind === 'timeout' || r.error?.kind === 'network'
    return <StatePanel kind={sleeping ? 'sleeping' : 'error'} title={sleeping ? 'Cannot reach the control plane' : 'Could not load this view'} onRetry={r.retry} compact={compact}>{describe(r.error)}</StatePanel>
  }
  if (isEmpty && isEmpty(r.data)) return <>{empty}</>
  return (
    <>
      {r.stale && (
        <div className="app-banner app-banner-warn mb-3" role="status">
          <span>Showing data from {r.loadedAt ? new Date(r.loadedAt).toLocaleTimeString() : 'earlier'}: the latest refresh failed. {describe(r.error)}</span>
          <button type="button" className="app-btn app-btn-ghost app-btn-sm ml-auto" onClick={r.retry}>Retry</button>
        </div>
      )}
      {children(r.data)}
    </>
  )
}

/** A metric tile. value === null means "unknown": shown as a dash, never as 0. */
export function Kpi({ value, label, note, tone }: { value: string | number | null; label: string; note?: React.ReactNode; tone?: string }) {
  return (
    <div className={`app-kpi${value === null ? ' app-kpi-unknown' : ''}`}>
      <div className="app-num" style={tone && value !== null ? { color: tone } : undefined}>{value === null ? '—' : value}</div>
      <span className="app-label">{label}</span>
      {note && <div className="app-meta mt-0.5">{note}</div>}
    </div>
  )
}

export function CopyButton({ text, label = 'Copy', className = '' }: { text: string; label?: string; className?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const t = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => () => clearTimeout(t.current), [])
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setState('copied') } catch { setState('failed') }
    clearTimeout(t.current); t.current = setTimeout(() => setState('idle'), 1800)
  }
  return (
    <button type="button" onClick={copy} aria-label={state === 'idle' ? label : undefined} className={`app-btn app-btn-secondary app-btn-sm ${className}`}>
      {state === 'copied' ? <Check className="w-3.5 h-3.5" aria-hidden="true" /> : <Copy className="w-3.5 h-3.5" aria-hidden="true" />}
      <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
    </button>
  )
}

/** An (i) button whose panel opens on click, keyboard focus or hover, and closes on Escape or outside click. */
export function InfoPopover({ label, children, align = 'left' }: { label: string; children: React.ReactNode; align?: 'left' | 'right' }) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const box = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false) }
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', onDoc); document.addEventListener('keydown', onKey)
    return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onKey) }
  }, [open])
  return (
    <span ref={box} className="relative inline-flex" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <button type="button" aria-label={label} aria-expanded={open} aria-controls={id} onClick={() => setOpen(o => !o)} onFocus={() => setOpen(true)}
        className="grid place-items-center w-7 h-7 rounded-full border border-[#8f8478] text-[#5e544b] hover:text-[#14100d] hover:border-[#14100d] bg-white">
        <Info className="w-3.5 h-3.5" aria-hidden="true" />
      </button>
      {open && (
        <span id={id} role="dialog" aria-label={label} className={`app-pop top-full mt-2 ${align === 'right' ? 'right-0' : 'left-0'}`}>{children}</span>
      )}
    </span>
  )
}
