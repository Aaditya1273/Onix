'use client'

import { useState } from 'react'
import { Download, RefreshCw } from 'lucide-react'
import { useResource } from '@/lib/useResource'
import { describe, ApiError } from '@/lib/api'
import { ResourceGate, StatePanel } from '@/components/app/ui'
import { AXIS, ChartCard, GRID, INK, NEUTRAL, Tip, tipProps, useWidth, type TipState } from '../evidence/charts'

// GET /api/v1/vigil/risk?days=N: per-agent and tenant ("*") scores computed in
// the graph (internal/graph/risk.go), with their inputs and the stored daily
// snapshots. The ledger export goes through this dashboard's server
// (/api/vigil/ledger/export), which adds the operator token for signed-in
// operators; the browser never holds it.

interface Components {
  decisions: number; incidents: number; revocations: number; hidden_effects: number; model_free: number
  mean_blast_radius: number; cost_cv: number; incident_rate: number; model_free_share: number
}
interface Score { scope: string; score: number; components: Components }
interface Snapshot { scope: string; day: string; score: number }
interface Reply { scores: Score[] | null; history: Snapshot[] | null }

const scopeName = (s: string) => (s === '*' ? 'All agents (tenant)' : s)
const DASH = ['', '7 4', '2 3', '10 3 2 3', '4 4', '1 4']

// ---- ledger export: fetch, then download the blob, so failures are shown ----

function ExportLedger({ days }: { days: number }) {
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [done, setDone] = useState('')
  const run = async () => {
    setBusy(true); setErr(''); setDone('')
    try {
      const res = await fetch(`/api/vigil/ledger/export?days=${days}`, { cache: 'no-store', signal: AbortSignal.timeout(70000) })
      if (!res.ok) {
        let b: { error?: string; kind?: string } = {}
        try { b = await res.json() } catch { /* a gateway's HTML page */ }
        setErr(
          res.status === 401 && b.kind === 'unauthorized' ? (b.error || 'Sign in with an operator account to export the ledger.')
            : res.status === 401 ? 'The control plane refused the export: this dashboard has no operator token configured (VIGIL_CONTROL_TOKEN), or it does not match the server.'
              : res.status === 403 ? (b.error || 'Your account is not an operator on this dashboard.')
                : res.status === 404 ? 'This server does not offer the ledger export (the control plane answered 404).'
                  : res.status === 502 || res.status === 503 || res.status === 504 ? describe(new ApiError(b.kind === 'network' ? 'network' : 'sleeping', b.error || ''))
                    : `The export failed (${res.status}${b.error ? `: ${b.error}` : ''}).`)
        return
      }
      const blob = await res.blob()
      const name = /filename="?([^";]+)"?/.exec(res.headers.get('content-disposition') || '')?.[1] || `vigil-ledger-${days}d.json`
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url; a.download = name
      document.body.appendChild(a); a.click(); a.remove()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      setDone(`Downloaded ${name}.`)
    } catch (e) {
      setErr((e as Error).name === 'TimeoutError' ? describe(new ApiError('timeout', '')) : describe(new ApiError('network', '')))
    } finally { setBusy(false) }
  }
  return (
    <div className="flex flex-col items-start gap-1.5">
      <button type="button" onClick={run} disabled={busy} aria-busy={busy} className="app-btn app-btn-primary">
        {busy ? <RefreshCw className="w-4 h-4 animate-spin" aria-hidden="true" /> : <Download className="w-4 h-4" aria-hidden="true" />}
        {busy ? 'Exporting…' : 'Export ledger'}
      </button>
      <div aria-live="polite" className="max-w-[46ch]">
        {err && <p className="app-error-text" role="alert">{err}</p>}
        {done && <p className="app-meta">{done} Verify it with <span className="font-mono">vigil-cli verify-ledger</span>.</p>}
      </div>
    </div>
  )
}

// ---- history: one line per scope over the stored daily snapshots ------------

function History({ history }: { history: Snapshot[] }) {
  const [ref, W] = useWidth<HTMLDivElement>()
  const [tip, setTip] = useState<TipState>(null)
  const days = [...new Set(history.map(h => h.day))].sort()
  const scopes = [...new Set(history.map(h => h.scope))].sort((a, b) => (a === '*' ? -1 : b === '*' ? 1 : a.localeCompare(b)))
  const narrow = W < 560
  const H = 240, L = 34, R = narrow ? 16 : 150, T = 12, B = 28
  // Placed by calendar date, so a day with no snapshot leaves a visible gap.
  const d0 = Date.parse(days[0]), d1 = Date.parse(days[days.length - 1])
  const x = (d: string) => L + (d1 === d0 ? (W - L - R) / 2 : ((Date.parse(d) - d0) / (d1 - d0)) * (W - L - R))
  const y = (s: number) => T + (1 - s / 100) * (H - T - B)
  const every = Math.max(1, Math.ceil(days.length / Math.max(2, Math.floor((W - L - R) / 56))))
  let labelY: Record<string, number> = {}
  return (
    <div ref={ref} className="relative" onMouseLeave={() => setTip(null)}>
      {W > 0 && (
        <svg width={W} height={H} role="group" aria-label="Risk score per day and scope">
          {[0, 25, 50, 75, 100].map(v => (
            <g key={v}><line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={GRID} /><text x={L - 6} y={y(v) + 4} textAnchor="end" fontSize={11} fill={AXIS}>{v}</text></g>
          ))}
          {days.map((d, i) => i % every === 0 && <text key={d} x={x(d)} y={H - 8} fontSize={11} fill={AXIS} textAnchor="middle">{d.slice(5)}</text>)}
          {(() => {
            // End labels: when two series end at the same score, stack the labels instead of printing them on top of each other.
            const ends = scopes.map(sc => { const ps = history.filter(h => h.scope === sc).sort((a, b) => a.day.localeCompare(b.day)); const l = ps[ps.length - 1]; return l ? { sc, y: y(l.score) + 4 } : null }).filter(Boolean) as { sc: string; y: number }[]
            ends.sort((a, b) => a.y - b.y)
            for (let k = 1; k < ends.length; k++) if (ends[k].y - ends[k - 1].y < 15) ends[k].y = ends[k - 1].y + 15
            labelY = Object.fromEntries(ends.map(e => [e.sc, e.y]))
            return null
          })()}
          {scopes.map((s, i) => {
            const pts = history.filter(h => h.scope === s).sort((a, b) => a.day.localeCompare(b.day))
            const tenant = s === '*', c = tenant ? INK : NEUTRAL, last = pts[pts.length - 1]
            return (
              <g key={s}>
                <polyline fill="none" stroke={c} strokeWidth={tenant ? 2.5 : 1.75} strokeDasharray={DASH[i % DASH.length]} points={pts.map(p => `${x(p.day)},${y(p.score)}`).join(' ')} />
                {pts.map(p => (
                  <g key={p.day} {...tipProps(setTip, x(p.day), y(p.score) - 6, `${scopeName(s)}, ${p.day}: ${p.score.toFixed(1)}`, <><b>{scopeName(s)}</b><br />{p.day}: {p.score.toFixed(1)}</>)}>
                    <circle cx={x(p.day)} cy={y(p.score)} r={tenant ? 4 : 3.5} fill={c} stroke="#fff" strokeWidth={1.5} />
                  </g>
                ))}
                {!narrow && last && <text x={W - R + 10} y={labelY[s] ?? y(last.score) + 4} fontSize={12} fill={c} fontWeight={tenant ? 600 : 400}>{(tenant ? 'tenant' : s).slice(0, 18)}</text>}
              </g>
            )
          })}
        </svg>
      )}
      <Tip tip={tip} width={W} />
      {narrow && (
        <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[12.5px] text-[#5e544b]" aria-label="Legend">
          {scopes.map((s, i) => (
            <li key={s} className="inline-flex items-center gap-1.5">
              <svg width="22" height="8" aria-hidden="true"><line x1="1" x2="21" y1="4" y2="4" stroke={s === '*' ? INK : NEUTRAL} strokeWidth={2} strokeDasharray={DASH[i % DASH.length]} /></svg>{s === '*' ? 'tenant' : s}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

// ---- the window's scores ------------------------------------------------------

function ScoreCell({ s }: { s: Score }) {
  if (!s.components.decisions) return <span className="text-[#6b6158]">— <span className="app-meta">no decisions</span></span>
  return (
    <span className="flex items-center gap-2 min-w-[120px]">
      <span className="font-semibold tabular-nums w-10">{s.score.toFixed(1)}</span>
      <span className="h-2 flex-1 rounded-full bg-[#f5f1ea]" aria-hidden="true"><span className="block h-full rounded-full bg-[#14100d]" style={{ width: `${Math.min(100, s.score)}%` }} /></span>
    </span>
  )
}

function RiskView({ days }: { days: number }) {
  const r = useResource<Reply>(`/api/v1/vigil/risk?days=${days}`, { intervalMs: 60000 })
  const win = `last ${days} day${days === 1 ? '' : 's'}`
  return (
    <ResourceGate r={r} loading="Computing scores from the graph…">
      {d => {
        const scores = [...(d.scores ?? [])].sort((a, b) => (a.scope === '*' ? -1 : b.scope === '*' ? 1 : b.score - a.score))
        const history = d.history ?? []
        return (
          <>
            <section aria-labelledby="scores-h">
              <h2 id="scores-h" className="app-h2">Scores, {win}</h2>
              <p className="app-sub mt-1 mb-3">0 means no observed risk, 100 the most. It is a weighted sum of what the graph saw, not a probability. A scope with no decisions has no score.</p>
              {scores.length === 0 ? (
                <StatePanel kind="empty" title={`No decisions in the ${win}`}>There is nothing to score yet: risk is unknown, not zero.</StatePanel>
              ) : (
                <div className="app-table-wrap">
                  <table className="data-table">
                    <caption className="sr-only">Risk score and its inputs per scope, {win}</caption>
                    <thead>
                      <tr>
                        <th scope="col">Scope</th><th scope="col">Score (0–100)</th><th scope="col" className="text-right">Decisions</th>
                        <th scope="col" className="text-right">Incident rate</th><th scope="col" className="text-right">Rug pulls</th><th scope="col" className="text-right">Hidden effects</th>
                        <th scope="col" className="text-right">Mean blast radius</th><th scope="col" className="text-right">Cost CV</th><th scope="col" className="text-right">Model-free</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scores.map(s => {
                        const c = s.components, none = !c.decisions
                        return (
                          <tr key={s.scope}>
                            <td className={`app-mono whitespace-nowrap ${s.scope === '*' ? 'font-semibold' : ''}`}>{scopeName(s.scope)}</td>
                            <td><ScoreCell s={s} /></td>
                            <td className="text-right tabular-nums">{c.decisions.toLocaleString()}</td>
                            <td className="text-right tabular-nums">{none ? '—' : `${(c.incident_rate * 100).toFixed(1)}%`} <span className="app-meta">{none ? '' : `(${c.incidents})`}</span></td>
                            <td className="text-right tabular-nums">{c.revocations}</td>
                            <td className="text-right tabular-nums">{c.hidden_effects}</td>
                            <td className="text-right tabular-nums">{c.mean_blast_radius.toFixed(1)}</td>
                            <td className="text-right tabular-nums">{c.cost_cv.toFixed(2)}</td>
                            <td className="text-right tabular-nums">{none ? '—' : `${(c.model_free_share * 100).toFixed(0)}%`}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              )}
              <details className="mt-3 app-card px-4 py-3">
                <summary className="cursor-pointer text-[13px] font-semibold">How the score is computed</summary>
                <div className="mt-2 text-[13px] leading-[20px] text-[#5e544b] space-y-2">
                  <p className="font-mono text-[12.5px] text-[#14100d] break-words">100 × (0.35·incident rate + 0.15·min(1, rug pulls/3) + 0.15·min(1, hidden effects/3) + 0.15·min(1, mean blast radius/10) + 0.10·min(1, cost CV) + 0.10·(1 − model-free share))</p>
                  <ul className="list-disc pl-5 space-y-0.5">
                    <li><b>Incident rate</b>: decisions that were not allowed, over all decisions.</li>
                    <li><b>Rug pulls</b>: calls paused because a tool&apos;s description changed after it was trusted.</li>
                    <li><b>Hidden effects</b>: calls that did something their prediction did not cover.</li>
                    <li><b>Mean blast radius</b>: average number of dependents (4 hops of DEPENDS_ON) of packages the agent was allowed to install.</li>
                    <li><b>Cost CV</b>: standard deviation over mean of executed calls&apos; cost.</li>
                    <li><b>Model-free</b>: share of decisions made from the graph alone, without a model.</li>
                  </ul>
                </div>
              </details>
            </section>

            <div className="mt-8">
              <ChartCard title="Risk over time" sub={`One point per stored daily snapshot (RiskSnapshot nodes) in the ${win}; the latest is today's. Hover or focus a point for its value.`}
                table={{ caption: 'Daily risk snapshots', head: ['Day', 'Scope', 'Score'], rows: [...history].sort((a, b) => b.day.localeCompare(a.day) || a.scope.localeCompare(b.scope)).map(h => [h.day, scopeName(h.scope), h.score.toFixed(1)]) }}>
                {history.length ? <History history={history} /> : <p className="app-sub py-6 text-center">No snapshots stored in this window yet. One is stored each day the server runs.</p>}
              </ChartCard>
            </div>
          </>
        )
      }}
    </ResourceGate>
  )
}

export default function RiskPage() {
  const [days, setDays] = useState(7)
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Agent risk</h1>
      <p>A 0–100 score per agent, computed only from the graph: refusals, rug pulls, hidden side effects, blast radius, cost volatility and reliance on a model.</p>

      <div className="mt-6 flex flex-wrap items-start gap-4">
        <div className="app-field w-[160px]">
          <label htmlFor="risk-window">Window</label>
          <select id="risk-window" value={days} onChange={e => setDays(Number(e.target.value))} className="app-input">
            {[1, 7, 30, 90].map(d => <option key={d} value={d}>Last {d} day{d > 1 ? 's' : ''}</option>)}
          </select>
        </div>
        <div className="app-field">
          <span className="text-[13px] font-semibold">Hash-chained decision ledger, same window</span>
          <ExportLedger days={days} />
        </div>
      </div>

      <div className="mt-8"><RiskView key={days} days={days} /></div>
    </div>
  )
}
