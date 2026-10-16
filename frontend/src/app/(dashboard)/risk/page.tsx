'use client'

import { useEffect, useState } from 'react'
import { Gauge, AlertTriangle, Download } from 'lucide-react'

interface Components {
  decisions: number
  incidents: number
  revocations: number
  hidden_effects: number
  model_free: number
  mean_blast_radius: number
  cost_cv: number
  incident_rate: number
  model_free_share: number
}

interface Score {
  scope: string
  score: number
  components: Components
}

interface Snapshot {
  scope: string
  day: string
  score: number
}

function tone(s: number) {
  return s >= 50 ? 'text-red-600' : s >= 20 ? 'text-orange-600' : 'text-green-600'
}

// One line per scope over the stored daily snapshots.
function History({ history }: { history: Snapshot[] }) {
  const days = [...new Set(history.map(h => h.day))].sort()
  const scopes = [...new Set(history.map(h => h.scope))]
  if (days.length === 0) return <p className="text-xs text-gray-400">No snapshots stored yet.</p>
  const W = 640, H = 180, P = 28
  const x = (d: string) => P + (days.length === 1 ? (W - 2 * P) / 2 : (days.indexOf(d) * (W - 2 * P)) / (days.length - 1))
  const y = (s: number) => H - P - (s / 100) * (H - 2 * P)
  const colors = ['#ea580c', '#2563eb', '#16a34a', '#9333ea', '#dc2626', '#0891b2']
  return (
    <>
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label="Risk score per day">
      {[0, 50, 100].map(v => (
        <g key={v}>
          <line x1={P} x2={W - P} y1={y(v)} y2={y(v)} stroke="#e5e7eb" />
          <text x={4} y={y(v) + 4} fontSize="10" fill="#9ca3af">{v}</text>
        </g>
      ))}
      {days.map(d => <text key={d} x={x(d)} y={H - 8} fontSize="10" fill="#9ca3af" textAnchor="middle">{d.slice(5)}</text>)}
      {scopes.map((s, i) => {
        const pts = history.filter(h => h.scope === s).sort((a, b) => a.day.localeCompare(b.day))
        const c = colors[i % colors.length]
        return (
          <g key={s}>
            <polyline fill="none" stroke={c} strokeWidth={2} points={pts.map(p => `${x(p.day)},${y(p.score)}`).join(' ')} />
            {pts.map(p => <circle key={p.day} cx={x(p.day)} cy={y(p.score)} r={3} fill={c}><title>{`${s} ${p.day}: ${p.score}`}</title></circle>)}
          </g>
        )
      })}
    </svg>
    <div className="flex flex-wrap gap-4 mt-2">
      {scopes.map((s, i) => (
        <span key={s} className="flex items-center gap-1.5 text-xs text-gray-600">
          <span className="w-3 h-0.5" style={{ background: colors[i % colors.length] }} />{s === '*' ? 'tenant' : s}
        </span>
      ))}
    </div>
    </>
  )
}

export default function RiskPage() {
  const [days, setDays] = useState(7)
  const [scores, setScores] = useState<Score[]>([])
  const [history, setHistory] = useState<Snapshot[]>([])
  const [err, setErr] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch(`/api/v1/vigil/risk?days=${days}`, { cache: 'no-store' })
        if (!r.ok) { setErr(r.status === 404 ? 'FalkorDB is not configured on the server.' : 'Control plane unreachable.'); return }
        const body = await r.json()
        setScores(body.scores ?? []); setHistory(body.history ?? []); setErr('')
      } catch { setErr('Control plane unreachable.') }
    }
    load()
    const t = setInterval(load, 30000)
    return () => clearInterval(t)
  }, [days])

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fadeIn">
      <div className="mb-8 flex items-start gap-4">
        <div className="flex-1">
          <h1 className="text-2xl font-bold text-gray-900">Agent Risk</h1>
          <p className="text-sm text-gray-500 mt-1">
            A 0–100 score per agent, computed only from the graph: refusals, rug-pull pauses, hidden side effects,
            blast radius of installed packages, cost volatility and reliance on a model. Snapshotted daily.
          </p>
        </div>
        <select value={days} onChange={e => setDays(Number(e.target.value))} className="text-sm border border-gray-200 rounded-lg px-2 py-1" aria-label="Window">
          {[1, 7, 30, 90].map(d => <option key={d} value={d}>{d} day{d > 1 ? 's' : ''}</option>)}
        </select>
        <a href={`/api/v1/vigil/ledger/export?days=${days}`} className="btn-orange inline-flex items-center gap-2 text-sm" download>
          <Download className="w-4 h-4" /> Export Ledger
        </a>
      </div>

      {err && (
        <div className="px-4 py-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-sm flex items-center gap-2 mb-6">
          <AlertTriangle className="w-4 h-4" /> {err}
        </div>
      )}

      <div className="card overflow-hidden mb-6">
        <div className="overflow-x-auto">
          <table className="data-table">
            <thead>
              <tr><th>Scope</th><th>Score</th><th>Decisions</th><th>Incident rate</th><th>Rug pulls</th><th>Hidden effects</th><th>Mean blast</th><th>Cost CV</th><th>Model-free</th></tr>
            </thead>
            <tbody>
              {scores.length === 0 && (
                <tr><td colSpan={9} className="text-center text-xs text-gray-400 py-8">No decisions in this window.</td></tr>
              )}
              {scores.map(s => (
                <tr key={s.scope} className={s.scope === '*' ? 'font-semibold' : ''}>
                  <td className="font-mono text-xs">{s.scope === '*' ? 'tenant (all agents)' : s.scope}</td>
                  <td className={`font-mono text-sm ${tone(s.score)}`}>{s.score.toFixed(1)}</td>
                  <td className="font-mono text-xs">{s.components.decisions}</td>
                  <td className="font-mono text-xs">{(s.components.incident_rate * 100).toFixed(0)}%</td>
                  <td className="font-mono text-xs">{s.components.revocations}</td>
                  <td className="font-mono text-xs">{s.components.hidden_effects}</td>
                  <td className="font-mono text-xs">{s.components.mean_blast_radius.toFixed(1)}</td>
                  <td className="font-mono text-xs">{s.components.cost_cv.toFixed(2)}</td>
                  <td className="font-mono text-xs">{(s.components.model_free_share * 100).toFixed(0)}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card p-6">
        <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
          <Gauge className="w-4 h-4 text-orange-600" /> Risk over time (daily RiskSnapshot nodes)
        </h2>
        <History history={history} />
      </div>
    </div>
  )
}
