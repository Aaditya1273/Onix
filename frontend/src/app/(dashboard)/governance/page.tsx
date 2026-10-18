'use client'

import { useResource } from '@/lib/useResource'
import { describe } from '@/lib/api'
import { ResourceGate, StatePanel, Kpi } from '@/components/app/ui'

interface Rule { name: string; enabled: boolean; source?: string }
interface Rules { rules: Rule[] | null; count: number; note?: string }
interface Digest { days: number; observe_mode: boolean; digest: { decisions: number; by_stage?: Record<string, number> } }

export default function GovernancePage() {
  const rules = useResource<Rules>('/api/vigil/governance/rules', { intervalMs: 30000 })
  const digest = useResource<Digest>('/api/v1/vigil/digest?days=7', { intervalMs: 60000 })
  const d = digest.data

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Governance</h1>
      <p>The behavioral detectors registered on this server. Each one runs on every MCP tool call, inside the firewall.</p>

      {d?.observe_mode && (
        <div className="app-banner app-banner-warn mt-6" role="status">
          Observe mode is on: VIGIL records what it would decide for Claude Code hook calls, but does not enforce it.
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-6">
        <Kpi value={rules.data ? rules.data.count : null} label="Detectors registered"
          note={rules.status === 'error' ? 'Could not load the rule list.' : 'Reported by the server, not configured here.'} />
        <Kpi value={d ? (d.digest.by_stage?.behavior ?? 0) : null} label={`Calls blocked by a detector, last ${d?.days ?? 7} days`}
          note={d ? `Out of ${d.digest.decisions} decisions recorded in the graph.` : digest.status === 'loading' ? 'Loading…' : describe(digest.error)} />
      </div>

      <section className="mt-8" aria-labelledby="det-h">
        <h2 id="det-h" className="app-h2">Registered detectors</h2>
        <p className="app-sub mt-1 mb-4">
          A detector that fires at critical severity blocks the call; at high severity the call is escalated for model review (when a model is configured); lower severities are recorded as signals.
        </p>
        <ResourceGate r={rules} loading="Loading detectors…" isEmpty={x => !x.rules?.length}
          empty={<StatePanel kind="empty" title="No detectors registered">The server reports no behavioral detectors, so this stage does not run.</StatePanel>}>
          {x => (
            <>
              <div className="app-table-wrap">
                <table className="data-table">
                  <thead><tr><th scope="col">Detector</th><th scope="col">State</th></tr></thead>
                  <tbody>
                    {x.rules!.map(r => (
                      <tr key={r.name}>
                        <td className="font-medium">{r.name}</td>
                        <td>{r.enabled ? 'Registered' : 'Not registered'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {x.note && <p className="app-meta mt-3 max-w-[80ch]">{x.note}</p>}
            </>
          )}
        </ResourceGate>
      </section>
    </div>
  )
}
