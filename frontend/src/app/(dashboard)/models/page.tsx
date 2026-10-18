'use client'

import { useResource } from '@/lib/useResource'
import { describe } from '@/lib/api'
import { ResourceGate, StatePanel, Kpi } from '@/components/app/ui'

interface ModelStat {
  model_id: string
  role: string
  requests: number
  failures: number
  fallbacks: number
  avg_latency_ms: number
  total_tokens: number
}
interface Vendor { vendor: string; priority: number; live: boolean; roles: string[] | null; retired: string }
interface Status { provider: string; configured: boolean; roles: string[] | null; models: ModelStat[] | null; vendors: Vendor[] | null }
interface Digest { days: number; digest: { decisions: number; model_free_fraction: number } }

const ROLE_LABEL: Record<string, string> = {
  FAST_RISK_CLASSIFIER: 'Fast triage',
  POLICY_REASONER: 'Reasoner',
  DEEP_SECURITY_REVIEWER: 'Security review',
}
const role = (r: string) => ROLE_LABEL[r] ?? r
const n = (x: number) => x.toLocaleString()

export default function ModelsPage() {
  const status = useResource<Status>('/api/v1/vigil/models', { intervalMs: 10000 })
  const digest = useResource<Digest>('/api/v1/vigil/digest?days=7', { intervalMs: 60000 })
  const d = digest.data

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Model router</h1>
      <p>VIGIL asks a model only when the deterministic and graph checks are uncertain. This is what the server reports.</p>

      <div className="mt-6">
        <ResourceGate r={status} loading="Loading model router status…">
          {s => {
            const rows = s.models ?? []
            const t = rows.reduce((a, m) => ({ requests: a.requests + m.requests, fallbacks: a.fallbacks + m.fallbacks, failures: a.failures + m.failures, tokens: a.tokens + m.total_tokens }),
              { requests: 0, fallbacks: 0, failures: 0, tokens: 0 })
            return (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
                  <Kpi value={s.configured ? 'Configured' : 'None'} label="Inference provider" note={s.provider} />
                  <Kpi value={d ? `${Math.round(d.digest.model_free_fraction * 100)}%` : null} label={`Decisions made without a model, last ${d?.days ?? 7} days`}
                    note={d ? `Of ${n(d.digest.decisions)} decisions in the graph.` : digest.status === 'loading' ? 'Loading…' : describe(digest.error)} />
                  <Kpi value={s.configured ? n(t.requests) : null} label="Model requests since the server started" note={s.configured ? undefined : 'No provider, so none are made.'} />
                  <Kpi value={s.configured ? n(t.fallbacks + t.failures) : null} label="Fallbacks and failures since start" tone={t.failures > 0 ? '#b42318' : undefined}
                    note={s.configured ? `${n(t.fallbacks)} fallbacks · ${n(t.failures)} failures` : undefined} />
                </div>

                {!s.configured && (
                  <div className="app-banner app-banner-info mt-6" role="status">
                    <span>
                      No inference model is configured, which is a supported setup: intent, cost forecast, the graph and behavioral detectors decide every call on their own.
                      To enable model review, set one vendor key on the server: <code className="app-mono">VIGIL_FEATHERLESS_API_KEY</code>, <code className="app-mono">VIGIL_NVIDIA_API_KEY</code> or <code className="app-mono">VIGIL_GEMINI_API_KEY</code>.
                    </span>
                  </div>
                )}

                {!!s.vendors?.length && (
                  <section className="mt-8" aria-labelledby="vend-h">
                    <h2 id="vend-h" className="app-h2">Vendor failover chain</h2>
                    <p className="app-sub mt-1 mb-4">Tried in priority order. A vendor that refuses its key or quota is retired until the server restarts.</p>
                    <div className="app-table-wrap">
                      <table className="data-table">
                        <thead><tr><th scope="col">Priority</th><th scope="col">Vendor</th><th scope="col">Roles</th><th scope="col">State</th></tr></thead>
                        <tbody>
                          {s.vendors.map(v => (
                            <tr key={v.vendor}>
                              <td className="app-mono">{v.priority}</td>
                              <td className="font-medium">{v.vendor}</td>
                              <td>{v.roles?.length ? v.roles.map(role).join(', ') : '—'}</td>
                              <td>{v.live ? 'In the chain' : <span className="text-[#b42318]">Retired: {v.retired || 'no reason given'}</span>}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                )}

                {s.configured && (
                  <section className="mt-8" aria-labelledby="route-h">
                    <h2 id="route-h" className="app-h2">Models used</h2>
                    <p className="app-sub mt-1 mb-4">
                      Configured roles: {s.roles?.length ? s.roles.map(role).join(', ') : 'none'}. Counts are kept in memory since the server started.
                    </p>
                    {rows.length === 0 ? (
                      <StatePanel kind="empty" title="No model calls yet">A model row appears here once a call escalates past the deterministic checks.</StatePanel>
                    ) : (
                      <div className="app-table-wrap">
                        <table className="data-table">
                          <thead><tr>
                            <th scope="col">Model</th><th scope="col">Role</th><th scope="col" className="text-right">Requests</th><th scope="col" className="text-right">Avg latency</th>
                            <th scope="col" className="text-right">Fallbacks</th><th scope="col" className="text-right">Failures</th><th scope="col" className="text-right">Tokens</th>
                          </tr></thead>
                          <tbody>
                            {rows.map(m => (
                              <tr key={`${m.model_id}-${m.role}`}>
                                <td className="app-mono break-all">{m.model_id}</td>
                                <td>{role(m.role)}</td>
                                <td className="text-right tabular-nums">{n(m.requests)}</td>
                                <td className="text-right tabular-nums">{m.requests ? `${n(m.avg_latency_ms)} ms` : '—'}</td>
                                <td className="text-right tabular-nums">{n(m.fallbacks)}</td>
                                <td className="text-right tabular-nums">{n(m.failures)}</td>
                                <td className="text-right tabular-nums">{n(m.total_tokens)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    )}
                  </section>
                )}
              </>
            )
          }}
        </ResourceGate>
      </div>
    </div>
  )
}
