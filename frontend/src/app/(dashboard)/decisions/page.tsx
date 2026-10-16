'use client'

import { useEffect, useState } from 'react'
import { Scissors, AlertTriangle, Eye, HelpCircle } from 'lucide-react'
import { EntityGraph, type GraphContext } from '@/components/EntityGraph'

interface DecisionRow {
  id: string
  ts: number
  agent: string
  session: string
  tool: string
  verdict: string
  stage: string
  reason: string
  cut_edges: string[]
  cut_cost: number
  hidden_effect: boolean
}

interface EffectRef {
  kind: string
  name: string
  hidden?: boolean
}

interface WhyAnswer {
  flips: boolean
  edge?: string
  cause_decision?: string
  sentence: string
  method: string
}

interface Effects {
  predicted: EffectRef[]
  observed: EffectRef[]
  hidden_effect: boolean
}

interface FlowEdge {
  from: string
  kind: string
  to: string
  cap: number
  cut: boolean
}

const VERDICT_PILL: Record<string, string> = {
  BLOCK: 'pill-red',
  PAUSE: 'pill-orange',
  ALLOW: 'pill-green',
}

function fmtCap(c: number) {
  return c >= 1_000_000 ? '∞' : String(c)
}

export default function DecisionsPage() {
  const [rows, setRows] = useState<DecisionRow[]>([])
  const [err, setErr] = useState('')
  const [sel, setSel] = useState<DecisionRow | null>(null)
  const [flow, setFlow] = useState<{ edges: FlowEdge[]; graph_context: GraphContext } | null>(null)
  const [effects, setEffects] = useState<Effects | null>(null)
  const [why, setWhy] = useState<WhyAnswer | null>(null)

  const askWhy = async (d: DecisionRow) => {
    try {
      const r = await fetch(`/api/v1/vigil/decisions/${encodeURIComponent(d.id)}/why`, { cache: 'no-store' })
      if (r.ok) setWhy(await r.json())
    } catch { /* leave the panel without an answer */ }
  }

  useEffect(() => {
    const load = async () => {
      try {
        const r = await fetch('/api/v1/vigil/graph/decisions?limit=40', { cache: 'no-store' })
        if (!r.ok) { setErr(r.status === 503 ? 'FalkorDB is not configured on the server.' : 'Control plane unreachable.'); return }
        const body = await r.json()
        setRows(body.decisions ?? []); setErr('')
      } catch { setErr('Control plane unreachable.') }
    }
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const open = async (d: DecisionRow) => {
    setSel(d)
    setFlow(null)
    setEffects(null)
    setWhy(null)
    const id = encodeURIComponent(d.id)
    try {
      const [f, e] = await Promise.all([
        fetch(`/api/v1/vigil/decisions/${id}/flow`, { cache: 'no-store' }),
        fetch(`/api/v1/vigil/calls/${id}/effects`, { cache: 'no-store' }),
      ])
      if (f.ok) setFlow(await f.json())
      if (e.ok) setEffects(await e.json())
    } catch { /* the panels say there is nothing */ }
  }

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fadeIn">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Decisions</h1>
        <p className="text-sm text-gray-500 mt-1">
          Every call VIGIL stopped, paused or rewrote, straight from the graph. Pick one to see the influence network
          FalkorDB&apos;s max-flow ran over, and the edges its minimum cut severed.
        </p>
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
              <tr><th>When</th><th>Agent</th><th>Tool</th><th>Verdict</th><th>Stage</th><th>Cut</th></tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr><td colSpan={6} className="text-center text-xs text-gray-400 py-8">Nothing stopped or rewritten yet.</td></tr>
              )}
              {rows.map(d => (
                <tr key={d.id} onClick={() => open(d)} className={`cursor-pointer ${sel?.id === d.id ? 'bg-orange-50' : ''}`}>
                  <td className="font-mono text-xs">{new Date(d.ts / 1e6).toLocaleTimeString()}</td>
                  <td className="font-mono text-xs">{d.agent}</td>
                  <td className="font-mono text-xs">{d.tool}</td>
                  <td>
                    <span className={`pill ${VERDICT_PILL[d.verdict] ?? 'pill-gray'}`}>{d.verdict}</span>
                    {d.hidden_effect && <span className="pill pill-red ml-1">hidden effect</span>}
                  </td>
                  <td className="font-mono text-xs">{d.stage}</td>
                  <td className="font-mono text-xs">{d.cut_edges.length ? `${d.cut_edges.join(', ')} · cost ${d.cut_cost}` : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {sel && (
        <div className="card p-6">
          <div className="flex items-center gap-2 mb-2">
            <Scissors className="w-4 h-4 text-orange-600" />
            <h2 className="text-sm font-semibold text-gray-800">{sel.tool} · {sel.verdict}</h2>
            <span className="font-mono text-[11px] text-gray-400 ml-auto">{sel.id}</span>
          </div>
          <p className="text-sm text-gray-600 mb-4">{sel.reason}</p>

          {(sel.verdict !== 'ALLOW' || sel.cut_edges.length > 0) && (
            <div className="mb-4">
              <button onClick={() => askWhy(sel)} className="btn-orange inline-flex items-center gap-2 text-sm">
                <HelpCircle className="w-4 h-4" /> Why?
              </button>
              {why && (
                <div className={`mt-3 px-4 py-3 rounded-xl border text-sm ${why.flips ? 'bg-orange-50 border-orange-200 text-gray-800' : 'bg-gray-50 border-gray-200 text-gray-600'}`}>
                  <p>{why.sentence}</p>
                  {why.edge && <p className="font-mono text-xs text-gray-500 mt-2">counterfactual edge: {why.edge}</p>}
                </div>
              )}
            </div>
          )}

          {flow && flow.edges.length > 0 ? (
            <>
              <EntityGraph graphContext={flow.graph_context} height={380} />
              <table className="data-table mt-4">
                <thead><tr><th>From</th><th>Edge</th><th>To</th><th>Capacity</th><th></th></tr></thead>
                <tbody>
                  {flow.edges.map((e, i) => (
                    <tr key={i} className={e.cut ? 'bg-red-50' : ''}>
                      <td className="font-mono text-xs">{e.from}</td>
                      <td className="font-mono text-xs">{e.kind}</td>
                      <td className="font-mono text-xs">{e.to}</td>
                      <td className="font-mono text-xs">{fmtCap(e.cap)}</td>
                      <td>{e.cut && <span className="pill pill-red">✂ cut</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : (
            <p className="text-xs text-gray-400">No influence network: no tainted value reached this call, so no cut was computed.</p>
          )}

          {effects && (effects.predicted.length > 0 || effects.observed.length > 0) && (
            <div className="mt-6">
              <h3 className="text-xs font-semibold text-gray-800 uppercase tracking-wide mb-3 flex items-center gap-2">
                <Eye className="w-4 h-4 text-orange-600" /> Shadow execution: predicted vs observed
              </h3>
              <div className="grid grid-cols-2 gap-4">
                {(['predicted', 'observed'] as const).map(side => (
                  <div key={side} className="rounded-xl border border-gray-100 p-4">
                    <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider mb-2">{side}</p>
                    {effects[side].length === 0 && <p className="text-xs text-gray-400">nothing reported</p>}
                    <ul className="space-y-1">
                      {effects[side].map((e, i) => (
                        <li key={i} className={`font-mono text-xs px-2 py-1 rounded ${e.hidden ? 'bg-red-50 text-red-700' : 'text-gray-700'}`}>
                          {e.kind}: {e.name}{e.hidden && '  ← hidden side effect'}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
