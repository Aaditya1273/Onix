'use client'

// Chart forms for the Evidence page, each chosen for what its data has to say:
//   VerdictRing  what VIGIL decided: the whole log, and a zoom into the stopped share
//   RadialBurst  every decision in memory as one ray, clockwise through time
//   Sankey       which graph signal led to which verdict
//   Ridges       graph time per tool, as layered distributions on a log axis
//   CutPaths     for each call that carried a secret, where the min cut fell
// All of them read real decisions; none draws a value the server did not return.

import { useEffect, useMemo, useRef, useState } from 'react'
import { VERDICT, stageLabel, verdictOf, type Verdict } from '@/lib/verdict'
import { VerdictBadge } from '@/components/app/ui'
import { AXIS, GRID, Tip, tipProps, useWidth, type TipState } from './charts'
import { useCountUp, useIntro } from '@/lib/useIntro'

export interface FDecision {
  id?: string; decision: string; stage: string; tool: string; session_id: string; at: string
  graph_ms: number; graph_queried: boolean; cut?: { max_flow: number; terminal: boolean; redact: string[] | null } | null
}
const vOf = (d: FDecision) => verdictOf(d.decision, d.stage)
const t = (d: FDecision) => Date.parse(d.at)
const ALLOWED_INK = '#d6ccbf'
const polar = (cx: number, cy: number, r: number, deg: number) => {
  const a = ((deg - 90) * Math.PI) / 180
  return [cx + r * Math.cos(a), cy + r * Math.sin(a)] as const
}
function arc(cx: number, cy: number, r: number, from: number, to: number) {
  const [x1, y1] = polar(cx, cy, r, from), [x2, y2] = polar(cx, cy, r, to)
  return `M${x1},${y1} A${r},${r} 0 ${to - from > 180 ? 1 : 0} 1 ${x2},${y2}`
}

// ---- What VIGIL decided: the whole log, and a zoom into what it stopped -----

export function VerdictRing({ counts, days }: { counts: Record<Verdict, number>; days: number }) {
  const total = counts.allowed + counts.rewritten + counts.paused + counts.blocked
  const stopped = total - counts.allowed
  const play = useIntro('ring')
  const shownStopped = useCountUp(stopped, play)
  const S = 236, c = S / 2, R1 = 104, R2 = 74
  // Outer ring: the stopped share, never thinner than 8 degrees so it stays visible.
  const share = total ? stopped / total : 0
  const sweep = stopped ? Math.max(8, share * 360) : 0
  const inner: Verdict[] = ['blocked', 'paused', 'rewritten']
  let at = 0
  const segs = inner.filter(v => counts[v] > 0).map(v => {
    const a = (counts[v] / Math.max(1, stopped)) * 360, s = { v, from: at, to: at + a }
    at += a
    return s
  })
  const gap = segs.length > 1 ? 2.5 : 0
  const [ox1, oy1] = polar(c, c, R1 - 9, 360 - sweep), [ox2, oy2] = polar(c, c, R1 - 9, 360)
  const [ix, iy] = polar(c, c, R2 + 8, 0)
  return (
    <div className="flex flex-col sm:flex-row xl:flex-col 2xl:flex-row items-center gap-5">
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="img" className={`shrink-0 ${play ? 'intro' : ''}`}
        aria-label={`${total} decisions in the last ${days} days: ${counts.allowed} allowed, ${counts.blocked} blocked, ${counts.paused} paused, ${counts.rewritten} rewritten.`}>
        <defs>
          <filter id="ring-glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="5" /></filter>
        </defs>
        <circle cx={c} cy={c} r={R1} fill="none" stroke={ALLOWED_INK} strokeWidth={14} pathLength={1} className="a-draw" transform={`rotate(-90 ${c} ${c})`} style={{ ['--dur' as string]: '1.2s' }} />
        {stopped > 0 && <>
          <path d={arc(c, c, R1, 360 - sweep, 359.99)} fill="none" stroke="#ff6b00" strokeWidth={22} strokeOpacity={0.35} filter="url(#ring-glow)" className="a-fade" style={{ ['--d' as string]: '1.1s' }} />
          <path d={arc(c, c, R1, 360 - sweep, 359.99)} fill="none" stroke="#ff6b00" strokeWidth={14} strokeLinecap="butt" pathLength={1} className="a-draw" style={{ ['--d' as string]: '.9s', ['--dur' as string]: '.6s' }} />
          {/* the zoom: the outer slice opens into the inner ring */}
          <path d={`M${ox1},${oy1} L${ix},${iy} L${ox2},${oy2}`} fill="#ff6b00" fillOpacity={0.08} stroke="#ff6b00" strokeOpacity={0.45} strokeDasharray="3 3" className="a-fade" style={{ ['--d' as string]: '1.35s' }} />
          {segs.map((s, k) => <path key={s.v} d={arc(c, c, R2, s.from + gap / 2, s.to - gap / 2 - (segs.length === 1 ? 0.01 : 0))} fill="none" stroke={VERDICT[s.v].mark} strokeWidth={16}
            pathLength={1} className="a-draw" style={{ ['--d' as string]: `${1.5 + k * 0.2}s`, ['--dur' as string]: '.7s' }} />)}
        </>}
        <text x={c} y={c - 4} textAnchor="middle" fontSize={40} fontWeight={750} fill="#14100d" style={{ letterSpacing: '-0.03em' }}>{shownStopped}</text>
        <text x={c} y={c + 18} textAnchor="middle" fontSize={12} fill="#5e544b">stopped of {total.toLocaleString()}</text>
        <text x={c} y={c + 34} textAnchor="middle" fontSize={11} fill="#6b6158">{(share * 100).toFixed(share < 0.1 ? 1 : 0)}% · {days} days</text>
      </svg>
      <ul className={`grid grid-cols-2 sm:grid-cols-1 gap-x-5 gap-y-2.5 w-full ${play ? 'intro' : ''}`}>
        {(['allowed', 'blocked', 'paused', 'rewritten'] as Verdict[]).map((v, k) => (
          <li key={v} className="flex items-center gap-2.5 a-rise" style={{ ['--d' as string]: `${0.4 + k * 0.12}s` }}>
            <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: v === 'allowed' ? ALLOWED_INK : VERDICT[v].mark }} aria-hidden="true" />
            <span className="text-[13px] text-[#5e544b] min-w-[72px]">{VERDICT[v].label}</span>
            <b className="font-display text-[17px] font-black tabular-nums text-[#14100d]">{counts[v].toLocaleString()}</b>
            <span className="text-[12px] text-[#6b6158] tabular-nums">{total ? ((counts[v] / total) * 100).toFixed(1) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ---- Every decision as a ray, clockwise through time ------------------------

// Intro animations run once per page load, not on every refresh or tab switch.
const played = { burst: false, sankey: false }

export function RadialBurst({ ds }: { ds: FDecision[] }) {
  const [tip, setTip] = useState<TipState>(null)
  const [play] = useState(() => !played.burst)
  useEffect(() => { played.burst = true }, [])
  const order = useMemo(() => [...ds].sort((a, b) => t(a) - t(b)), [ds])
  const S = 300, c = S / 2, r0 = 52, n = order.length
  const stopped = order.filter(d => vOf(d) !== 'allowed').length
  const fmt = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })
  return (
    <div className="relative flex justify-center" onMouseLeave={() => setTip(null)}>
      <svg width={S} height={S} viewBox={`0 0 ${S} ${S}`} role="group" aria-label={`${n} decisions in order, ${stopped} stopped or rewritten`} className={play ? 'burst-play' : undefined}>
        <circle cx={c} cy={c} r={r0 - 8} fill="#faf5ee" stroke="#efe6da" />
        {order.map((d, i) => {
          const v = vOf(d), deg = (i / n) * 360
          const len = v === 'allowed' ? 22 + Math.min(18, d.graph_ms * 6) : 86
          const [x1, y1] = polar(c, c, r0, deg), [x2, y2] = polar(c, c, r0 + len, deg)
          const col = v === 'allowed' ? ALLOWED_INK : VERDICT[v].mark
          const label = `${VERDICT[v].label}: ${d.tool}, ${stageLabel(d.stage)}, ${fmt(t(d))}`
          return (
            <g key={d.id || i} {...(v !== 'allowed' ? tipProps(setTip, x2, y2, label, <><b>{VERDICT[v].label}</b> · {stageLabel(d.stage)}<br /><span className="font-mono">{d.tool}</span><br />{fmt(t(d))}</>) : { 'aria-hidden': true })}>
              <line className="ray" x1={x1} y1={y1} x2={x2} y2={y2} stroke={col} strokeWidth={v === 'allowed' ? 1.6 : 3} strokeLinecap="round"
                style={{ ['--len' as string]: len + 2, ['--d' as string]: `${(i / n) * 1.3}s` }} />
              {v !== 'allowed' && <circle className="ray-tip" cx={x2} cy={y2} r={3.5} fill={col} style={{ ['--d2' as string]: `${(i / n) * 1.3 + 0.35}s` }} />}
            </g>
          )
        })}
        <text x={c} y={c - 2} textAnchor="middle" fontSize={30} fontWeight={750} fill="#14100d" style={{ letterSpacing: '-0.03em' }}>{n}</text>
        <text x={c} y={c + 16} textAnchor="middle" fontSize={11} fill="#5e544b">decisions</text>
        {/* where time starts, and which way it runs */}
        <text x={c + 6} y={14} fontSize={10.5} fill={AXIS}>oldest · clockwise →</text>
      </svg>
      <Tip tip={tip} width={S} />
    </div>
  )
}

// ---- Which graph signal led to which verdict --------------------------------

export function Sankey({ ds }: { ds: FDecision[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const [play] = useState(() => !played.sankey)
  const reduced = useReduced()
  useEffect(() => { played.sankey = true }, [])
  const stops = ds.filter(d => vOf(d) !== 'allowed')
  const flows = useMemo(() => {
    const m = new Map<string, { stage: string; v: Verdict; n: number }>()
    stops.forEach(d => { const k = `${d.stage}|${vOf(d)}`; m.set(k, { stage: d.stage, v: vOf(d), n: (m.get(k)?.n || 0) + 1 }) })
    return [...m.values()]
  }, [stops])
  if (!stops.length) return <p className="app-sub py-10 text-center">No call was stopped or rewritten in these decisions.</p>
  const stages = [...new Set(flows.map(f => f.stage))].map(s => ({ s, n: flows.filter(f => f.stage === s).reduce((a, f) => a + f.n, 0) })).sort((a, b) => b.n - a.n)
  const verdicts = (['blocked', 'paused', 'rewritten', 'critical'] as Verdict[]).map(v => ({ v, n: flows.filter(f => f.v === v).reduce((a, f) => a + f.n, 0) })).filter(x => x.n)
  const total = stops.length, gapY = 12, H = Math.max(200, stages.length * 46 + 20)
  const unit = (H - 20 - gapY * (Math.max(stages.length, verdicts.length) - 1)) / total
  const xL = Math.min(300, W * 0.42), xR = W - 120, bw = 10
  const place = <T extends { n: number }>(xs: T[]) => { let y = 10; return xs.map(x => { const r = { ...x, y, h: x.n * unit }; y += r.h + gapY; return r }) }
  const L = place(stages), Rr = place(verdicts)
  const offL = new Map(L.map(l => [l.s, l.y])), offR = new Map(Rr.map(r => [r.v, r.y]))
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" aria-label={`${total} stopped calls: from graph signal to verdict`}>
          {play && !reduced && (
            <defs><clipPath id="sankey-reveal"><rect x={0} y={0} width={0} height={H}><animate attributeName="width" from="0" to={W} dur="1.3s" fill="freeze" calcMode="spline" keySplines=".2 .8 .2 1" keyTimes="0;1" /></rect></clipPath></defs>
          )}
          <g clipPath={play && !reduced ? 'url(#sankey-reveal)' : undefined}>
          {flows.sort((a, b) => stages.findIndex(s => s.s === a.stage) - stages.findIndex(s => s.s === b.stage)).map((f, i) => {
            const h = f.n * unit, y0 = offL.get(f.stage)!, y1 = offR.get(f.v)!
            offL.set(f.stage, y0 + h); offR.set(f.v, y1 + h)
            const x0 = xL + bw, x1 = xR, mx = (x0 + x1) / 2
            const d = `M${x0},${y0} C${mx},${y0} ${mx},${y1} ${x1},${y1} L${x1},${y1 + h} C${mx},${y1 + h} ${mx},${y0 + h} ${x0},${y0 + h} Z`
            return (
              <g key={i}>
                <path d={d} fill={VERDICT[f.v].mark} fillOpacity={0.28} stroke={VERDICT[f.v].mark} strokeOpacity={0.5}
                  {...tipProps(setTip, mx, Math.min(y0, y1) + h / 2, `${stageLabel(f.stage)} to ${VERDICT[f.v].label}: ${f.n}`, <>{stageLabel(f.stage)}<br />→ <b>{VERDICT[f.v].label}</b> · {f.n} call{f.n === 1 ? '' : 's'}</>)} />
              </g>
            )
          })}
          </g>
          {L.map(l => (
            <g key={l.s}>
              <rect x={xL} y={l.y} width={bw} height={Math.max(3, l.h)} rx={3} fill="#5e544b" />
              <text x={xL - 10} y={l.y + l.h / 2 + 4} textAnchor="end" fontSize={12.5} fill="#14100d">{stageLabel(l.s)}</text>
              <text x={xL - 10} y={l.y + l.h / 2 + 18} textAnchor="end" fontSize={11} fill={AXIS}>{l.n} call{l.n === 1 ? '' : 's'}</text>
            </g>
          ))}
          {Rr.map(r => (
            <g key={r.v}>
              <rect x={xR} y={r.y} width={bw} height={Math.max(3, r.h)} rx={3} fill={VERDICT[r.v].mark} />
              <text x={xR + bw + 10} y={r.y + r.h / 2 + 4} fontSize={13} fontWeight={700} fill="#14100d">{VERDICT[r.v].label}</text>
              <text x={xR + bw + 10} y={r.y + r.h / 2 + 19} fontSize={11.5} fill={AXIS}>{r.n}</text>
            </g>
          ))}
        </svg>
      )}
      <Tip tip={tip} width={W} />
    </div>
  )
}

// ---- Graph time per tool, as ridges in 3D you can turn ----------------------
// x: graph time on a log axis; z: one row per tool; y: how many decisions took
// that long (a smoothed density). Drawn in SVG with a small perspective
// projection, so labels stay sharp. Drag, or use the arrow keys, to turn it.

const useReduced = () => {
  const [r, setR] = useState(false)
  useEffect(() => { const m = matchMedia('(prefers-reduced-motion: reduce)'); const f = () => setR(m.matches); f(); m.addEventListener('change', f); return () => m.removeEventListener('change', f) }, [])
  return r
}

export function Ridges({ ds }: { ds: FDecision[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const [rot, setRot] = useState({ yaw: -0.55, pitch: 0.42 })
  const [touched, setTouched] = useState(false)
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null)
  const reduced = useReduced()
  const play = useIntro('ridges')
  const byTool = useMemo(() => {
    const m = new Map<string, number[]>()
    ds.filter(d => d.graph_queried && d.graph_ms > 0).forEach(d => m.set(d.tool, [...(m.get(d.tool) || []), d.graph_ms]))
    return [...m.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, 6)
  }, [ds])
  // A gentle sway until someone turns it themselves.
  useEffect(() => {
    if (touched || reduced) return
    let raf = 0; const t0 = performance.now()
    const tick = (t: number) => { setRot({ yaw: -0.55 + Math.sin((t - t0) / 2600) * 0.32, pitch: 0.42 }); raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [touched, reduced])
  if (!byTool.length) return <p className="app-sub py-10 text-center">None of these decisions queried the graph.</p>

  const lo = Math.log10(0.05), hi = Math.log10(50), K = 56, bwK = 0.12, n = byTool.length
  const H = 400, cx = W / 2 + 40, cy = H * 0.62, scale = Math.min(W * 0.3, 230)
  const { yaw, pitch } = rot
  const cyw = Math.cos(yaw), syw = Math.sin(yaw), cp = Math.cos(pitch), sp = Math.sin(pitch)
  // world: x,z in [-1,1], y up in [0,0.8]
  const P = (x: number, y: number, z: number) => {
    const x1 = x * cyw - z * syw, z1 = x * syw + z * cyw
    const y2 = y * cp - z1 * sp, z2 = y * sp + z1 * cp
    const f = 3.2 / (3.2 + z2)
    return { x: cx + x1 * scale * f, y: cy - y2 * scale * f, z: z2 }
  }
  const X = (lg: number) => -1 + ((lg - lo) / (hi - lo)) * 2
  const Z = (i: number) => (n === 1 ? 0 : -1 + (i / (n - 1)) * 2)
  const ridges = byTool.map(([tool, ms], i) => {
    const logs = ms.map(Math.log10)
    const dens = Array.from({ length: K }, (_, k) => { const g = lo + ((hi - lo) * k) / (K - 1); return logs.reduce((a, v) => a + Math.exp(-0.5 * ((g - v) / bwK) ** 2), 0) })
    const peak = Math.max(...dens) || 1
    const z = Z(i)
    const top = dens.map((v, k) => P(X(lo + ((hi - lo) * k) / (K - 1)), (v / peak) * 0.75, z))
    const pts = [P(-1, 0, z), ...top, P(1, 0, z)]
    const med = [...ms].sort((a, b) => a - b)[Math.floor(ms.length / 2)]
    const pk = top[dens.indexOf(peak)]
    return { tool, ms, i, z, pts, med, pk, depth: pts.reduce((a, p) => a + p.z, 0) / pts.length }
  }).sort((a, b) => b.depth - a.depth) // far first
  const COL = ['#ff6b00', '#ff7d1a', '#ff9033', '#ffa24d', '#ffb366', '#ffc380']
  const onDown = (e: React.PointerEvent) => { setTouched(true); drag.current = { x: e.clientX, y: e.clientY, yaw: rot.yaw, pitch: rot.pitch }; (e.currentTarget as Element).setPointerCapture(e.pointerId) }
  const onMove = (e: React.PointerEvent) => {
    const d = drag.current; if (!d) return
    setRot({ yaw: d.yaw + (e.clientX - d.x) * 0.008, pitch: Math.max(-0.15, Math.min(1.35, d.pitch + (e.clientY - d.y) * 0.006)) })
  }
  const onKey = (e: React.KeyboardEvent) => {
    const k = { ArrowLeft: [-0.12, 0], ArrowRight: [0.12, 0], ArrowUp: [0, -0.1], ArrowDown: [0, 0.1] }[e.key]
    if (!k) return
    e.preventDefault(); setTouched(true)
    setRot(r => ({ yaw: r.yaw + k[0], pitch: Math.max(-0.15, Math.min(1.35, r.pitch + k[1])) }))
  }
  const floor = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([x, z]) => P(x, 0, z))
  return (
    <div ref={ref} className="relative select-none" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} tabIndex={0} role="group" onKeyDown={onKey}
          aria-label="Graph time per tool in 3D. Drag or use the arrow keys to turn it; the table view lists the same numbers."
          className={`cursor-grab active:cursor-grabbing touch-none rounded-xl focus-visible:outline-2 ${play ? 'intro' : ''}`}
          onPointerDown={onDown} onPointerMove={onMove} onPointerUp={() => (drag.current = null)} onPointerCancel={() => (drag.current = null)}>
          <polygon points={floor.map(p => `${p.x},${p.y}`).join(' ')} fill="#f5f1ea" stroke={GRID} />
          {[0.1, 1, 10].map(v => {
            const a = P(X(Math.log10(v)), 0, -1), b = P(X(Math.log10(v)), 0, 1), t = P(X(Math.log10(v)), 0, 1.22)
            return <g key={v}><line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="#d9cfc2" strokeDasharray="3 4" /><text x={t.x} y={t.y + 4} fontSize={11} fill={AXIS} textAnchor="middle">{v} ms</text></g>
          })}
          {ridges.map(r => (
            <g key={r.tool} {...tipProps(setTip, r.pk.x, r.pk.y - 4, `${r.tool}: ${r.ms.length} decisions, median ${r.med.toFixed(2)} ms`, <><span className="font-mono">{r.tool}</span><br />{r.ms.length} decisions · median <b>{r.med.toFixed(2)} ms</b></>)}>
              <polygon points={r.pts.map(p => `${p.x},${p.y}`).join(' ')} fill={COL[r.i % COL.length]} fillOpacity={0.88} stroke="#fff" strokeWidth={1.5} strokeLinejoin="round"
                className="a-fade" style={{ ['--d' as string]: `${0.15 + r.i * 0.14}s` }} />
            </g>
          ))}
          {ridges.map(r => {
            // the label sits just outside the ridge's start, on whichever side that faces, and never leaves the frame
            const l = P(-1.08, 0, r.z), left = l.x < cx
            const x = left ? Math.max(l.x, 128) : Math.min(l.x, W - 128)
            return <text key={r.tool} x={x} y={l.y + 4} fontSize={11} textAnchor={left ? 'end' : 'start'} fill="#14100d" className="font-mono" pointerEvents="none">{r.tool.length > 18 ? r.tool.slice(0, 17) + '…' : r.tool}</text>
          })}
        </svg>
      )}
      <div className="absolute right-2 top-2 flex items-center gap-2">
        <span className="app-meta hidden sm:inline">Drag to turn it</span>
        <button type="button" className="app-btn app-btn-secondary app-btn-sm" onClick={() => { setTouched(true); setRot({ yaw: -0.55, pitch: 0.42 }) }}>Reset view</button>
      </div>
      <Tip tip={tip} width={W} />
    </div>
  )
}

// ---- Where the min cut fell, drawn as the path it severed --------------------

export function CutPaths({ cs }: { cs: FDecision[] }) {
  const reduced = useReduced()
  const play = useIntro('cuts')
  if (!cs.length) return <p className="app-sub py-10 text-center">No call in these decisions carried a secret, so no cut was computed.</p>
  return (
    <ul className={`space-y-4 ${play ? 'intro' : ''}`}>
      {cs.map((d, i) => {
        const v = vOf(d), cut = d.cut!
        const arg = cut.terminal ? 'every argument' : `argument ${(cut.redact || []).join(', ')}`
        // the severed edge: argument → call when one argument is redacted; call → out when the call is blocked
        const severed = cut.terminal ? 2 : 1
        const nodes = [['secret', 'read earlier'], [cut.terminal ? 'all args' : (cut.redact || ['arg'])[0], 'carries it'], ['call', d.tool.replace(/^mcp__/, '').slice(0, 16)], ['out', cut.terminal ? 'never runs' : 'runs, cut']]
        const nx = (k: number) => 30 + k * 100
        const stopX = (nx(severed) + nx(severed + 1)) / 2 // where the flow dies
        return (
          <li key={d.id || i} className="rounded-2xl border border-[#efe6da] bg-[#fffdf9] p-3 a-rise" style={{ ['--d' as string]: `${0.1 + i * 0.15}s` }}>
            <div className="flex items-center gap-2 flex-wrap">
              <VerdictBadge v={v} />
              <span className="font-mono text-[12px] text-[#14100d] truncate min-w-0">{d.tool}</span>
              <span className="ml-auto text-[12px] text-[#5e544b] tabular-nums">max-flow <b className="text-[#14100d]">{cut.max_flow}</b></span>
            </div>
            <svg viewBox="0 0 360 74" className="w-full mt-1 cut-anim" role="img" aria-label={`The min cut severed ${cut.terminal ? 'the call itself' : arg}; cost ${cut.max_flow}. Data flows from the secret and stops at the cut.`}>
              <defs><filter id={`g${i}`} x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="4" /></filter></defs>
              {nodes.slice(0, -1).map((_, k) => {
                const x1 = nx(k), x2 = nx(k + 1), on = k === severed, live = k < severed
                return (
                  <g key={k}>
                    <line x1={x1 + 13} x2={x2 - 13} y1={30} y2={30} stroke={on ? '#b42318' : live ? '#e8a77a' : '#d6ccbf'} strokeWidth={on ? 3 : 2}
                      className={live && !reduced ? 'cut-flow' : on && !reduced ? 'cut-pulse' : undefined} strokeDasharray={on ? '0' : '4 6'} />
                    {on && <text x={(x1 + x2) / 2} y={22} textAnchor="middle" fontSize={15} fill="#b42318" className={reduced ? undefined : 'cut-snip'} style={{ transformOrigin: `${(x1 + x2) / 2}px 17px` }}>✂</text>}
                  </g>
                )
              })}
              {/* data on its way: dots leave the secret and die at the cut */}
              {!reduced && [0, 0.6, 1.2].map(delay => (
                <circle key={delay} r={3.2} cy={30} fill="#ff6b00">
                  <animate attributeName="cx" from={nx(0) + 12} to={stopX} dur="1.8s" begin={`${delay}s`} repeatCount="indefinite" />
                  <animate attributeName="opacity" values="0;1;1;0" keyTimes="0;0.1;0.85;1" dur="1.8s" begin={`${delay}s`} repeatCount="indefinite" />
                </circle>
              ))}
              {nodes.map(([n, s], k) => {
                const cx = nx(k), hot = k < (severed + 1)
                const fill = k === 0 ? '#ff6b00' : hot ? VERDICT[v].mark : '#d6ccbf'
                return (
                  <g key={n + k}>
                    {hot && <circle cx={cx} cy={30} r={13} fill={fill} opacity={0.35} filter={`url(#g${i})`} className={reduced ? undefined : 'cut-glow'} />}
                    <circle cx={cx} cy={30} r={10} fill="#fff" stroke={fill} strokeWidth={3} />
                    <circle cx={cx} cy={30} r={3.5} fill={fill} />
                    <text x={cx} y={56} textAnchor="middle" fontSize={11} fontWeight={600} fill="#14100d">{n}</text>
                    <text x={cx} y={69} textAnchor="middle" fontSize={9.5} fill={AXIS}>{s}</text>
                  </g>
                )
              })}
            </svg>
          </li>
        )
      })}
    </ul>
  )
}

// ---- Why calls were stopped: one axis per graph signal ----------------------

export function SignalRadar({ byStage }: { byStage: Record<string, number> }) {
  const rows = Object.entries(byStage).filter(([s]) => s !== 'default').sort((a, b) => b[1] - a[1])
  const play = useIntro('radar')
  if (rows.length < 3) return null // a radar needs three axes; the list below still shows every signal
  const S = 260, c = S / 2, R = 88, max = Math.max(...rows.map(r => r[1]))
  const pt = (i: number, v: number) => polar(c, c, (v / max) * R, (i / rows.length) * 360)
  const poly = rows.map(([, n], i) => pt(i, n).join(',')).join(' ')
  return (
    <svg viewBox={`-96 -6 ${S + 192} ${S + 12}`} className={`w-full max-w-[360px] mx-auto block ${play ? 'intro' : ''}`} role="img"
      aria-label={`Calls stopped by graph signal: ${rows.map(([s, n]) => `${stageLabel(s)} ${n}`).join(', ')}`}>
      <defs><filter id="radar-glow" x="-40%" y="-40%" width="180%" height="180%"><feGaussianBlur stdDeviation="8" /></filter></defs>
      {[0.25, 0.5, 0.75, 1].map(k => (
        <polygon key={k} points={rows.map((_, i) => polar(c, c, R * k, (i / rows.length) * 360).join(',')).join(' ')} fill="none" stroke={GRID} />
      ))}
      {rows.map((_, i) => { const [x, y] = polar(c, c, R, (i / rows.length) * 360); return <line key={i} x1={c} y1={c} x2={x} y2={y} stroke={GRID} /> })}
      <g className="a-zoom" style={{ transformOrigin: `${c}px ${c}px`, transformBox: 'view-box', ['--d' as string]: '.2s' }}>
        <polygon points={poly} fill="#ff6b00" opacity={0.35} filter="url(#radar-glow)" />
        <polygon points={poly} fill="#ff6b00" fillOpacity={0.14} stroke="#e85d0c" strokeWidth={2.5} strokeLinejoin="round" />
      </g>
      {rows.map(([s, n], i) => {
        const [x, y] = pt(i, n), [lx, ly] = polar(c, c, R + 22, (i / rows.length) * 360)
        const anchor = Math.abs(lx - c) < 8 ? 'middle' : lx > c ? 'start' : 'end'
        const words = stageLabel(s).split(' '), half = Math.ceil(words.length / 2)
        return (
          <g key={s}>
            <circle cx={x} cy={y} r={4} fill="#fff" stroke="#e85d0c" strokeWidth={2} className="a-pop" style={{ ['--d' as string]: `${0.7 + i * 0.08}s` }} />
            <text x={lx} y={ly - 2} textAnchor={anchor} fontSize={10.5} fill="#5e544b">{words.slice(0, half).join(' ')}</text>
            <text x={lx} y={ly + 10} textAnchor={anchor} fontSize={10.5} fill="#5e544b">{words.slice(half).join(' ')} <tspan fontWeight={700} fill="#14100d">{n}</tspan></text>
          </g>
        )
      })}
    </svg>
  )
}
