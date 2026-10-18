'use client'

import Link from 'next/link'
import { useResource, type Resource } from '@/lib/useResource'
import { verdictOf, stageLabel, isStopped } from '@/lib/verdict'
import { ResourceGate, StatePanel, Kpi, VerdictBadge } from '@/components/app/ui'
import { when } from '@/components/DecisionStream'

interface Decision {
  decision: string; stage: string; reason: string; rule_name?: string; severity?: string
  tool: string; session_id: string; at: string
}
interface Agent { agent_id: string; status: string; current_cost: number; last_tool: string; updated_at: string }
interface Audit { ok: boolean; count: number; failed_at?: number; reason?: string }
interface Rules { count: number; note?: string; rules: { name: string; enabled: boolean }[] | null }

const WINDOW = 500
const AGENT_STATUS: Record<string, string> = { BLOCKED: 'Blocked', DEAD: 'Stopped' }
const money = (v: number) => `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`
const cap = (s?: string) => (s ? s[0] + s.slice(1).toLowerCase() : '—')
const known = <T,>(r: Resource<T>) => (r.status === 'ready' ? r.data : null)
const why = (r: Resource<unknown>, failed: string) => (r.status === 'loading' ? 'Loading…' : failed)

export default function IncidentsPage() {
  const decisions = useResource<{ decisions: Decision[] | null }>(`/api/v1/vigil/decisions?limit=${WINDOW}`, { intervalMs: 5000 })
  const agents = useResource<Agent[] | null>('/api/vigil/agents', { intervalMs: 8000 })
  const audit = useResource<Audit>('/api/v1/vigil/audit/verify', { intervalMs: 30000 })
  const rules = useResource<Rules>('/api/vigil/governance/rules', { intervalMs: 60000 })

  const d = known(decisions)
  const all = d ? (d.decisions ?? []) : null // null = unknown, never 0
  const stopped = all ? all.filter(x => isStopped(verdictOf(x.decision, x.stage))).reverse() : null
  const a = known(agents)
  const agentList = agents.status === 'ready' ? (a ?? []) : null
  const troubled = agentList ? agentList.filter(x => x.status === 'BLOCKED' || x.status === 'DEAD') : null
  const log = known(audit)

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Incidents</h1>
      <p className="mb-8">Calls VIGIL stopped, agents that are blocked or stopped, and whether the decision log is still intact.</p>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <Kpi value={stopped ? stopped.length : null} label="Stopped calls"
          note={all ? `Blocked, paused or rewritten, of the last ${all.length} decisions` : why(decisions, 'Could not load the decision log')} />
        <Kpi value={troubled ? troubled.length : null} label="Agents blocked or stopped"
          note={agentList ? `Of ${agentList.length} the server reports` : why(agents, 'Could not load the agent list')} />
        <Kpi value={log ? (log.ok ? 'Intact' : 'Broken') : null} label="Decision log" tone={log && !log.ok ? '#b42318' : undefined}
          note={log ? (log.ok ? `${log.count} entries verified` : `Fails at entry ${log.failed_at ?? '?'}`) : why(audit, 'Could not be checked')} />
      </div>

      {log && !log.ok && (
        <div className="app-banner app-banner-error mt-4" role="alert">
          <VerdictBadge v="critical" solid />
          <span>The decision log failed verification at entry {log.failed_at ?? '?'}{log.reason ? `: ${log.reason}` : ''}. Entries from there on cannot be trusted as evidence.</span>
        </div>
      )}

      <section className="mt-10" aria-labelledby="sc-title">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <h2 id="sc-title" className="app-h2">Stopped calls</h2>
            <p className="app-sub">Newest first, from the server’s recent decision log (up to {WINDOW} decisions). The graph evidence for each is on the Decisions page.</p>
          </div>
          <Link href="/decisions" className="app-btn app-btn-secondary app-btn-sm">Open Decisions</Link>
        </div>
        <ResourceGate r={decisions} loading="Loading stopped calls…" compact
          isEmpty={() => (stopped ?? []).length === 0}
          empty={<StatePanel kind="empty" title="No stopped calls" compact>None of the last {all?.length ?? 0} decisions was blocked, paused or rewritten.</StatePanel>}>
          {() => (
            <div className="app-table-wrap">
              <table className="data-table">
                <thead>
                  <tr><th scope="col">Time</th><th scope="col">Verdict</th><th scope="col">What VIGIL saw</th><th scope="col">Tool</th>
                    <th scope="col">Session</th><th scope="col">Reason</th><th scope="col">Severity</th></tr>
                </thead>
                <tbody>
                  {(stopped ?? []).map((x, i) => (
                    <tr key={`${x.at}-${i}`}>
                      <td className="app-mono whitespace-nowrap"><time dateTime={x.at}>{when(x.at)}</time></td>
                      <td><VerdictBadge v={verdictOf(x.decision, x.stage)} /></td>
                      <td className="text-[13px] min-w-[170px]">{stageLabel(x.stage)}</td>
                      <td className="app-mono">{x.tool}</td>
                      <td className="app-mono break-all min-w-[90px]">{x.session_id || '—'}</td>
                      <td className="text-[13px] text-[#5e544b] min-w-[220px] max-w-[48ch]">{x.rule_name ? `${x.rule_name}: ` : ''}{x.reason}</td>
                      <td className="text-[13px]">{cap(x.severity)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ResourceGate>
      </section>

      <section className="mt-10" aria-labelledby="ab-title">
        <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
          <div>
            <h2 id="ab-title" className="app-h2">Agents blocked or stopped</h2>
            <p className="app-sub">Resume or stop agents from Mission Control.</p>
          </div>
          <Link href="/mission-control" className="app-btn app-btn-secondary app-btn-sm">Open Mission Control</Link>
        </div>
        <ResourceGate r={agents} loading="Loading agents…" compact
          isEmpty={() => (troubled ?? []).length === 0}
          empty={
            <StatePanel kind="empty" title={agentList?.length ? 'No agent is blocked or stopped' : 'No agents have connected yet'} compact>
              {agentList?.length ? `All ${agentList.length} agents the server reports are running or paused.` : 'Agents appear once they connect to this server.'}
            </StatePanel>
          }>
          {() => (
            <div className="app-table-wrap">
              <table className="data-table">
                <thead><tr><th scope="col">Agent</th><th scope="col">Status</th><th scope="col" className="text-right">Spend (est.)</th><th scope="col">Last tool</th><th scope="col">Updated</th></tr></thead>
                <tbody>
                  {(troubled ?? []).map(x => (
                    <tr key={x.agent_id}>
                      <td className="app-mono break-all">{x.agent_id}</td>
                      <td><span className={`pill ${x.status === 'BLOCKED' ? 'pill-red' : 'pill-gray'}`}>{AGENT_STATUS[x.status]}</span></td>
                      <td className="app-mono text-right">{money(x.current_cost ?? 0)}</td>
                      <td className="app-mono">{x.last_tool || '—'}</td>
                      <td className="app-mono whitespace-nowrap">{x.updated_at && !x.updated_at.startsWith('0001') ? when(x.updated_at) : '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </ResourceGate>
      </section>

      <section className="mt-10" aria-labelledby="det-title">
        <h2 id="det-title" className="app-h2">Detectors that can raise an incident</h2>
        <p className="app-sub mb-3">Behaviour rules registered on this server.</p>
        <ResourceGate r={rules} loading="Loading detectors…" compact
          isEmpty={r => !r.rules || r.rules.length === 0}
          empty={<StatePanel kind="empty" title="No detectors registered" compact>The server reports no behaviour rules.</StatePanel>}>
          {r => (
            <div className="app-card p-5">
              <ul className="flex flex-wrap gap-2">
                {(r.rules ?? []).map(x => (
                  <li key={x.name} className="pill pill-gray">{x.name}{x.enabled ? '' : ' (disabled)'}</li>
                ))}
              </ul>
              {r.note && <p className="app-meta mt-3">{r.note}</p>}
            </div>
          )}
        </ResourceGate>
      </section>
    </div>
  )
}
