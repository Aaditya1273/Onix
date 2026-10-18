'use client'

import { useEffect, useMemo, useState } from 'react'
import { Table2 } from 'lucide-react'

// Every number on this page is read from the control plane's own decision log
// (GET /api/v1/vigil/decisions and /digest): nothing is typed in.

interface Cut { max_flow: number; terminal: boolean; redact: string[] | null; ms: number }
interface Decision {
  id: string; decision: string; stage: string; tool: string; session_id: string; agent: string
  at: string; graph_ms: number; graph_queried: boolean; graph_paths: string[] | null; cut?: Cut | null
}
interface Digest {
  decisions: number; by_verdict: Record<string, number>; by_stage: Record<string, number>
  model_free_fraction: number; graph_ms_p50: number; graph_ms_p95: number; chain_links: number; chain_broken: number
}

// Verdict colors, validated for color-vision deficiency and >= 3:1 on white
// (dataviz validate_palette.js, all pairs). Each keeps its meaning on every chart.
const VERDICTS = ['Allowed', 'Rewritten', 'Paused', 'Blocked'] as const
type Verdict = typeof VERDICTS[number]
const COLOR: Record<Verdict, string> = { Allowed: '#8f8478', Rewritten: '#2c76b0', Paused: '#8a5a12', Blocked: '#e85d0c' }
const verdictOf = (d: { decision: string; stage: string }): Verdict =>
  d.decision === 'BLOCK' ? 'Blocked' : d.decision === 'PAUSE' ? 'Paused' : d.stage === 'redact' ? 'Rewritten' : 'Allowed'
const STAGE_LABEL: Record<string, string> = {
  exfiltration: 'Secret on its way out', provenance: 'Outside content gave an order', tool_drift: 'Tool changed after trust',
  code_graph: 'Look-alike package', entity_policy: 'Shared with a protected person', redact: 'Secret cut from one argument',
  intent: 'Outside declared intent', budget: 'Over budget',
}
const INK = '#14100d', DIM = '#5e544b', FAINT = '#8f8478', GRID = '#ebe4da'
const ns = (d: Decision) => Date.parse(d.at)
const shortSession = (s: string) => s.replace(/^(cc|codex|gem|pg)-/, '').split('-').pop()!.slice(-8)

function fmtSpan(ms: number) {
  if (ms < 1000) return `${Math.round(ms)} ms`
  if (ms < 120000) return `${(ms / 1000).toFixed(ms < 10000 ? 1 : 0)} s`
  if (ms < 7200000) return `${Math.round(ms / 60000)} min`
  return `${(ms / 3600000).toFixed(1)} h`
}

// ---- shared chart chrome: title, legend, tooltip, table toggle -------------

function Tip({ tip }: { tip: { x: number; y: number; html: React.ReactNode } | null }) {
  if (!tip) return null
  return (
    <div className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+12px)] rounded-lg bg-[#14100d] px-3 py-2 text-[12.5px] leading-snug text-[#f2ede7] shadow-lg"
      style={{ left: tip.x, top: tip.y }}>{tip.html}</div>
  )
}

function Legend({ items }: { items: Verdict[] }) {
  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-gray-600">
      {items.map(v => <span key={v} className="inline-flex items-center gap-1.5"><span className="w-2.5 h-2.5 rounded-[3px]" style={{ background: COLOR[v] }} />{v}</span>)}
    </div>
  )
}

function Card({ title, sub, legend, table, children, className = '' }: {
  title: string; sub: string; legend?: Verdict[]; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode; className?: string
}) {
  const [asTable, setAsTable] = useState(false)
  return (
    <section className={`rounded-2xl border border-gray-200 bg-white p-5 ${className}`}>
      <div className="flex items-start gap-3">
        <div className="min-w-0">
          <h2 className="font-display text-[17px] font-bold text-gray-900" style={{ letterSpacing: '-0.01em' }}>{title}</h2>
          <p className="text-[13px] text-gray-500 mt-0.5">{sub}</p>
        </div>
        <button type="button" onClick={() => setAsTable(t => !t)} aria-pressed={asTable}
          className="ml-auto shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 px-2.5 py-1.5 text-xs font-medium text-gray-600 hover:border-gray-900 hover:text-gray-900">
          <Table2 className="w-3.5 h-3.5" />{asTable ? 'Show chart' : 'Show as table'}
        </button>
      </div>
      {legend && !asTable && <div className="mt-3"><Legend items={legend} /></div>}
      <div className="mt-3 relative">
        {asTable ? (
          <div className="max-h-[320px] overflow-auto">
            <table className="w-full text-[13px]">
              <thead><tr>{table.head.map(h => <th key={h} className="sticky top-0 bg-white text-left font-medium text-gray-500 py-1.5 pr-4 border-b border-gray-200">{h}</th>)}</tr></thead>
              <tbody>{table.rows.map((r, i) => <tr key={i} className="border-b border-gray-100">{r.map((c, j) => <td key={j} className="py-1.5 pr-4 text-gray-800 tabular-nums">{c}</td>)}</tr>)}</tbody>
            </table>
          </div>
        ) : children}
      </div>
    </section>
  )
}

// ---- 1. sessions over time: one lane per session, the leak drawn across lanes

function Swimlane({ ds }: { ds: Decision[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null)
  // Decisions laid out in the order they happened, evenly spaced: calls milliseconds
  // apart stay readable. The real elapsed time is in each tooltip.
  const order = [...ds].sort((a, b) => ns(a) - ns(b))
  const rank = new Map(order.map((d, i) => [d.id, i]))
  const t0 = ns(order[0])
  const lanes = [...new Set(order.map(d => d.session_id))]
  const W = 1000, L = 92, R = 16, TOP = 8, LH = 30, H = TOP + lanes.length * LH + 34
  const xi = (i: number) => L + (order.length < 2 ? 0.5 : i / (order.length - 1)) * (W - L - R)
  const x = (d: Decision) => xi(rank.get(d.id)!)
  const y = (s: string) => TOP + lanes.indexOf(s) * LH + LH / 2
  // A leak's path: the read in one session that a blocked call in another carried.
  const arcs = ds.filter(d => verdictOf(d) !== 'Allowed').flatMap(d => {
    const m = (d.graph_paths || []).map(p => p.match(/^session (\S+) --\[READ by (\S+)\]/)).find(Boolean)
    if (!m || m[1] === d.session_id || !lanes.includes(m[1])) return []
    const reads = ds.filter(r => r.session_id === m[1] && r.tool === m[2] && ns(r) <= ns(d)).sort((a, b) => ns(b) - ns(a))
    const from = reads[0] || ds.find(r => r.session_id === m[1])
    return from ? [{ from, to: d }] : []
  })
  const ticks = [0, 0.25, 0.5, 0.75, 1].map(f => ({ f, label: String(Math.round(f * (order.length - 1)) + 1) }))
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Every decision, one lane per session, over time">
        {lanes.map((s, i) => (
          <g key={s}>
            <rect x={L} y={TOP + i * LH + 3} width={W - L - R} height={LH - 6} rx={6} fill={i % 2 ? '#faf7f3' : '#f5f1ea'} />
            <text x={L - 10} y={y(s) + 4} textAnchor="end" fontSize={11.5} fill={DIM}>session {shortSession(s)}</text>
          </g>
        ))}
        {ticks.map(t => (
          <g key={t.f}>
            <line x1={L + t.f * (W - L - R)} x2={L + t.f * (W - L - R)} y1={TOP} y2={H - 26} stroke={GRID} />
            <text x={L + t.f * (W - L - R)} y={H - 10} textAnchor={t.f === 0 ? 'start' : t.f === 1 ? 'end' : 'middle'} fontSize={11} fill={FAINT}>{t.f === 0 ? 'decision 1' : t.f === 1 ? `decision ${order.length}` : t.label}</text>
          </g>
        ))}
        {arcs.map(({ from, to }, i) => {
          const x1 = x(from), y1 = y(from.session_id), x2 = x(to), y2 = y(to.session_id)
          const mx = (x1 + x2) / 2
          return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={COLOR.Blocked} strokeWidth={2} strokeDasharray="5 4" opacity={0.9} />
        })}
        {ds.map(d => {
          const v = verdictOf(d), big = v !== 'Allowed'
          return (
            <circle key={d.id} cx={x(d)} cy={y(d.session_id)} r={big ? 6.5 : 4.5} fill={COLOR[v]} stroke="#fff" strokeWidth={2}
              onMouseMove={e => {
                const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
                setTip({ x: e.clientX - r.left, y: e.clientY - r.top, html: <><b className="font-mono">{d.tool}</b><br />{v} · {STAGE_LABEL[d.stage] || d.stage}<br />decision {rank.get(d.id)! + 1} · +{fmtSpan(ns(d) - t0)} · {d.graph_ms.toFixed(1)} ms graph</> })
              }} />
          )
        })}
      </svg>
      <Tip tip={tip} />
      {arcs.length > 0 && <p className="text-[12.5px] text-gray-500 mt-1"><span className="inline-block w-5 border-t-2 border-dashed align-middle mr-1.5" style={{ borderColor: COLOR.Blocked }} />the read in one session that a stopped call in another session carried ({arcs.length})</p>}
    </div>
  )
}

// ---- 2. verdicts over time: stacked columns, equal time slices -------------

function Columns({ ds }: { ds: Decision[] }) {
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null)
  const N = 18, t0 = Math.min(...ds.map(ns)), t1 = Math.max(...ds.map(ns)) + 1
  const bins = Array.from({ length: N }, () => Object.fromEntries(VERDICTS.map(v => [v, 0])) as Record<Verdict, number>)
  ds.forEach(d => { bins[Math.min(N - 1, Math.floor(((ns(d) - t0) / (t1 - t0)) * N))][verdictOf(d)]++ })
  const max = Math.max(1, ...bins.map(b => VERDICTS.reduce((s, v) => s + b[v], 0)))
  const W = 480, H = 220, L = 30, B = 26, T = 8, bw = (W - L - 8) / N
  const yv = (n: number) => T + (1 - n / max) * (H - T - B)
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="Decisions per time slice by verdict">
        {[0, 0.5, 1].map(f => <g key={f}><line x1={L} x2={W - 8} y1={yv(max * f)} y2={yv(max * f)} stroke={GRID} /><text x={L - 6} y={yv(max * f) + 4} textAnchor="end" fontSize={10.5} fill={FAINT}>{Math.round(max * f)}</text></g>)}
        {bins.map((b, i) => {
          let acc = 0
          return (
            <g key={i} onMouseMove={e => {
              const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
              setTip({ x: e.clientX - r.left, y: e.clientY - r.top, html: <>{VERDICTS.filter(v => b[v]).map(v => <div key={v}>{v}: {b[v]}</div>)}{!VERDICTS.some(v => b[v]) && 'No decisions'}</> })
            }}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {VERDICTS.map(v => {
                const n = b[v]; if (!n) return null
                const y0 = yv(acc), y1 = yv(acc + n); acc += n
                return <rect key={v} x={L + i * bw + 2} y={y1 + 1} width={bw - 4} height={Math.max(1, y0 - y1 - 2)} rx={2} fill={COLOR[v]} />
              })}
            </g>
          )
        })}
        <text x={L} y={H - 8} fontSize={10.5} fill={FAINT}>first call</text>
        <text x={W - 8} y={H - 8} textAnchor="end" fontSize={10.5} fill={FAINT}>+{fmtSpan(t1 - t0)}</text>
      </svg>
      <Tip tip={tip} />
    </div>
  )
}

// ---- 3. what stopped them: horizontal bars by graph signal -----------------

function Stages({ ds }: { ds: Decision[] }) {
  const stops = ds.filter(d => verdictOf(d) !== 'Allowed')
  const rows = Object.entries(stops.reduce((m, d) => ({ ...m, [d.stage]: (m[d.stage] || 0) + 1 }), {} as Record<string, number>)).sort((a, b) => b[1] - a[1])
  const max = Math.max(1, ...rows.map(r => r[1]))
  if (!rows.length) return <p className="text-sm text-gray-400 py-8 text-center">Nothing was stopped in this window.</p>
  return (
    <div className="space-y-2.5">
      {rows.map(([stage, n]) => {
        const v = verdictOf(stops.find(d => d.stage === stage)!)
        return (
          <div key={stage} className="grid grid-cols-[minmax(0,190px)_1fr_28px] items-center gap-3 text-[13px]" title={`${n} ${v.toLowerCase()}`}>
            <span className="text-gray-700 truncate">{STAGE_LABEL[stage] || stage}</span>
            <div className="h-5 rounded-[4px] bg-[#f5f1ea]"><div className="h-full rounded-[4px]" style={{ width: `${(n / max) * 100}%`, background: COLOR[v] }} /></div>
            <span className="text-right font-semibold tabular-nums text-gray-900">{n}</span>
          </div>
        )
      })}
    </div>
  )
}

// ---- 4. decision time: histogram on doubling buckets, p50 / p95 marked ------

const EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, Infinity]
function Latency({ ds, p50, p95 }: { ds: Decision[]; p50: number; p95: number }) {
  const [tip, setTip] = useState<{ x: number; y: number; html: React.ReactNode } | null>(null)
  const q = ds.filter(d => d.graph_queried)
  const counts = EDGES.slice(0, -1).map((lo, i) => q.filter(d => d.graph_ms >= lo && d.graph_ms < EDGES[i + 1]).length)
  const max = Math.max(1, ...counts), n = counts.length
  const W = 480, H = 220, L = 30, B = 30, T = 18, bw = (W - L - 8) / n
  const pos = (ms: number) => { // position of a value on the doubling axis
    const i = EDGES.findIndex((e, k) => ms >= e && ms < EDGES[k + 1]); if (i < 0) return W - 8
    const lo = EDGES[i], hi = EDGES[i + 1] === Infinity ? lo * 2 : EDGES[i + 1]
    return L + (i + (lo === 0 ? ms / hi : Math.log2(ms / lo) / Math.log2(hi / lo))) * bw
  }
  return (
    <div className="relative" onMouseLeave={() => setTip(null)}>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto" role="img" aria-label="How long the graph took per decision">
        {[0, 0.5, 1].map(f => <g key={f}><line x1={L} x2={W - 8} y1={T + (1 - f) * (H - T - B)} y2={T + (1 - f) * (H - T - B)} stroke={GRID} /><text x={L - 6} y={T + (1 - f) * (H - T - B) + 4} textAnchor="end" fontSize={10.5} fill={FAINT}>{Math.round(max * f)}</text></g>)}
        {counts.map((c, i) => {
          const h = (c / max) * (H - T - B)
          return (
            <g key={i} onMouseMove={e => {
              const r = (e.currentTarget.ownerSVGElement!.parentElement as HTMLElement).getBoundingClientRect()
              setTip({ x: e.clientX - r.left, y: e.clientY - r.top, html: <>{c} decision{c === 1 ? '' : 's'}<br />{EDGES[i]}–{EDGES[i + 1] === Infinity ? '…' : EDGES[i + 1]} ms</> })
            }}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {c > 0 && <rect x={L + i * bw + 2} y={H - B - h} width={bw - 4} height={h} rx={3} fill={DIM} />}
              <text x={L + i * bw + bw / 2} y={H - B + 14} textAnchor="middle" fontSize={10} fill={FAINT}>{EDGES[i] < 1 ? EDGES[i] : EDGES[i]}</text>
            </g>
          )
        })}
        {[['p50', p50], ['p95', p95]].map(([k, v]) => (
          <g key={k as string}>
            <line x1={pos(v as number)} x2={pos(v as number)} y1={T - 6} y2={H - B} stroke={COLOR.Blocked} strokeWidth={2} strokeDasharray="4 3" />
            <text x={pos(v as number) + 4} y={T + 2} fontSize={11} fontWeight={600} fill={INK}>{k} {(v as number).toFixed(1)} ms</text>
          </g>
        ))}
        <text x={W - 8} y={H - 2} textAnchor="end" fontSize={10.5} fill={FAINT}>ms of graph time, doubling buckets</text>
      </svg>
      <Tip tip={tip} />
    </div>
  )
}

// ---- 5. the cheapest cut: one bar per call that carried a secret ------------

function Cuts({ ds }: { ds: Decision[] }) {
  const cs = ds.filter(d => d.cut && d.cut.max_flow > 0)
  if (!cs.length) return <p className="text-sm text-gray-400 py-8 text-center">No call carried a secret in this window.</p>
  const max = Math.max(...cs.map(d => d.cut!.max_flow))
  return (
    <div className="space-y-3">
      {cs.map(d => {
        const v = verdictOf(d), what = d.cut!.terminal ? 'the call itself' : `argument ${(d.cut!.redact || []).join(', ')}`
        return (
          <div key={d.id} className="text-[13px]">
            <div className="flex justify-between gap-3"><span className="font-mono text-gray-800 truncate">{d.tool}</span><span className="text-gray-500 shrink-0">cut: {what}</span></div>
            <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-3">
              <div className="h-5 rounded-[4px] bg-[#f5f1ea]"><div className="h-full rounded-[4px]" style={{ width: `${(d.cut!.max_flow / max) * 100}%`, background: COLOR[v] }} /></div>
              <span className="font-semibold tabular-nums text-gray-900">{d.cut!.max_flow}</span>
            </div>
          </div>
        )
      })}
      <p className="text-[12.5px] text-gray-500">Bar length is the max-flow FalkorDB&apos;s <span className="font-mono">algo.maxFlow</span> returned: the capacity of the cheapest cut between the secret and the call. When cutting one argument is cheaper than cutting the call, VIGIL rewrites instead of blocking.</p>
    </div>
  )
}

// ---- page -------------------------------------------------------------------

function Kpi({ value, label, note, tone }: { value: string; label: string; note?: string; tone?: string }) {
  return (
    <div className="rounded-2xl border border-gray-200 bg-white px-5 py-4">
      <div className="font-display text-[34px] font-bold leading-none tabular-nums" style={{ color: tone || INK, letterSpacing: '-0.03em' }}>{value}</div>
      <div className="mt-2 text-[13px] font-medium text-gray-700">{label}</div>
      {note && <div className="text-[12px] text-gray-400 mt-0.5">{note}</div>}
    </div>
  )
}

export default function EvidencePage() {
  const [ds, setDs] = useState<Decision[]>([])
  const [dg, setDg] = useState<Digest | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    Promise.all([
      fetch('/api/v1/vigil/decisions?limit=500', { cache: 'no-store' }).then(r => r.json()),
      fetch('/api/v1/vigil/digest?days=7', { cache: 'no-store' }).then(r => r.json()),
    ]).then(([a, b]) => { setDs((a.decisions || []).filter((d: Decision) => d.at)); setDg(b.digest) })
      .catch(() => setErr('The control plane is not reachable (free hosting sleeps when idle). Reload in a minute.'))
  }, [])

  const stops = useMemo(() => ds.filter(d => verdictOf(d) !== 'Allowed'), [ds])
  const ready = ds.length > 0 && dg

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1 className="text-gray-900">What the graph decided, in numbers</h1>
      <p className="text-gray-500 mt-2 max-w-3xl">Every chart is drawn from VIGIL&apos;s decision log in FalkorDB on this deployment, read when you opened the page. The current data comes from the demo sessions the server plays on start.</p>

      {err && <div className="mt-6 rounded-xl border border-orange-200 bg-orange-50 px-4 py-3 text-sm text-orange-800">{err}</div>}
      {!ready && !err && <div className="mt-8 text-gray-400">Reading the decision log…</div>}

      {ready && (
        <>
          <div className="mt-8 grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi value={dg!.decisions.toLocaleString()} label="Decisions" note="last 7 days" />
            <Kpi value={stops.length.toLocaleString()} label="Stopped or rewritten" note={`${((stops.length / Math.max(1, ds.length)) * 100).toFixed(1)}% of calls`} tone={COLOR.Blocked} />
            <Kpi value={`${(dg!.model_free_fraction * 100).toFixed(0)}%`} label="Decided without a model" note="graph queries only" />
            <Kpi value={`${dg!.graph_ms_p50.toFixed(1)} ms`} label="Graph time, median" note={`p95 ${dg!.graph_ms_p95.toFixed(1)} ms`} />
            <Kpi value={`${dg!.chain_links}/${dg!.chain_links + dg!.chain_broken}`} label="Decision chain intact" note={dg!.chain_broken ? `${dg!.chain_broken} broken` : 'no broken links'} />
          </div>

          <div className="mt-4">
            <Card title="Every session, every decision" sub="One lane per session, decisions in the order they happened. Each dot is a tool call VIGIL decided; a dashed line joins the read in one session to the stopped call in another that carried what it read."
              legend={[...VERDICTS]}
              table={{ head: ['Session', 'Time', 'Tool', 'Verdict', 'Stage', 'Graph ms'], rows: [...ds].sort((a, b) => ns(a) - ns(b)).map(d => [shortSession(d.session_id), '+' + fmtSpan(ns(d) - ns([...ds].sort((a, b) => ns(a) - ns(b))[0])), d.tool, verdictOf(d), d.stage, d.graph_ms.toFixed(2)]) }}>
              <Swimlane ds={ds} />
            </Card>
          </div>

          <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
            <Card title="Verdicts over time" sub="Decisions per equal slice of the window, stacked by verdict." legend={[...VERDICTS]}
              table={{ head: ['Verdict', 'Decisions'], rows: VERDICTS.map(v => [v, ds.filter(d => verdictOf(d) === v).length]) }}>
              <Columns ds={ds} />
            </Card>
            <Card title="What stopped them" sub="Stopped and rewritten calls, by the graph signal that decided them."
              table={{ head: ['Signal', 'Calls', 'Verdict'], rows: Object.entries(stops.reduce((m, d) => ({ ...m, [d.stage]: (m[d.stage] || 0) + 1 }), {} as Record<string, number>)).map(([s, n]) => [STAGE_LABEL[s] || s, n, verdictOf(stops.find(d => d.stage === s)!)]) }}>
              <Stages ds={ds} />
            </Card>
            <Card title="How long the graph took" sub="Graph time per decision, on doubling buckets. Dashed lines mark the median and 95th percentile."
              table={{ head: ['Bucket (ms)', 'Decisions'], rows: EDGES.slice(0, -1).map((lo, i) => [`${lo}–${EDGES[i + 1] === Infinity ? '…' : EDGES[i + 1]}`, ds.filter(d => d.graph_queried && d.graph_ms >= lo && d.graph_ms < EDGES[i + 1]).length]) }}>
              <Latency ds={ds} p50={dg!.graph_ms_p50} p95={dg!.graph_ms_p95} />
            </Card>
            <Card title="The cheapest cut" sub="For each call that carried a secret: the max-flow, and which edge the minimum cut severed." legend={['Rewritten', 'Blocked']}
              table={{ head: ['Tool', 'Max-flow', 'Cut'], rows: ds.filter(d => d.cut && d.cut.max_flow > 0).map(d => [d.tool, d.cut!.max_flow, d.cut!.terminal ? 'the call' : (d.cut!.redact || []).join(', ')]) }}>
              <Cuts ds={ds} />
            </Card>
          </div>
        </>
      )}
    </div>
  )
}
