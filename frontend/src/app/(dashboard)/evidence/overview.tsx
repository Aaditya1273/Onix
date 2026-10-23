'use client'

// The overview cards at the top of the Evidence page: quick analytics with an
// area chart of the decision log, the most recent decisions, why calls were
// stopped, and the latest stops. Every figure comes from the same two sources
// as the rest of the page: the graph's 7-day digest and the decisions this
// server holds in memory. Nothing here is estimated.

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { Ban, OctagonAlert, PauseCircle, Scissors, CheckCircle2, ArrowUpRight } from 'lucide-react'
import { VerdictBadge } from '@/components/app/ui'
import { VERDICT, stageLabel, verdictOf, type Verdict } from '@/lib/verdict'
import { AXIS, GRID, useWidth } from './charts'
import { SignalRadar, VerdictRing } from './forms'
import { useIntro } from '@/lib/useIntro'
import { Odometer } from '@/components/app/Odometer'

export interface ODecision { id?: string; decision: string; stage: string; tool: string; session_id: string; agent?: string; reason?: string; at: string; graph_ms: number }
export interface ODigest { decisions: number; by_verdict: Record<string, number>; by_stage: Record<string, number>; model_free_fraction: number; graph_queried: number; graph_ms_p50: number; graph_ms_p95: number }

const vOf = (d: ODecision) => verdictOf(d.decision, d.stage)
const t = (d: ODecision) => Date.parse(d.at)
const shortSession = (s: string) => s.replace(/^(cc|codex|gem|pg)-/, '').split('-').pop()!.slice(-8)
const clock = (ms: number, fine = false) => new Date(ms).toLocaleTimeString([], fine ? { hour: '2-digit', minute: '2-digit', second: '2-digit' } : { hour: '2-digit', minute: '2-digit' })
const ICON = { allowed: CheckCircle2, rewritten: Scissors, paused: PauseCircle, blocked: Ban, critical: OctagonAlert }

function Card({ title, action, children, className = '' }: { title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={`bg-white border border-[#ebe4d9] rounded-[20px] p-6 lg:p-7 min-w-0 ${className}`}>
      <div className="flex items-center gap-3 mb-5">
        <h2 className="font-display text-[18px] font-black text-[#14100d] tracking-[-0.025em]">{title}</h2>
        {action && <div className="ml-auto">{action}</div>}
      </div>
      {children}
    </section>
  )
}
const SeeAll = ({ href, label }: { href: string; label: string }) => (
  <Link href={href} className="inline-flex items-center gap-1 text-[13px] font-semibold text-[#14100d] underline decoration-[#ff6b00] decoration-2 underline-offset-[3px]" aria-label={label}>
    See all<ArrowUpRight className="w-3.5 h-3.5" aria-hidden="true" />
  </Link>
)
const Chip = ({ children, tone = 'neutral' }: { children: React.ReactNode; tone?: 'neutral' | 'warn' | 'good' }) => (
  <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold tabular-nums
    ${tone === 'warn' ? 'bg-[#fdeee4] text-[#a8380a]' : tone === 'good' ? 'bg-[#ecf7ef] text-[#15803d]' : 'bg-[#f1ede7] text-[#5e544b]'}`}>{children}</span>
)

// ---- Quick analytics: three figures and the decision log over time ----------

function Stat({ label, value, chip, first }: { label: string; value: string; chip: React.ReactNode; first?: boolean }) {
  return (
    <div className={`rounded-[14px] px-4 py-3 ${first ? 'bg-[#faf5ee] ring-1 ring-[#f1e6d8]' : ''}`}>
      <p className="text-[12.5px] font-medium text-[#6b6158]">{label}</p>
      <p className="mt-1 flex flex-wrap items-baseline gap-2">
        <span className="font-display text-[26px] font-bold leading-none text-[#14100d] tabular-nums tracking-[-0.02em]"><Odometer value={value} /></span>{chip}
      </p>
    </div>
  )
}

function Area({ ds }: { ds: ODecision[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [hover, setHover] = useState<number | null>(null)
  const play = useIntro('area')
  const H = 210, pad = { l: 34, r: 12, t: 14, b: 26 }
  const buckets = useMemo(() => {
    if (!ds.length) return []
    const ts = ds.map(t), lo = Math.min(...ts), hi = Math.max(...ts)
    const n = 12, step = Math.max(1, (hi - lo) / n)
    const out = Array.from({ length: n }, (_, i) => ({ at: lo + step * (i + 0.5), from: lo + step * i, to: lo + step * (i + 1), all: 0, stopped: 0 }))
    for (const d of ds) {
      const i = Math.min(n - 1, Math.floor((t(d) - lo) / step))
      out[i].all++; if (vOf(d) !== 'allowed') out[i].stopped++
    }
    return out
  }, [ds])
  if (!buckets.length) return null
  const fine = buckets[buckets.length - 1].to - buckets[0].from < 10 * 60000
  const max = Math.max(4, ...buckets.map(b => b.all))
  const top = Math.ceil(max / 4) * 4
  const iw = Math.max(0, W - pad.l - pad.r), ih = H - pad.t - pad.b
  const x = (i: number) => pad.l + (buckets.length === 1 ? iw / 2 : (iw * i) / (buckets.length - 1))
  const y = (v: number) => pad.t + ih - (ih * v) / top
  const line = buckets.map((b, i) => `${i ? 'L' : 'M'}${x(i)},${y(b.all)}`).join(' ')
  const area = `${line} L${x(buckets.length - 1)},${y(0)} L${x(0)},${y(0)} Z`
  const h = hover == null ? null : buckets[hover]
  const pick = (cx: number) => setHover(Math.max(0, Math.min(buckets.length - 1, Math.round(((cx - pad.l) / Math.max(1, iw)) * (buckets.length - 1)))))
  return (
    <div ref={ref} className="relative min-w-0">
      {W > 0 && (
        <svg width={W} height={H} role="img" className={play ? 'intro' : undefined} aria-label={`Decisions over time: ${ds.length} decisions in ${buckets.length} equal slices, the most in one slice ${max}.`}
          onMouseMove={e => pick(e.clientX - e.currentTarget.getBoundingClientRect().left)} onMouseLeave={() => setHover(null)}>
          <defs>
            <linearGradient id="ov-fill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0" stopColor="#ff6b00" stopOpacity=".22" /><stop offset="1" stopColor="#ff6b00" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0, 1, 2, 3, 4].map(k => {
            const v = (top / 4) * k
            return <g key={k}><line x1={pad.l} x2={W - pad.r} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={pad.l - 8} y={y(v) + 4} fontSize="11" fill={AXIS} textAnchor="end">{v}</text></g>
          })}
          <path d={area} fill="url(#ov-fill)" className="a-fade" style={{ ['--d' as string]: '.7s' }} />
          <path d={line} fill="none" stroke="#e85d0c" strokeWidth="2" strokeLinejoin="round" pathLength={1} className="a-draw" style={{ ['--dur' as string]: '1.3s' }} />
          {buckets.map((b, i) => (
            <g key={i}>
              <circle cx={x(i)} cy={y(b.all)} r={hover === i ? 5 : 3} fill="#fff" stroke="#e85d0c" strokeWidth="2" className="a-pop" style={{ ['--d' as string]: `${0.1 + (i / buckets.length) * 1.2}s` }} />
              {b.stopped > 0 && <rect x={x(i) - 3.5} y={y(b.stopped) - 3.5} width="7" height="7" rx="1.5" fill={VERDICT.blocked.mark} stroke="#fff" strokeWidth="1.5" />}
              {/* keyboard: every slice is focusable and reads its numbers */}
              <rect x={x(i) - 10} y={pad.t} width="20" height={ih} fill="transparent" tabIndex={0} role="img"
                aria-label={`${clock(b.from, fine)} to ${clock(b.to, fine)}: ${b.all} decisions, ${b.stopped} stopped`} onFocus={() => setHover(i)} onBlur={() => setHover(null)} />
            </g>
          ))}
          {[0, Math.floor((buckets.length - 1) / 2), buckets.length - 1].map(i => (
            <text key={i} x={x(i)} y={H - 6} fontSize="11" fill={AXIS} textAnchor={i === 0 ? 'start' : i === buckets.length - 1 ? 'end' : 'middle'}>{clock(buckets[i].at, fine)}</text>
          ))}
          {h && hover != null && (
            <g pointerEvents="none">
              <line x1={x(hover)} x2={x(hover)} y1={pad.t} y2={pad.t + ih} stroke="#14100d" strokeDasharray="3 3" strokeOpacity=".5" />
              <line x1={pad.l} x2={W - pad.r} y1={y(h.all)} y2={y(h.all)} stroke="#14100d" strokeDasharray="3 3" strokeOpacity=".25" />
            </g>
          )}
        </svg>
      )}
      {h && hover != null && (
        <div role="status" className="pointer-events-none absolute -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg bg-[#14100d] px-3 py-2 text-[12px] leading-snug text-[#f2ede7] shadow-lg whitespace-nowrap"
          style={{ left: Math.min(Math.max(x(hover), 80), W - 80), top: y(h.all) }}>
          <span className="block text-[#b9ada0]">{clock(h.from, fine)} to {clock(h.to, fine)}</span>
          <b className="text-[14px] text-white">{h.all} decisions</b>{h.stopped > 0 && <span className="text-[#ffb98a]"> · {h.stopped} stopped</span>}
        </div>
      )}
      <ul className="flex gap-4 mt-1 text-[12px] text-[#5e544b]" aria-label="Legend">
        <li className="inline-flex items-center gap-1.5"><span className="w-3 h-[3px] rounded bg-[#e85d0c]" aria-hidden="true" />All decisions</li>
        <li className="inline-flex items-center gap-1.5"><span className="w-2 h-2 rounded-[2px] bg-[#ff6b00]" aria-hidden="true" />Stopped or rewritten</li>
      </ul>
    </div>
  )
}

export function QuickAnalytics({ dg, days, ds }: { dg: ODigest; days: number; ds: ODecision[] | null }) {
  const redact = dg.by_stage.redact || 0
  const counts: Record<Verdict, number> = {
    allowed: Math.max(0, (dg.by_verdict.ALLOW || 0) - redact), rewritten: redact,
    paused: dg.by_verdict.PAUSE || 0, blocked: dg.by_verdict.BLOCK || 0, critical: 0,
  }
  return (
    <Card title="What VIGIL decided" action={<SeeAll href="/decisions" label="See all decisions" />}>
      <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,300px)_minmax(0,1fr)] 2xl:grid-cols-[minmax(0,420px)_minmax(0,1fr)] gap-6 items-center">
        <VerdictRing counts={counts} days={days} />
        <div className="min-w-0">
          <div className="grid grid-cols-2 gap-2 mb-3">
            <Stat first label="Graph time, median" value={dg.graph_queried ? `${dg.graph_ms_p50.toFixed(2)} ms` : '—'} chip={dg.graph_queried ? <Chip>{`p95 ${dg.graph_ms_p95.toFixed(2)}`}</Chip> : null} />
            <Stat label="Decided without a model" value={`${Math.round(dg.model_free_fraction * 100)}%`} chip={<Chip tone="good">{`${dg.graph_queried.toLocaleString()} graph queries`}</Chip>} />
          </div>
          <p className="text-[12.5px] font-medium text-[#6b6158] mb-1">Decisions over time{ds ? `, the ${ds.length} this server holds in memory` : ''}</p>
          {ds && ds.length ? <Area ds={ds} /> : <p className="app-sub py-12 text-center">No decisions in memory yet.</p>}
        </div>
      </div>
    </Card>
  )
}

// ---- The most recent decisions, as a table --------------------------------

export function RecentDecisions({ ds }: { ds: ODecision[] }) {
  const rows = [...ds].sort((a, b) => t(b) - t(a)).slice(0, 7)
  const play = useIntro('recent')
  return (
    <Card title="Recent decisions" action={<SeeAll href="/decisions" label="See all decisions" />}>
      <div className="overflow-x-auto -mx-1">
        <table className={`w-full text-[13px] border-separate border-spacing-y-1 ${play ? 'intro' : ''}`}>
          <caption className="sr-only">The {rows.length} most recent decisions</caption>
          <thead>
            <tr className="text-left text-[12px] text-[#6b6158]">
              {['Session', 'Tool', 'Signal', 'Time', 'Verdict'].map(h => <th key={h} scope="col" className="font-semibold px-2.5 pb-1">{h}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map((d, i) => (
              <tr key={d.id || i} className={`a-rise ${i % 2 === 0 ? 'bg-[#faf7f2]' : ''}`} style={{ ['--d' as string]: `${0.15 + i * 0.07}s` }}>
                <td className="px-2.5 py-2.5 rounded-l-xl font-mono text-[12px] text-[#5e544b]" title={d.agent ? `agent ${d.agent}` : undefined}>{shortSession(d.session_id)}</td>
                <td className="px-2.5 py-2.5 font-mono text-[12.5px] text-[#14100d] max-w-[170px] truncate" title={d.tool}>{d.tool}</td>
                <td className="px-2.5 py-2.5 text-[#5e544b] whitespace-nowrap">{stageLabel(d.stage)}</td>
                <td className="px-2.5 py-2.5 text-[#5e544b] tabular-nums whitespace-nowrap">{clock(t(d))}</td>
                <td className="px-2.5 py-2.5 rounded-r-xl"><VerdictBadge v={vOf(d)} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  )
}

// ---- Why calls were stopped: one bar per graph signal ----------------------

export function StopSignals({ dg, days }: { dg: ODigest; days: number }) {
  const rows = Object.entries(dg.by_stage).filter(([s]) => s !== 'default').sort((a, b) => b[1] - a[1])
  const total = rows.reduce((a, [, n]) => a + n, 0)
  const play = useIntro('bars')
  return (
    <Card title="Why calls were stopped">
      {rows.length === 0 ? <p className="app-sub">Nothing was stopped in the last {days} days.</p> : (
        <>
        <SignalRadar byStage={dg.by_stage} />
        <ul className={`space-y-3.5 mt-4 ${play ? 'intro' : ''}`}>
          {rows.map(([s, n], i) => (
            <li key={s}>
              <p className="text-[12.5px] text-[#5e544b] mb-1">{stageLabel(s)}</p>
              <div className="flex items-center gap-2.5">
                <div className="flex-1 h-3.5 rounded-full bg-[#f1ede7] overflow-hidden" aria-hidden="true">
                  <div className="h-full rounded-full a-grow" style={{ width: `${Math.max(4, (n / rows[0][1]) * 100)}%`, background: i === 0 ? '#ff6b00' : '#a89a8b', ['--d' as string]: `${0.5 + i * 0.1}s` }} />
                </div>
                <span className="w-16 text-right text-[12.5px] tabular-nums text-[#14100d]"><b>{n}</b> <span className="text-[#6b6158]">{Math.round((n / total) * 100)}%</span></span>
              </div>
            </li>
          ))}
        </ul>
        </>
      )}
    </Card>
  )
}

// ---- The latest stops, as an activity list --------------------------------

export function RecentStops({ ds }: { ds: ODecision[] }) {
  const rows = ds.filter(d => vOf(d) !== 'allowed').sort((a, b) => t(b) - t(a)).slice(0, 6)
  const play = useIntro('stops')
  return (
    <Card title="Latest stops" action={<SeeAll href="/decisions" label="See all stopped calls" />}>
      {rows.length === 0 ? <p className="app-sub">Nothing stopped among the decisions in memory.</p> : (
        <ul className={`space-y-3 ${play ? 'intro' : ''}`}>
          {rows.map((d, i) => {
            const v: Verdict = vOf(d), Icon = ICON[v]
            return (
              <li key={d.id || i} className="flex items-start gap-3 a-rise" style={{ ['--d' as string]: `${0.3 + i * 0.08}s` }}>
                <span className={`grid place-items-center w-9 h-9 rounded-full shrink-0 v-${v}`} aria-hidden="true"><Icon className="w-4 h-4" /></span>
                <div className="min-w-0 flex-1">
                  <p className="text-[13.5px] font-semibold leading-snug text-[#14100d]">{stageLabel(d.stage)}</p>
                  <p className="mt-1 flex items-center gap-2 text-[12px] text-[#6b6158] min-w-0">
                    <VerdictBadge v={v} /><span className="font-mono truncate" title={d.tool}>{d.tool}</span>
                  </p>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </Card>
  )
}
