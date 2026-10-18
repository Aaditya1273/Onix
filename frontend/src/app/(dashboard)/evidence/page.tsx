'use client'

import { useMemo, useState } from 'react'
import { useResource, type Resource } from '@/lib/useResource'
import { ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'
import { VERDICT, stageLabel, verdictOf, type Verdict } from '@/lib/verdict'
import { AXIS, ChartCard, GRID, Mark, Tip, tipProps, useWidth, type TipState } from './charts'
import { QuickAnalytics, RecentDecisions, RecentStops, StopSignals } from './overview'
import { CutPaths, RadialBurst, Ridges, Sankey } from './forms'
import { usePageTab } from '@/lib/usePageTab'
import { useIntro } from '@/lib/useIntro'

// Every number on this page is read from the control plane: the 7-day totals
// from the graph's decision log (GET /api/v1/vigil/digest), the charts from
// the decisions this server holds in memory (GET /api/v1/vigil/decisions).
// The two populations are labelled separately and never mixed in one figure.

interface Cut { max_flow: number; terminal: boolean; redact: string[] | null; ms: number }
interface Decision {
  id?: string; decision: string; stage: string; tool: string; session_id: string; agent?: string; reason?: string
  at: string; graph_ms: number; graph_queried: boolean; graph_paths?: string[] | null; cut?: Cut | null
}
interface Digest {
  decisions: number; by_verdict: Record<string, number>; by_stage: Record<string, number>
  model_free_fraction: number; graph_queried: number; graph_ms_p50: number; graph_ms_p95: number; chain_links: number; chain_broken: number
}
interface DigestReply { days: number; observe_mode: boolean; trust_threshold: number; digest: Digest }

const ORDER: Verdict[] = ['allowed', 'rewritten', 'paused', 'blocked']
const vOf = (d: Decision) => verdictOf(d.decision, d.stage)
const ns = (d: Decision) => Date.parse(d.at)
const shortSession = (s: string) => s.replace(/^(cc|codex|gem|pg)-/, '').split('-').pop()!.slice(-8)
const pct = (n: number, of: number) => (of ? `${((n / of) * 100).toFixed(n / of < 0.1 ? 1 : 0)}%` : '—')

function fmtSpan(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 120000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
  if (ms < 7200000) return `${Math.round(ms / 60000)} min`
  if (ms < 172800000) return `${(ms / 3600000).toFixed(1)} h`
  return `${(ms / 86400000).toFixed(1)} days`
}
const fmtTime = (ms: number, span = 0) => new Date(ms).toLocaleString(undefined, span > 86400000 || new Date(ms).toDateString() !== new Date().toDateString()
  ? { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' } : { hour: '2-digit', minute: '2-digit', second: '2-digit' })

// ---- 1. sessions over time: one lane per session, the leak drawn across lanes

const MAX_LANES = 12
const OTHER = '\u0000other'

function Swimlane({ ds, arcs }: { ds: Decision[]; arcs: Arc[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const play = useIntro('swimlane')
  // Decisions evenly spaced in the order they happened, so calls milliseconds
  // apart stay readable; the real time is in each tooltip and in the table.
  const order = useMemo(() => [...ds].sort((a, b) => ns(a) - ns(b)), [ds])
  const rank = new Map(order.map((d, i) => [d, i]))
  const t0 = ns(order[0]), span = ns(order[order.length - 1]) - t0
  // Lanes for sessions with a stopped call or a leak path (most recent first);
  // every other session shares one lane, so 40 quiet sessions don't bury the story.
  const interesting = [...new Set([...order].reverse().filter(d => vOf(d) !== 'allowed').map(d => d.session_id).concat(arcs.map(a => a.from.session_id)))].slice(0, MAX_LANES).reverse()
  const others = new Set(order.map(d => d.session_id).filter(s => !interesting.includes(s)))
  const lanes = others.size ? [...interesting, OTHER] : interesting
  const laneOf = (s: string) => lanes.indexOf(interesting.includes(s) ? s : OTHER)
  const narrow = W < 560
  const L = narrow ? 92 : 168, R = 16, TOP = 8, LH = narrow ? 46 : 58, H = TOP + lanes.length * LH + 44
  // Decisions stay in order, but the sessions with a stop or a leak get five times
  // the width of a quiet decision, so the story is not squeezed into one corner.
  const weight = order.map(d => (interesting.includes(d.session_id) ? 5 : 1))
  const total = weight.reduce((a, w) => a + w, 0)
  const cum: number[] = []; weight.reduce((a, w, i) => { cum[i] = a + w / 2; return a + w }, 0)
  const xi = (i: number) => L + (order.length < 2 ? 0.5 : cum[i] / total) * (W - L - R)
  const atFrac = (f: number) => { let best = 0; cum.forEach((c, i) => { if (Math.abs(c / total - f) < Math.abs(cum[best] / total - f)) best = i }); return best }
  const x = (d: Decision) => xi(rank.get(d)!)
  const y = (d: Decision) => TOP + laneOf(d.session_id) * LH + LH / 2
  const laneLabel = (s: string) => s === OTHER ? (narrow ? `+${others.size} more` : `${others.size} other session${others.size === 1 ? '' : 's'}`) : narrow ? shortSession(s) : `session ${shortSession(s)}`
  const ticks = narrow ? [0, 1] : [0, 0.25, 0.5, 0.75, 1]
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" className={play ? 'intro' : undefined} aria-label={`${order.length} decisions in ${lanes.length} lanes; stopped calls are focusable`}>
          {lanes.map((s, i) => (
            <g key={s}>
              <rect x={L} y={TOP + i * LH + 5} width={W - L - R} height={LH - 10} rx={10} fill={i % 2 ? '#faf7f2' : '#f5f1ea'} />
              <text x={L - 14} y={TOP + i * LH + LH / 2 - (s === OTHER || narrow ? -4 : 3)} textAnchor="end" fontSize={13} fontWeight={600} fill={s === OTHER ? AXIS : '#14100d'}>{laneLabel(s)}</text>
              {s !== OTHER && !narrow && (() => { const n = order.filter(d => d.session_id === s && vOf(d) !== 'allowed').length; return n ? <text x={L - 14} y={TOP + i * LH + LH / 2 + 13} textAnchor="end" fontSize={11.5} fill={VERDICT.blocked.ink}>{n} stopped</text> : null })()}
            </g>
          ))}
          {ticks.map(f => {
            const i = f === 0 ? 0 : f === 1 ? order.length - 1 : atFrac(f), tx = f === 0 || f === 1 ? L + f * (W - L - R) : xi(i)
            return (
              <g key={f}>
                <line x1={tx} x2={tx} y1={TOP} y2={H - 34} stroke={GRID} />
                <text x={tx} y={H - 12} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={12} fill={AXIS}>
                  {narrow ? `#${i + 1}` : f === 0 ? `#1 · ${fmtTime(t0, span)}` : f === 1 ? `#${order.length} · ${fmtTime(ns(order[order.length - 1]), span)}` : `#${i + 1}`}
                </text>
              </g>
            )
          })}
          {arcs.map(({ from, to }, i) => {
            const x1 = x(from), y1 = y(from), x2 = x(to), y2 = y(to), mx = (x1 + x2) / 2
            return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={VERDICT[vOf(to)].mark} strokeWidth={2.5} strokeDasharray="6 5" className="a-fade" style={{ ['--d' as string]: `${1.5 + i * 0.25}s` }} />
          })}
          {order.map((d, i) => {
            const v = vOf(d), stop = v !== 'allowed', cx = x(d), cy = y(d)
            const body = <><b className="font-mono">{d.tool}</b><br />{VERDICT[v].label} · {stageLabel(d.stage)}<br />session {shortSession(d.session_id)} · decision #{i + 1} · {fmtTime(ns(d), span)}<br />{d.graph_queried ? `${d.graph_ms.toFixed(2)} ms in the graph` : 'graph not queried'}</>
            const label = `${VERDICT[v].label}: ${d.tool} in session ${shortSession(d.session_id)}, ${stageLabel(d.stage)}`
            const pop = { className: 'a-pop', style: { ['--d' as string]: `${0.1 + ((cx - L) / Math.max(1, W - L - R)) * 1.3}s` } }
            return stop
              ? <g key={i} {...tipProps(setTip, cx, cy - 6, label, body)} {...pop}><Mark v={v} x={cx} y={cy} s={7} /></g>
              : <g key={i} onMouseEnter={() => setTip({ x: cx, y: cy - 4, body })} {...pop}><Mark v={v} x={cx} y={cy} s={4} /></g>
          })}
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  )
}

// A leak's path: the read in one session that a stopped call in another carried.
interface Arc { from: Decision; to: Decision; readTool: string }
function leakArcs(ds: Decision[]): Arc[] {
  const sessions = new Set(ds.map(d => d.session_id))
  return ds.filter(d => vOf(d) !== 'allowed').flatMap(d => {
    const m = (d.graph_paths || []).map(p => p.match(/^session (\S+) --\[READ by (\S+)\]/)).find(Boolean)
    if (!m || m[1] === d.session_id || !sessions.has(m[1])) return []
    const reads = ds.filter(r => r.session_id === m[1] && r.tool === m[2] && ns(r) <= ns(d)).sort((a, b) => ns(b) - ns(a))
    const from = reads[0] || ds.find(r => r.session_id === m[1])
    return from ? [{ from, to: d, readTool: m[2] }] : []
  })
}

// ---- 2. verdicts over time: stacked columns, equal time slices -------------


// ---- 3. what stopped them: bars by graph signal and verdict ----------------

function stopRows(ds: Decision[]) {
  const m = new Map<string, { stage: string; v: Verdict; n: number }>()
  ds.filter(d => vOf(d) !== 'allowed').forEach(d => {
    const k = `${d.stage}|${vOf(d)}`
    m.set(k, { stage: d.stage, v: vOf(d), n: (m.get(k)?.n || 0) + 1 })
  })
  return [...m.values()].sort((a, b) => b.n - a.n)
}


// ---- 4. graph time: histogram on doubling buckets, p50 / p95 marked --------

const EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, Infinity]
const bucket = (i: number) => `${EDGES[i]}–${EDGES[i + 1] === Infinity ? '…' : EDGES[i + 1]} ms`


// ---- 5. the cheapest cut: one bar per call that carried a secret ------------


// ---- page sections ----------------------------------------------------------




function Charts({ ds, part }: { ds: Decision[]; part: string }) {
  const order = useMemo(() => [...ds].sort((a, b) => ns(a) - ns(b)), [ds])
  const arcs = useMemo(() => leakArcs(order), [order])
  const rows = useMemo(() => stopRows(order), [order])
  const graphMs = useMemo(() => order.filter(d => d.graph_queried).map(d => d.graph_ms), [order])
  const cuts = order.filter(d => d.cut && d.cut.max_flow > 0)
  const t0 = ns(order[0]), span = ns(order[order.length - 1]) - t0
  const present = ORDER.filter(v => order.some(d => vOf(d) === v))
  return (
    <>
      {part === 'sessions' && <ChartCard title="Every session, every decision"
        sub="One lane per session with a stopped call; quiet sessions share the last lane. Decisions run in the order they happened, with the stopped sessions given more room. A dashed line joins a read in one session to the stopped call in another session that carried what it read."
        legend={present}
        table={{
          caption: 'Every decision in order', head: ['#', 'Time', 'Session', 'Tool', 'Verdict', 'Signal', 'Graph ms'],
          rows: order.map((d, i) => [i + 1, fmtTime(ns(d), span), <span key="s" className="font-mono">{shortSession(d.session_id)}</span>, <span key="t" className="font-mono">{d.tool}</span>, <VerdictBadge key="v" v={vOf(d)} />, stageLabel(d.stage), d.graph_queried ? d.graph_ms.toFixed(2) : '—']),
        }}>
        <Swimlane ds={order} arcs={arcs} />
        {arcs.length > 0 && (
          <div className="mt-8">
            <h4 className="app-h3">Leaks across sessions <span className="text-[#6b6158] font-normal">({arcs.length})</span></h4>
            <p className="app-sub mt-1">A value read in one session turned up in a call from another. These are the paths no single call reveals.</p>
            <ul className="mt-4 grid grid-cols-1 lg:grid-cols-2 2xl:grid-cols-3 gap-4">
              {arcs.map((a, i) => (
                <li key={i} className="rounded-2xl border border-[#efe6da] bg-[#fffdf9] p-5">
                  <div className="flex items-center justify-between gap-3"><span className="app-label">Path {i + 1}</span><VerdictBadge v={vOf(a.to)} /></div>
                  <div className="mt-3 grid grid-cols-[auto_1fr] gap-x-3 gap-y-2 text-[13.5px] items-baseline">
                    <span className="app-meta">read</span><span><span className="font-mono">{a.readTool}</span> in session <b className="font-mono">{shortSession(a.from.session_id)}</b></span>
                    <span className="app-meta">sent by</span><span><span className="font-mono break-all">{a.to.tool}</span> in session <b className="font-mono">{shortSession(a.to.session_id)}</b></span>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>}

      {/* Each tab: forms sized to their data instead of a stretched grid. */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {part === 'signals' && <>
        <ChartCard className="lg:col-span-5 2xl:col-span-4" title="Every decision, as a ring of time" sub="One ray per decision, clockwise from the oldest. Stopped and rewritten calls are the long coloured rays; hover or focus one for the call." legend={present}
          table={{ caption: 'Decisions by verdict', head: ['Verdict', 'Decisions', 'Share'], rows: ORDER.map(v => { const n = order.filter(d => vOf(d) === v).length; return [<VerdictBadge key="v" v={v} />, n, pct(n, order.length)] }) }}>
          <RadialBurst ds={order} />
        </ChartCard>
        <ChartCard className="lg:col-span-7 2xl:col-span-8" title="From graph signal to verdict" sub="Every stopped or rewritten call, flowing from the graph signal that decided it to what VIGIL did. Ribbon width is the number of calls."
          table={{ caption: 'Stopped calls by signal', head: ['Signal', 'Verdict', 'Calls'], rows: rows.map(r => [stageLabel(r.stage), <VerdictBadge key="v" v={r.v} />, r.n]) }}>
          <Sankey ds={order} />
        </ChartCard>
        </>}
        {part === 'timing' && <>
        <ChartCard className="lg:col-span-7" title="How long the graph took, per tool" sub={`Graph time of the ${graphMs.length} decisions that queried the graph, one ridge per tool on a log scale, in 3D: drag it, or focus it and use the arrow keys, to turn it. Hover a ridge for its median.`}
          table={{ caption: 'Graph time buckets', head: ['Bucket', 'Decisions'], rows: EDGES.slice(0, -1).map((lo, i) => [bucket(i), graphMs.filter(v => v >= lo && v < EDGES[i + 1]).length]) }}>
          <Ridges ds={order} />
        </ChartCard>
        <ChartCard className="lg:col-span-5" title="Where the cut fell" sub={<>For each call that carried a secret, FalkorDB&apos;s <span className="font-mono">algo.maxFlow</span> found the cheapest cut. Cutting one argument rewrites the call; cutting the call blocks it.</>}
          table={{ caption: 'Min-cut per call', head: ['Tool', 'Verdict', 'Max-flow', 'Cut'], rows: cuts.map(d => [<span key="t" className="font-mono">{d.tool}</span>, <VerdictBadge key="v" v={vOf(d)} />, d.cut!.max_flow, d.cut!.terminal ? 'the call itself' : (d.cut!.redact || []).join(', ')]) }}>
          <CutPaths cs={cuts} />
        </ChartCard>
        </>}
      </div>
    </>
  )
}

export default function EvidencePage() {
  const digest = useResource<DigestReply>('/api/v1/vigil/digest?days=7', { intervalMs: 60000 })
  const log = useResource<{ decisions: Decision[] }>('/api/v1/vigil/decisions?limit=500', { intervalMs: 30000 })
  const logData = useMemo(() => log.data && { decisions: (log.data.decisions || []).filter(d => d.at) }, [log.data])
  const clean: Resource<{ decisions: Decision[] }> = { ...log, data: logData }
  const dg = digest.data?.digest
  const tab = usePageTab('/evidence')

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>What VIGIL decided, and why</h1>
      <p>Every figure is read from this deployment&apos;s decision log; on the hosted demo it comes from the demo sessions the server runs once on start.</p>

      {dg && dg.chain_broken > 0 && (
        <div className="app-banner app-banner-error mt-6" role="alert">
          <VerdictBadge v="critical" solid />
          <span><b>{dg.chain_broken} broken link{dg.chain_broken === 1 ? '' : 's'} in the decision chain.</b> Each decision names the hash of the one before it; a broken link means a decision was dropped or changed after it was recorded, so this log can no longer be taken at face value. Export the ledger from the Risk page and check it with <span className="font-mono">vigil-cli verify-ledger</span>.</span>
        </div>
      )}

      {tab === 'summary' && <div className="mt-6">
        <ResourceGate r={digest} loading="Reading the decision log…" isEmpty={r => r.digest.decisions === 0}
          empty={<StatePanel kind="empty" title="No decisions in the last 7 days">VIGIL has not decided any tool call on this deployment in that window. Connect an agent or run an attack in the Playground.</StatePanel>}>
          {r => (
            <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_340px] 2xl:grid-cols-[minmax(0,1fr)_380px] gap-6 items-start">
              <div className="space-y-6 min-w-0">
                <QuickAnalytics dg={r.digest} days={r.days} ds={clean.data?.decisions ?? null} />
                {clean.data && clean.data.decisions.length > 0 && <RecentDecisions ds={clean.data.decisions} />}
              </div>
              <div className="space-y-6 min-w-0">
                <StopSignals dg={r.digest} days={r.days} />
                {clean.data && <RecentStops ds={clean.data.decisions} />}
              </div>
            </div>
          )}
        </ResourceGate>
      </div>}

      {tab !== 'summary' && <section aria-labelledby="log-h" className="mt-6">
        <h2 id="log-h" className="app-h2">The decision log, charted</h2>
        <ResourceGate r={clean} loading="Reading recent decisions…" isEmpty={x => x.decisions.length === 0}
          empty={<StatePanel kind="empty" title="No decisions in memory">This server has not decided any tool call since it started. The 7-day totals above come from the graph and are kept across restarts.</StatePanel>}>
          {x => {
            const ts = x.decisions.map(ns), from = Math.min(...ts), to = Math.max(...ts)
            return (
              <>
                <p className="app-sub mt-1 mb-4">
                  The {x.decisions.length} most recent decisions this server holds in memory, {fmtTime(from, to - from)} to {fmtTime(to, to - from)} ({fmtSpan(to - from)}). They are a subset of the 7-day totals above. Refreshes every 30 seconds{clean.loadedAt ? `; last read ${new Date(clean.loadedAt).toLocaleTimeString()}` : ''}.
                </p>
                <Charts ds={x.decisions} part={tab} />
              </>
            )
          }}
        </ResourceGate>
      </section>}
    </div>
  )
}
