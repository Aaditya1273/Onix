'use client'

import { useEffect, useState } from 'react'
import { Scissors, AlertTriangle } from 'lucide-react'
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
    try {
      const r = await fetch(`/api/v1/vigil/decisions/${encodeURIComponent(d.id)}/flow`, { cache: 'no-store' })
      if (r.ok) setFlow(await r.json())
    } catch { /* the panel says there is no network */ }
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
                  <td><span className={`pill ${VERDICT_PILL[d.verdict] ?? 'pill-gray'}`}>{d.verdict}</span></td>
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
        </div>
      )}
    </div>
  )
}
