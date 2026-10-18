'use client'

// Chart chrome for the Evidence page: a card with a chart/table switch, a
// verdict legend, verdict marks that differ in shape as well as colour, a
// tooltip that follows the pointer or keyboard focus, and a width hook so SVG
// charts draw at their real pixel size (axis text stays 11px+ on a phone
// instead of being scaled down with a viewBox).

import { useEffect, useRef, useState } from 'react'
import { BarChart3, Table2 } from 'lucide-react'
import { VERDICT, type Verdict } from '@/lib/verdict'

export const AXIS = '#6b6158', GRID = '#e6ded2', INK = '#14100d', NEUTRAL = '#5e544b'

export function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(Math.floor(e.contentRect.width)))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** A verdict mark: circle, triangle, diamond or square, so colour is never the only cue. */
export function Mark({ v, x, y, s }: { v: Verdict; x: number; y: number; s: number }) {
  const p = { fill: VERDICT[v].mark, stroke: '#fff', strokeWidth: 1.5 }
  if (v === 'rewritten') return <polygon {...p} points={`${x},${y - s * 1.2} ${x + s * 1.1},${y + s * 0.8} ${x - s * 1.1},${y + s * 0.8}`} />
  if (v === 'paused') return <polygon {...p} points={`${x},${y - s * 1.25} ${x + s * 1.25},${y} ${x},${y + s * 1.25} ${x - s * 1.25},${y}`} />
  if (v === 'blocked' || v === 'critical') return <rect {...p} x={x - s} y={y - s} width={s * 2} height={s * 2} rx={1.5} />
  return <circle {...p} cx={x} cy={y} r={s} />
}

export function Legend({ items }: { items: Verdict[] }) {
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#5e544b]" aria-label="Legend">
      {items.map(v => (
        <li key={v} className="inline-flex items-center gap-1.5">
          <svg width="14" height="14" aria-hidden="true"><Mark v={v} x={7} y={7} s={4.5} /></svg>{VERDICT[v].label}
        </li>
      ))}
    </ul>
  )
}

export type TipState = { x: number; y: number; body: React.ReactNode } | null

/** Positioned in the chart's own coordinates (the SVG is drawn at pixel size). */
export function Tip({ tip, width }: { tip: TipState; width: number }) {
  if (!tip) return null
  const x = Math.min(Math.max(tip.x, 90), Math.max(90, width - 90))
  return (
    <div role="status" className="pointer-events-none absolute z-10 w-max max-w-[260px] -translate-x-1/2 -translate-y-[calc(100%+10px)] rounded-lg bg-[#14100d] px-3 py-2 text-[12.5px] leading-snug text-[#f2ede7] shadow-lg"
      style={{ left: x, top: tip.y }}>{tip.body}</div>
  )
}

/** Props that give an SVG element a tooltip on hover and on keyboard focus. */
export function tipProps(set: (t: TipState) => void, x: number, y: number, label: string, body: React.ReactNode) {
  const show = () => set({ x, y, body })
  return { tabIndex: 0, role: 'img', 'aria-label': label, onMouseEnter: show, onFocus: show, onBlur: () => set(null) }
}

export interface TableData { head: string[]; rows: React.ReactNode[][]; caption: string }

export function ChartCard({ title, sub, legend, table, children, className = '' }: {
  title: string; sub: React.ReactNode; legend?: Verdict[]; table: TableData; children: React.ReactNode; className?: string
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`app-card p-4 sm:p-5 min-w-0 ${className}`}>
      <div className="flex flex-wrap items-start gap-3">
        <div className="min-w-0 flex-1 basis-[240px]">
          <h3 className="app-h3">{title}</h3>
          <p className="app-meta mt-0.5 text-[13px]">{sub}</p>
        </div>
        <button type="button" onClick={() => setAsTable(t => !t)} aria-pressed={asTable} className="app-btn app-btn-secondary app-btn-sm shrink-0">
          {asTable ? <BarChart3 className="w-3.5 h-3.5" aria-hidden="true" /> : <Table2 className="w-3.5 h-3.5" aria-hidden="true" />}
          {asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {legend && !asTable && <div className="mt-3"><Legend items={legend} /></div>}
      <div className="mt-3">
        {asTable ? (
          <div className="app-table-wrap">
            <table className="data-table">
              <caption className="sr-only">{table.caption}</caption>
              <thead><tr>{table.head.map(h => <th key={h} scope="col">{h}</th>)}</tr></thead>
              <tbody>
                {table.rows.length === 0 && <tr><td colSpan={table.head.length} className="text-[#5e544b]">No rows.</td></tr>}
                {table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className="tabular-nums">{c}</td>)}</tr>)}
              </tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  )
}
