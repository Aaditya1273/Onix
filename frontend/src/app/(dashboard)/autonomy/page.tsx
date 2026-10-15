'use client'

import { useEffect, useState } from 'react'
import { ShieldCheck, AlertTriangle, Link2 } from 'lucide-react'

interface Autonomy {
  agent: string
  repo?: string
  tool: string
  capabilities: string
  clean_since_last_incident: number
}

interface Digest {
  decisions: number
  by_verdict: Record<string, number>
  by_stage: Record<string, number>
  model_free_fraction: number
  graph_queried: number
  graph_ms_p50: number
  graph_ms_p95: number
  autonomy: Autonomy[]
  chain_links: number
  chain_broken: number
}

interface Reply {
  days: number
  observe_mode: boolean
  trust_threshold: number
  digest: Digest
}

// Why each stage refused a call, in the words a digest reader needs.
const STAGE_LABEL: Record<string, string> = {
  code_graph: 'Typosquats and blocked packages',
  exfiltration: 'Secrets headed off the machine',
  provenance: 'Commands carrying external content',
  tool_drift: 'Tools whose description changed',
  entity_policy: 'Shares with protected people',
  intent: 'Outside declared intent',
  behavior: 'Behavioral detectors',
  forecast: 'Budget',
  judge: 'Model judgement',
}

export default function AutonomyPage() {
  const [r, setR] = useState<Reply | null>(null)
  const [err, setErr] = useState('')

  useEffect(() => {
    const load = async () => {
      try {
        const res = await fetch('/api/v1/vigil/digest?days=7', { cache: 'no-store' })
        if (!res.ok) {
          setErr(res.status === 503 ? 'FalkorDB is not configured on the server (VIGIL_FALKORDB_URL).' : 'Control plane unreachable.')
          return
        }
        setR(await res.json()); setErr('')
      } catch { setErr('Control plane unreachable.') }
    }
    load()
    const t = setInterval(load, 10000)
    return () => clearInterval(t)
  }, [])

  const d = r?.digest
  const refused = (d?.by_verdict.BLOCK ?? 0) + (d?.by_verdict.PAUSE ?? 0)
  const stages = Object.entries(d?.by_stage ?? {}).filter(([s]) => s !== 'default').sort((a, b) => b[1] - a[1])

  return (
    <div className="p-8 max-w-6xl mx-auto animate-fadeIn">
      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Earned Autonomy</h1>
          <p className="text-sm text-gray-500 mt-1">
            The last 7 days from the graph: what was stopped, and which calls agents have earned the right to run without a prompt.
          </p>
        </div>
        {r && (
          <span className={`pill ${r.observe_mode ? 'pill-orange' : 'pill-green'}`}>
            {r.observe_mode ? 'Observe mode: nothing blocked' : 'Enforcing'}
          </span>
        )}
      </div>

      {err && (
        <div className="px-4 py-3 rounded-xl bg-orange-50 border border-orange-200 text-orange-700 text-sm flex items-center gap-2 mb-6">
          <AlertTriangle className="w-4 h-4" />
          {err}
        </div>
      )}

      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { l: r?.observe_mode ? 'Would have stopped' : 'Stopped', v: refused, hi: refused > 0 },
          { l: 'Decisions', v: d?.decisions ?? 0 },
          { l: 'Without a model', v: d ? `${Math.round(d.model_free_fraction * 100)}%` : '–' },
          { l: 'Graph p50 / p95', v: d && d.graph_queried > 0 ? `${d.graph_ms_p50.toFixed(1)} / ${d.graph_ms_p95.toFixed(1)} ms` : '–' },
        ].map(x => (
          <div key={x.l} className="stat-card text-center">
            <p className="text-[11px] text-gray-500 font-medium uppercase tracking-wider">{x.l}</p>
            <p className={`text-2xl font-bold mt-1 ${x.hi ? 'text-orange-600' : 'text-gray-900'}`}>{x.v}</p>
          </div>
        ))}
      </div>

      <div className="card overflow-hidden mb-6">
        <div className="px-6 py-4 border-b border-gray-100 flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-orange-600" />
          <h2 className="text-sm font-semibold text-gray-800">Autonomy earned</h2>
          {r && <span className="text-xs text-gray-400 ml-auto">{r.trust_threshold} clean runs since the last incident skip the prompt</span>}
        </div>
        {(d?.autonomy.length ?? 0) === 0 ? (
          <div className="py-12 text-center">
            <ShieldCheck className="w-8 h-8 text-gray-300 mx-auto" />
            <p className="text-sm text-gray-500 mt-2">Nothing earned yet</p>
            <p className="text-xs text-gray-400 mt-1">Every clean, executed call is evidence; any refusal or tool change resets it.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="data-table">
              <thead>
                <tr><th>Agent</th><th>Repo</th><th>Tool</th><th>Capabilities</th><th>Clean runs</th></tr>
              </thead>
              <tbody>
                {d!.autonomy.map(a => (
                  <tr key={`${a.agent}|${a.repo}|${a.tool}|${a.capabilities}`}>
                    <td className="font-mono text-xs">{a.agent}</td>
                    <td className="font-mono text-xs text-gray-500">{a.repo || '—'}</td>
                    <td className="font-mono text-xs">{a.tool}</td>
                    <td>{a.capabilities ? a.capabilities.split(',').map(c => <span key={c} className="pill pill-gray mr-1">{c}</span>) : <span className="text-gray-400 text-xs">none</span>}</td>
                    <td><span className="pill pill-green">{a.clean_since_last_incident}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="grid grid-cols-2 gap-6">
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4">What was stopped, and why</h2>
          {stages.length === 0 ? (
            <p className="text-xs text-gray-400">Nothing refused in this window.</p>
          ) : (
            <ul className="space-y-2">
              {stages.map(([stage, n]) => (
                <li key={stage} className="flex justify-between text-sm">
                  <span className="text-gray-700">{STAGE_LABEL[stage] ?? stage}</span>
                  <span className="font-mono text-xs text-gray-900">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="card p-6">
          <h2 className="text-sm font-semibold text-gray-800 mb-4 flex items-center gap-2">
            <Link2 className="w-4 h-4 text-orange-600" /> Decision chain in the graph
          </h2>
          <p className="text-sm text-gray-700">
            {d ? `${d.chain_links} linked decision(s), ${d.chain_broken} broken link(s).` : '–'}
          </p>
          <p className="text-xs text-gray-400 mt-2">
            Every decision is a node whose PREV edge must reach exactly the hash it names; the audit ledger on disk is the source of truth this mirrors.
          </p>
          {d && d.chain_broken > 0 && (
            <p className="text-xs text-orange-700 mt-2">A broken link means a decision was dropped or rewritten after the fact.</p>
          )}
        </div>
      </div>
    </div>
  )
}
