'use client'

import { useResource } from '@/lib/useResource'
import { verdictOf, stageLabel } from '@/lib/verdict'
import { ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'

export interface Decision {
  decision: 'ALLOW' | 'PAUSE' | 'BLOCK' | 'FALLBACK'
  stage: string
  reason: string
  rule_name?: string
  tool: string
  session_id: string
  risk_score: number
  model_used?: string
  cost: number
  at: string
}

const POLL_MS = 3000

/** "18:23:51" today, "Oct 15, 18:23:51" on another day. */
export function when(at: string | number) {
  const d = new Date(at)
  if (Number.isNaN(d.getTime())) return '—'
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  return d.toDateString() === new Date().toDateString() ? time : `${d.toLocaleDateString([], { month: 'short', day: 'numeric' })}, ${time}`
}

/** How the decision was reached: the graph signal in plain words, or the model that reviewed it. */
function decidedBy(d: Decision) {
  if (d.stage === 'judge') return d.model_used ? `Model review (${d.model_used})` : 'Model review'
  return stageLabel(d.stage)
}

export function DecisionStream({ sessionId }: { sessionId?: string }) {
  const q = sessionId ? `?session=${encodeURIComponent(sessionId)}&limit=20` : '?limit=20'
  const res = useResource<{ decisions: Decision[] | null }>(`/api/v1/vigil/decisions${q}`, { intervalMs: POLL_MS })
  // Newest first for reading; the API returns oldest-first.
  const rows = (d: { decisions: Decision[] | null }) => (d.decisions ?? []).slice().reverse()

  return (
    <section className="mt-10" aria-labelledby="ds-title">
      <div className="flex flex-wrap items-end justify-between gap-2 mb-3">
        <div>
          <h2 id="ds-title" className="app-h2">Recent decisions</h2>
          <p className="app-sub">The last 20 tool calls VIGIL decided on, newest first. Model risk is — when no model was consulted, which is most calls.</p>
        </div>
        <p className="app-meta" aria-live="polite">
          {res.status === 'ready' && !res.stale && res.loadedAt
            ? <>Checked every {POLL_MS / 1000} s · last checked {when(res.loadedAt)}</>
            : res.stale ? 'Not updating: the last check failed' : null}
        </p>
      </div>

      <ResourceGate r={res} loading="Loading recent decisions…" compact
        isEmpty={d => rows(d).length === 0}
        empty={<StatePanel kind="empty" title="No decisions yet" compact>Every tool call VIGIL decides on appears here, with its verdict and the reason.</StatePanel>}>
        {d => (
          <div className="app-table-wrap">
            <table className="data-table">
              <thead>
                <tr>
                  <th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Verdict</th>
                  <th scope="col">Decided by</th><th scope="col">Reason</th>
                  <th scope="col" className="text-right">Model risk</th><th scope="col" className="text-right">Est. cost</th>
                </tr>
              </thead>
              <tbody>
                {rows(d).map((r, i) => (
                  <tr key={`${r.at}-${i}`}>
                    <td className="app-mono whitespace-nowrap"><time dateTime={r.at}>{when(r.at)}</time></td>
                    <td className="app-mono">{r.tool}</td>
                    <td><VerdictBadge v={verdictOf(r.decision, r.stage)} /></td>
                    <td className="text-[13px] min-w-[160px]">{decidedBy(r)}</td>
                    <td className="text-[13px] text-[#5e544b] min-w-[220px] max-w-[48ch]">{r.rule_name ? `${r.rule_name}: ` : ''}{r.reason}</td>
                    {/* -1 means no model was consulted (the common case); 0 would read as "a model found no risk". */}
                    <td className="app-mono text-right whitespace-nowrap">
                      {r.risk_score < 0 ? <span title="No model was consulted for this call">—</span> : `${r.risk_score} / 100`}
                    </td>
                    <td className="app-mono text-right whitespace-nowrap">${r.cost.toFixed(4)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </ResourceGate>
    </section>
  )
}
