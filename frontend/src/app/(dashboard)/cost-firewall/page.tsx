'use client'

import { useMemo } from 'react'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel, Kpi, InfoPopover } from '@/components/app/ui'
import { CostChart } from '@/components/Charts/CostChart'
import { PredictiveCost } from '@/components/PredictiveCost'
import { CostPolicies } from './CostPolicies'

// Fields of GET /vigil/stats this page reads. The server sends total_cost,
// current_burn_rate and daily_total, but all three are the same number (the
// cumulative estimated spend since the server started), so only total_cost is
// used and labelled for what it is. Its "status" field is a constant and is not shown.
interface Stats {
  total_cost: number
  budget: number
  chart_data: number[]
  chart_labels: string[]
}
interface Digest { observe_mode?: boolean }

const money = (v: number) => `$${Math.abs(v) < 1 ? v.toFixed(4) : v.toFixed(2)}`

export default function CostFirewallPage() {
  const stats = useResource<Stats>('/api/vigil/stats', { intervalMs: 5000 })
  const digest = useResource<Digest>('/api/v1/vigil/digest?days=1', { intervalMs: 60000 })
  const observe = digest.data?.observe_mode === true

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Cost Firewall</h1>
      <p className="mb-8">What agents on this server have spent, against its budget, and the cost rules stored on it.</p>

      {observe && (
        <div className="app-banner app-banner-warn mb-6" role="status">
          Observe mode is on: VIGIL records its decisions, including budget blocks, but does not stop any call.
        </div>
      )}

      <ResourceGate r={stats} loading="Loading spend…">
        {s => <Spend s={s} />}
      </ResourceGate>

      <div className="grid gap-6 lg:grid-cols-2 mt-10">
        <section className="app-card p-5" aria-labelledby="enf-title">
          <h2 id="enf-title" className="app-h3">What stops a call on cost</h2>
          <ul className="mt-3 space-y-3 text-[14px] leading-[21px] text-[#14100d] list-disc pl-5">
            <li>
              Every session has its own budget. An MCP session gets the amount approved when it connected; a Claude Code hook
              session gets the server-wide budget above. When a session&apos;s spend reaches its budget, VIGIL blocks its next
              call, logged as &ldquo;The budget would be exceeded&rdquo;.
            </li>
            <li>The all-agent total on this page is not itself checked against any limit.</li>
            <li>Cost policies below are stored, but this server does not yet check calls against them.</li>
          </ul>
        </section>
        <PredictiveCost />
      </div>

      <CostPolicies />
    </div>
  )
}

function Spend({ s }: { s: Stats }) {
  const data = useMemo(() => s.chart_data ?? [], [s.chart_data])
  const labels = useMemo(() => s.chart_labels ?? [], [s.chart_labels])
  const n = data.length
  const recent = n >= 2 ? data[n - 1] - data[n - 2] : null
  const budget = s.budget > 0 ? s.budget : null
  const used = budget ? (s.total_cost / budget) * 100 : null

  return (
    <>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi value={money(s.total_cost)} label="Spend since the server started"
          note={<span className="inline-flex items-center gap-1.5">Estimated, all agents
            <InfoPopover label="How spend is estimated">
              Each tool call is charged a fixed estimate for that tool (for example $0.001 for read_file). It is not a bill from a model provider.
              The total resets when the server restarts.
            </InfoPopover></span>} />
        <Kpi value={budget ? money(budget) : 'No limit'} label="Server-wide budget"
          note={budget ? 'VIGIL_BUDGET_LIMIT, default $100. Also each hook session’s budget' : 'No budget limit set'} />
        <Kpi value={used === null ? null : `${used < 1 ? used.toFixed(2) : used.toFixed(1)}%`} label="Share of the budget used"
          note={used === null ? 'No budget limit set' : `${money(s.total_cost)} of ${money(budget!)}`} />
        <Kpi value={recent === null ? null : money(recent)} label="Spend in the last 5 min"
          note={recent === null ? 'Not enough samples yet' : `Live total minus the ${labels[n - 2] ?? 'previous'} sample`} />
      </div>

      <section className="app-card p-5 mt-6" aria-labelledby="traj-title">
        <h2 id="traj-title" className="app-h3">Cumulative spend, last two hours</h2>
        <p className="app-sub mb-4">
          Running total sampled every 5 minutes by the server; the last point is the live total. Slots from before the server started read $0.
        </p>
        {n === 0 ? (
          <StatePanel kind="empty" title="No samples yet" compact>The server has not reported any spend samples.</StatePanel>
        ) : (
          <>
            <CostChart data={data} labels={labels} yTitle="Cumulative spend (USD)" xTitle="Server time"
              ariaLabel={`Cumulative estimated spend from ${labels[0]} to ${labels[n - 1]}: ${money(data[0])} rising to ${money(data[n - 1])}. A table follows.`} />
            <details className="mt-3">
              <summary className="app-meta cursor-pointer">Show the samples as a table</summary>
              <div className="app-table-wrap mt-2 max-h-72 overflow-y-auto">
                <table className="data-table">
                  <thead><tr><th scope="col">Server time</th><th scope="col" className="text-right">Cumulative spend</th><th scope="col" className="text-right">Change</th></tr></thead>
                  <tbody>
                    {data.map((v, i) => (
                      <tr key={i}>
                        <td className="app-mono">{labels[i] ?? '—'}{i === n - 1 ? ' (live)' : ''}</td>
                        <td className="app-mono text-right">{money(v)}</td>
                        <td className="app-mono text-right">{i === 0 ? '—' : money(v - data[i - 1])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </section>
    </>
  )
}
