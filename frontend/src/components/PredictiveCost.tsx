'use client'

import { AlertTriangle } from 'lucide-react'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel } from '@/components/app/ui'

export interface Forecast {
  current_cost: number
  budget: number
  burn_rate_per_min: number
  projected_total: number
  time_to_breach_seconds: number
  will_breach: boolean
  // "" when the server has no MCP session to forecast.
  state: '' | 'insufficient_history' | 'stable' | 'soft_limit' | 'hard_limit'
  recommend?: string
  samples: number
}

function duration(seconds: number) {
  if (!seconds || seconds <= 0) return null
  const m = Math.floor(seconds / 60)
  const s = Math.round(seconds % 60)
  return m > 0 ? `${m} min ${s} s` : `${s} s`
}

const STATE_LABEL: Record<Exclude<Forecast['state'], ''>, string> = {
  insufficient_history: 'Not enough history yet',
  stable: 'Within budget',
  soft_limit: 'Projected to pass the budget',
  hard_limit: 'Budget used up',
}

export function PredictiveCost({ sessionId }: { sessionId?: string }) {
  const path = sessionId
    ? `/api/v1/vigil/sessions/${encodeURIComponent(sessionId)}/forecast`
    : '/api/v1/vigil/forecast'
  const res = useResource<Forecast>(path, { intervalMs: 4000 })

  return (
    <section className="app-card p-5" aria-labelledby="pc-title">
      <h2 id="pc-title" className="app-h3">Budget forecast</h2>
      <p className="app-sub mb-4">
        {sessionId ? 'This session' : 'The connected MCP session projected to spend the most'}: a straight line through its recent estimated costs, not a model.
      </p>
      <ResourceGate r={res} loading="Loading the forecast…" compact
        isEmpty={f => !f.state}
        empty={<StatePanel kind="empty" title="No session to forecast" compact>No MCP session is connected to this server, so there is no spend to project.</StatePanel>}>
        {f => <Body f={f} />}
      </ResourceGate>
    </section>
  )
}

function Body({ f }: { f: Forecast }) {
  // With fewer than two samples there is no interval to measure a rate over.
  // A projection from one point would be invented, so it is shown as unknown.
  const thin = f.state === 'insufficient_history'
  const breachIn = thin ? null : duration(f.time_to_breach_seconds)
  return (
    <>
      <p className="mb-3 text-[14px] font-semibold text-[#14100d] flex items-center gap-1.5">
        {f.will_breach && <AlertTriangle className="w-4 h-4 text-[#b42318]" aria-hidden="true" />}
        {f.will_breach ? 'Projected to pass its budget' : f.state ? STATE_LABEL[f.state] : '—'}
      </p>
      <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-6 gap-y-3">
        <Metric label="Spent so far" value={`$${f.current_cost.toFixed(4)}`} />
        <Metric label="Session budget" value={f.budget > 0 ? `$${f.budget.toFixed(2)}` : 'No limit set'} />
        <Metric label="Rate" value={thin ? null : `$${f.burn_rate_per_min.toFixed(4)} / min`} />
        <Metric label="Projected total" value={thin ? null : `$${f.projected_total.toFixed(4)}`} />
        <Metric label="Budget reached in" value={breachIn} note={!thin && !breachIn ? 'Not on current pace' : undefined} />
        <Metric label="Cost samples" value={String(f.samples)} />
      </dl>
      {thin && <p className="app-meta mt-3">Fewer than two cost samples, so no rate can be measured yet.</p>}
      {f.recommend && (
        <div className="app-banner app-banner-warn mt-4" role="status">
          <AlertTriangle className="w-4 h-4 shrink-0" aria-hidden="true" />
          <span>Recommended: {f.recommend}</span>
        </div>
      )}
    </>
  )
}

function Metric({ label, value, note }: { label: string; value: string | null; note?: string }) {
  return (
    <div>
      <dt className="app-label">{label}</dt>
      <dd className="app-mono text-[15px] font-semibold text-[#14100d] mt-0.5">{value ?? (note ? '' : '—')}{note && <span className="app-meta font-normal">{note}</span>}</dd>
    </div>
  )
}
