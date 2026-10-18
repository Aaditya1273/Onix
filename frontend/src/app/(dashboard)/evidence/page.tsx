'use client'

import { useMemo, useState } from 'react'
import { useResource, type Resource } from '@/lib/useResource'
import { Kpi, ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'
import { VERDICT, stageLabel, verdictOf, type Verdict } from '@/lib/verdict'
import { AXIS, ChartCard, GRID, INK, Mark, NEUTRAL, Tip, tipProps, useWidth, type TipState } from './charts'

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
const quantile = (xs: number[], q: number) => { if (!xs.length) return null; const s = [...xs].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.ceil(q * s.length) - 1)] }

// ---- 1. sessions over time: one lane per session, the leak drawn across lanes

const MAX_LANES = 12
const OTHER = '\u0000other'

function Swimlane({ ds, arcs }: { ds: Decision[]; arcs: Arc[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
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
  const L = narrow ? 84 : 128, R = 12, TOP = 6, LH = 30, H = TOP + lanes.length * LH + 30
  const xi = (i: number) => L + (order.length < 2 ? 0.5 : i / (order.length - 1)) * (W - L - R)
  const x = (d: Decision) => xi(rank.get(d)!)
  const y = (d: Decision) => TOP + laneOf(d.session_id) * LH + LH / 2
  const laneLabel = (s: string) => s === OTHER ? (narrow ? `+${others.size} more` : `${others.size} other session${others.size === 1 ? '' : 's'}`) : narrow ? shortSession(s) : `session ${shortSession(s)}`
  const ticks = narrow ? [0, 1] : [0, 0.25, 0.5, 0.75, 1]
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" aria-label={`${order.length} decisions in ${lanes.length} lanes; stopped calls are focusable`}>
          {lanes.map((s, i) => (
            <g key={s}>
              <rect x={L} y={TOP + i * LH + 3} width={W - L - R} height={LH - 6} rx={6} fill={i % 2 ? '#faf7f2' : '#f5f1ea'} />
              <text x={L - 8} y={TOP + i * LH + LH / 2 + 4} textAnchor="end" fontSize={12} fill={s === OTHER ? AXIS : NEUTRAL}>{laneLabel(s)}</text>
            </g>
          ))}
          {ticks.map(f => {
            const tx = L + f * (W - L - R), i = Math.round(f * (order.length - 1))
            return (
              <g key={f}>
                <line x1={tx} x2={tx} y1={TOP} y2={H - 24} stroke={GRID} />
                <text x={tx} y={H - 8} textAnchor={f === 0 ? 'start' : f === 1 ? 'end' : 'middle'} fontSize={11} fill={AXIS}>
                  {narrow ? `#${i + 1}` : f === 0 ? `#1 · ${fmtTime(t0, span)}` : f === 1 ? `#${order.length} · ${fmtTime(ns(order[order.length - 1]), span)}` : `#${i + 1}`}
                </text>
              </g>
            )
          })}
          {arcs.map(({ from, to }, i) => {
            const x1 = x(from), y1 = y(from), x2 = x(to), y2 = y(to), mx = (x1 + x2) / 2
            return <path key={i} d={`M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`} fill="none" stroke={VERDICT[vOf(to)].mark} strokeWidth={2} strokeDasharray="5 4" />
          })}
          {order.map((d, i) => {
            const v = vOf(d), stop = v !== 'allowed', cx = x(d), cy = y(d)
            const body = <><b className="font-mono">{d.tool}</b><br />{VERDICT[v].label} · {stageLabel(d.stage)}<br />session {shortSession(d.session_id)} · decision #{i + 1} · {fmtTime(ns(d), span)}<br />{d.graph_queried ? `${d.graph_ms.toFixed(2)} ms in the graph` : 'graph not queried'}</>
            const label = `${VERDICT[v].label}: ${d.tool} in session ${shortSession(d.session_id)}, ${stageLabel(d.stage)}`
            return stop
              ? <g key={i} {...tipProps(setTip, cx, cy - 6, label, body)}><Mark v={v} x={cx} y={cy} s={5.5} /></g>
              : <g key={i} onMouseEnter={() => setTip({ x: cx, y: cy - 4, body })}><Mark v={v} x={cx} y={cy} s={3.5} /></g>
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

function Columns({ ds }: { ds: Decision[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const N = W < 480 ? 10 : 18
  const t0 = Math.min(...ds.map(ns)), t1 = Math.max(...ds.map(ns)) + 1, span = t1 - t0
  const bins = Array.from({ length: N }, () => Object.fromEntries(ORDER.map(v => [v, 0])) as Record<Verdict, number>)
  ds.forEach(d => { bins[Math.min(N - 1, Math.floor(((ns(d) - t0) / span) * N))][vOf(d)]++ })
  const max = Math.max(1, ...bins.map(b => ORDER.reduce((s, v) => s + b[v], 0)))
  const H = 220, L = 36, R = 8, B = 28, T = 10, bw = (W - L - R) / N
  const yv = (n: number) => T + (1 - n / max) * (H - T - B)
  const yTicks = [...new Set([0, Math.round(max / 2), max])]
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" aria-label="Decisions per equal time slice, stacked by verdict">
          {yTicks.map(n => <g key={n}><line x1={L} x2={W - R} y1={yv(n)} y2={yv(n)} stroke={GRID} /><text x={L - 6} y={yv(n) + 4} textAnchor="end" fontSize={11} fill={AXIS}>{n}</text></g>)}
          {bins.map((b, i) => {
            let acc = 0
            const total = ORDER.reduce((s, v) => s + b[v], 0)
            const from = t0 + (i / N) * span, to = t0 + ((i + 1) / N) * span
            const range = `${fmtTime(from, span)} to ${fmtTime(to, span)}`
            const body = <>{range}<br />{total ? ORDER.filter(v => b[v]).map(v => <div key={v}>{VERDICT[v].label}: {b[v]}</div>) : 'No decisions'}</>
            const label = `${range}: ${total ? ORDER.filter(v => b[v]).map(v => `${b[v]} ${VERDICT[v].label.toLowerCase()}`).join(', ') : 'no decisions'}`
            return (
              <g key={i} {...tipProps(setTip, L + i * bw + bw / 2, yv(total) - 2, label, body)}>
                <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
                {ORDER.map(v => {
                  const n = b[v]; if (!n) return null
                  const y0 = yv(acc), y1 = yv(acc + n); acc += n
                  return <rect key={v} x={L + i * bw + 2} y={y1 + 1} width={Math.max(1, bw - 4)} height={Math.max(1.5, y0 - y1 - 2)} rx={2} fill={VERDICT[v].mark} />
                })}
              </g>
            )
          })}
          <text x={L} y={H - 8} fontSize={11} fill={AXIS}>{fmtTime(t0, span)}</text>
          <text x={W - R} y={H - 8} textAnchor="end" fontSize={11} fill={AXIS}>{fmtTime(t1, span)}</text>
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  )
}

// ---- 3. what stopped them: bars by graph signal and verdict ----------------

function stopRows(ds: Decision[]) {
  const m = new Map<string, { stage: string; v: Verdict; n: number }>()
  ds.filter(d => vOf(d) !== 'allowed').forEach(d => {
    const k = `${d.stage}|${vOf(d)}`
    m.set(k, { stage: d.stage, v: vOf(d), n: (m.get(k)?.n || 0) + 1 })
  })
  return [...m.values()].sort((a, b) => b.n - a.n)
}

function Stages({ rows }: { rows: ReturnType<typeof stopRows> }) {
  if (!rows.length) return <p className="app-sub py-6 text-center">No call was stopped or rewritten in these decisions.</p>
  const max = Math.max(...rows.map(r => r.n))
  return (
    <ul className="space-y-3">
      {rows.map(r => (
        <li key={`${r.stage}|${r.v}`} className="text-[13px]">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[#14100d] min-w-0">{stageLabel(r.stage)}</span>
            <VerdictBadge v={r.v} />
          </div>
          <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="h-3 rounded-[4px] bg-[#f5f1ea]" aria-hidden="true"><div className="h-full rounded-[4px]" style={{ width: `${(r.n / max) * 100}%`, background: VERDICT[r.v].mark }} /></div>
            <span className="font-semibold tabular-nums">{r.n} <span className="sr-only">calls</span></span>
          </div>
        </li>
      ))}
    </ul>
  )
}

// ---- 4. graph time: histogram on doubling buckets, p50 / p95 marked --------

const EDGES = [0, 0.5, 1, 2, 4, 8, 16, 32, 64, 128, 256, Infinity]
const bucket = (i: number) => `${EDGES[i]}–${EDGES[i + 1] === Infinity ? '…' : EDGES[i + 1]} ms`

function Latency({ ms }: { ms: number[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const counts = EDGES.slice(0, -1).map((lo, i) => ms.filter(v => v >= lo && v < EDGES[i + 1]).length)
  const p50 = quantile(ms, 0.5), p95 = quantile(ms, 0.95)
  const max = Math.max(1, ...counts), n = counts.length
  const H = 240, L = 36, R = 8, B = 44, T = 40, bw = (W - L - R) / n
  const yv = (c: number) => T + (1 - c / max) * (H - T - B)
  const pos = (v: number) => { // a value's position on the doubling axis
    const i = EDGES.findIndex((e, k) => v >= e && v < EDGES[k + 1]); if (i < 0) return W - R
    const lo = EDGES[i], hi = EDGES[i + 1] === Infinity ? Math.max(1, lo) * 2 : EDGES[i + 1]
    return L + (i + (lo === 0 ? v / hi : Math.log2(v / lo) / Math.log2(hi / lo))) * bw
  }
  const marks: [string, number][] = []
  if (p50 !== null) marks.push(['median', p50])
  if (p95 !== null) marks.push(['p95', p95])
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" aria-label="Graph time per decision, doubling buckets">
          {[...new Set([0, Math.round(max / 2), max])].map(c => <g key={c}><line x1={L} x2={W - R} y1={yv(c)} y2={yv(c)} stroke={GRID} /><text x={L - 6} y={yv(c) + 4} textAnchor="end" fontSize={11} fill={AXIS}>{c}</text></g>)}
          {counts.map((c, i) => (
            <g key={i} {...tipProps(setTip, L + i * bw + bw / 2, yv(c) - 2, `${bucket(i)}: ${c} decisions`, <>{c} decision{c === 1 ? '' : 's'}<br />{bucket(i)}</>)}>
              <rect x={L + i * bw} y={T} width={bw} height={H - T - B} fill="transparent" />
              {c > 0 && <rect x={L + i * bw + 2} y={yv(c)} width={Math.max(1, bw - 4)} height={H - B - yv(c)} rx={3} fill={NEUTRAL} />}
              {(bw >= 26 || i % 2 === 0) && <text x={L + i * bw} y={H - B + 14} textAnchor="middle" fontSize={11} fill={AXIS}>{EDGES[i]}</text>}
            </g>
          ))}
          {marks.map(([k, v], i) => {
            const px = pos(v), right = px > W - 120
            return (
              <g key={k} aria-hidden="true">
                <line x1={px} x2={px} y1={14 + i * 16} y2={H - B} stroke={INK} strokeWidth={1.5} strokeDasharray="4 3" />
                <text x={right ? px - 4 : px + 4} y={12 + i * 16} textAnchor={right ? 'end' : 'start'} fontSize={11.5} fontWeight={600} fill={INK}>{k} {v.toFixed(2)} ms</text>
              </g>
            )
          })}
          <text x={W - R} y={H - 6} textAnchor="end" fontSize={11} fill={AXIS}>ms in the graph (bucket start)</text>
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  )
}

// ---- 5. the cheapest cut: one bar per call that carried a secret ------------

function Cuts({ cs }: { cs: Decision[] }) {
  if (!cs.length) return <p className="app-sub py-6 text-center">No call in these decisions carried a secret, so no cut was computed.</p>
  const max = Math.max(...cs.map(d => d.cut!.max_flow))
  return (
    <ul className="space-y-3">
      {cs.map((d, i) => (
        <li key={d.id || i} className="text-[13px]">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <span className="font-mono text-[12.5px] truncate min-w-0">{d.tool}</span>
            <VerdictBadge v={vOf(d)} />
          </div>
          <div className="mt-1 grid grid-cols-[1fr_auto] items-center gap-3">
            <div className="h-3 rounded-[4px] bg-[#f5f1ea]" aria-hidden="true"><div className="h-full rounded-[4px]" style={{ width: `${(d.cut!.max_flow / max) * 100}%`, background: VERDICT[vOf(d)].mark }} /></div>
            <span className="font-semibold tabular-nums">{d.cut!.max_flow} <span className="sr-only">max-flow</span></span>
          </div>
          <div className="app-meta">cut: {d.cut!.terminal ? 'the call itself' : `argument ${(d.cut!.redact || []).join(', ')}`}</div>
        </li>
      ))}
    </ul>
  )
}

// ---- page sections ----------------------------------------------------------

function Decided({ r, stops }: { r: DigestReply; stops: Resource<{ decisions: Decision[] }> }) {
  const d = r.digest, rew = d.by_stage.redact || 0
  const counts: Record<Verdict, number> = { allowed: Math.max(0, (d.by_verdict.ALLOW || 0) - rew), rewritten: rew, paused: d.by_verdict.PAUSE || 0, blocked: d.by_verdict.BLOCK || 0, critical: 0 }
  const stopped = counts.paused + counts.blocked
  return (
    <section aria-labelledby="decided-h" className="grid grid-cols-1 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] gap-4">
      <div className="app-panel p-5 sm:p-6">
        <h2 id="decided-h" className="app-h2">{r.observe_mode ? 'What VIGIL would have decided' : 'What VIGIL decided'}</h2>
        <p className="app-sub mt-1">
          {d.decisions.toLocaleString()} tool calls in the last {r.days} days. {r.observe_mode ? 'Would have stopped' : 'Stopped'} {stopped.toLocaleString()} ({pct(stopped, d.decisions)}){rew ? `, rewrote ${rew.toLocaleString()}` : ''}.
        </p>
        <div className="mt-4 flex h-3 overflow-hidden rounded-full bg-[#f5f1ea]" aria-hidden="true">
          {ORDER.map(v => counts[v] > 0 && <div key={v} style={{ width: `${(counts[v] / Math.max(1, d.decisions)) * 100}%`, minWidth: 4, background: VERDICT[v].mark }} />)}
        </div>
        <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-3">
          {ORDER.map(v => (
            <div key={v}>
              <dt><VerdictBadge v={v} title={VERDICT[v].meaning} /></dt>
              <dd className="mt-1 text-[15px] font-semibold tabular-nums">{counts[v].toLocaleString()} <span className="app-meta font-normal">{pct(counts[v], d.decisions)}</span></dd>
            </div>
          ))}
        </dl>
        <p className="app-meta mt-4">From the decision log in the graph (FalkorDB). {r.observe_mode && 'Observe mode is on: these verdicts were recorded, not enforced, and every call ran.'}</p>
      </div>
      <div className="app-panel p-5 sm:p-6 min-w-0">
        <h2 className="app-h2">Why it stopped them</h2>
        <p className="app-sub mt-1">The most recent calls this server stopped or rewrote, with the graph signal and the reason it recorded.</p>
        <div className="mt-4">
          <ResourceGate r={stops} loading="Reading recent decisions…" compact isEmpty={x => !x.decisions.some(z => vOf(z) !== 'allowed')}
            empty={<StatePanel kind="empty" compact title="Nothing stopped recently">None of the decisions this server holds in memory was stopped or rewritten.</StatePanel>}>
            {x => <StopList ds={x.decisions.filter(z => vOf(z) !== 'allowed').sort((a, b) => ns(b) - ns(a))} />}
          </ResourceGate>
        </div>
      </div>
    </section>
  )
}

function StopItem({ d }: { d: Decision }) {
  return (
    <li className="py-3 first:pt-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <VerdictBadge v={vOf(d)} />
        <span className="font-mono text-[12.5px] text-[#14100d]">{d.tool}</span>
        <span className="text-[13px] font-medium text-[#14100d]">{stageLabel(d.stage)}</span>
      </div>
      {d.reason && <p className="mt-1 text-[13px] leading-[19px] text-[#5e544b] break-words">{d.reason}</p>}
      <p className="app-meta mt-0.5">session <span className="font-mono">{shortSession(d.session_id)}</span> · {new Date(ns(d)).toLocaleString()}</p>
    </li>
  )
}

function StopList({ ds }: { ds: Decision[] }) {
  const first = ds.slice(0, 4), rest = ds.slice(4)
  return (
    <>
      <ul className="divide-y divide-[#efe9e0]">{first.map((d, i) => <StopItem key={d.id || i} d={d} />)}</ul>
      {rest.length > 0 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-semibold underline decoration-[#ff6b00] decoration-2 underline-offset-2 text-[#14100d]">Show {rest.length} more</summary>
          <ul className="mt-2 divide-y divide-[#efe9e0]">{rest.map((d, i) => <StopItem key={d.id || i} d={d} />)}</ul>
        </details>
      )}
    </>
  )
}

function Charts({ ds }: { ds: Decision[] }) {
  const order = useMemo(() => [...ds].sort((a, b) => ns(a) - ns(b)), [ds])
  const arcs = useMemo(() => leakArcs(order), [order])
  const rows = useMemo(() => stopRows(order), [order])
  const graphMs = useMemo(() => order.filter(d => d.graph_queried).map(d => d.graph_ms), [order])
  const cuts = order.filter(d => d.cut && d.cut.max_flow > 0)
  const t0 = ns(order[0]), span = ns(order[order.length - 1]) - t0
  const present = ORDER.filter(v => order.some(d => vOf(d) === v))
  return (
    <>
      <ChartCard title="Every session, every decision"
        sub="One lane per session with a stopped call; quiet sessions share the last lane. Decisions are evenly spaced in the order they happened. A dashed line joins a read in one session to the stopped call in another session that carried what it read."
        legend={present}
        table={{
          caption: 'Every decision in order', head: ['#', 'Time', 'Session', 'Tool', 'Verdict', 'Signal', 'Graph ms'],
          rows: order.map((d, i) => [i + 1, fmtTime(ns(d), span), <span key="s" className="font-mono">{shortSession(d.session_id)}</span>, <span key="t" className="font-mono">{d.tool}</span>, <VerdictBadge key="v" v={vOf(d)} />, stageLabel(d.stage), d.graph_queried ? d.graph_ms.toFixed(2) : '—']),
        }}>
        <Swimlane ds={order} arcs={arcs} />
        {arcs.length > 0 && (
          <div className="mt-2">
            <p className="app-meta">Cross-session paths ({arcs.length}):</p>
            <ul className="mt-1 space-y-1 text-[13px]">
              {arcs.map((a, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                  <span><span className="font-mono">{a.readTool}</span> in session <span className="font-mono">{shortSession(a.from.session_id)}</span> read a value that</span>
                  <span><span className="font-mono">{a.to.tool}</span> in session <span className="font-mono">{shortSession(a.to.session_id)}</span> carried</span>
                  <VerdictBadge v={vOf(a.to)} />
                </li>
              ))}
            </ul>
          </div>
        )}
      </ChartCard>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ChartCard title="Verdicts over time" sub="Decisions per equal slice of the time these decisions span, stacked by verdict." legend={present}
          table={{ caption: 'Decisions by verdict', head: ['Verdict', 'Decisions', 'Share'], rows: ORDER.map(v => { const n = order.filter(d => vOf(d) === v).length; return [<VerdictBadge key="v" v={v} />, n, pct(n, order.length)] }) }}>
          <Columns ds={order} />
        </ChartCard>
        <ChartCard title="What stopped them" sub="Stopped and rewritten calls, by the graph signal that decided them."
          table={{ caption: 'Stopped calls by signal', head: ['Signal', 'Verdict', 'Calls'], rows: rows.map(r => [stageLabel(r.stage), <VerdictBadge key="v" v={r.v} />, r.n]) }}>
          <Stages rows={rows} />
        </ChartCard>
        <ChartCard title="How long the graph took" sub={`Graph time for the ${graphMs.length} decisions that queried the graph, on doubling buckets. Dashed lines mark the median and the 95th percentile of these decisions.`}
          table={{ caption: 'Graph time buckets', head: ['Bucket', 'Decisions'], rows: EDGES.slice(0, -1).map((lo, i) => [bucket(i), graphMs.filter(v => v >= lo && v < EDGES[i + 1]).length]) }}>
          {graphMs.length ? <Latency ms={graphMs} /> : <p className="app-sub py-6 text-center">None of these decisions queried the graph.</p>}
        </ChartCard>
        <ChartCard title="The cheapest cut" sub={<>For each call that carried a secret: the max-flow FalkorDB&apos;s <span className="font-mono">algo.maxFlow</span> returned (the capacity of the cheapest cut between the secret and the call), and what the minimum cut severed. When cutting one argument is cheaper than cutting the call, VIGIL rewrites instead of blocking.</>}
          table={{ caption: 'Min-cut per call', head: ['Tool', 'Verdict', 'Max-flow', 'Cut'], rows: cuts.map(d => [<span key="t" className="font-mono">{d.tool}</span>, <VerdictBadge key="v" v={vOf(d)} />, d.cut!.max_flow, d.cut!.terminal ? 'the call itself' : (d.cut!.redact || []).join(', ')]) }}>
          <Cuts cs={cuts} />
        </ChartCard>
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

      <div className="mt-6">
        <ResourceGate r={digest} loading="Reading the decision log…" isEmpty={r => r.digest.decisions === 0}
          empty={<StatePanel kind="empty" title="No decisions in the last 7 days">VIGIL has not decided any tool call on this deployment in that window. Connect an agent or run an attack in the Playground.</StatePanel>}>
          {r => (
            <>
              <Decided r={r} stops={clean} />
              <div className="mt-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
                <Kpi value={`${Math.round(r.digest.model_free_fraction * 100)}%`} label="Decided without a model" note={`graph queries only · last ${r.days} days`} />
                <Kpi value={r.digest.graph_queried ? `${r.digest.graph_ms_p50.toFixed(2)} ms` : null} label="Graph time, median" note={r.digest.graph_queried ? `p95 ${r.digest.graph_ms_p95.toFixed(2)} ms · ${r.digest.graph_queried.toLocaleString()} graph queries` : 'no decision queried the graph'} />
                <Kpi value={`${r.digest.chain_links.toLocaleString()}/${(r.digest.chain_links + r.digest.chain_broken).toLocaleString()}`} label="Decision-chain links intact"
                  tone={r.digest.chain_broken ? VERDICT.critical.ink : undefined}
                  note={r.digest.chain_broken ? <VerdictBadge v="critical" title={`${r.digest.chain_broken} broken`} /> : 'no broken links'} />
              </div>
            </>
          )}
        </ResourceGate>
      </div>

      <section aria-labelledby="log-h" className="mt-10">
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
                <Charts ds={x.decisions} />
              </>
            )
          }}
        </ResourceGate>
      </section>
    </div>
  )
}
