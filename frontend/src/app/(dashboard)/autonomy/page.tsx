'use client'

import { CheckCircle2, Eye, ShieldCheck } from 'lucide-react'
import { useResource } from '@/lib/useResource'
import { Kpi, ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'
import { VERDICT, stageLabel } from '@/lib/verdict'

// Everything here is one reply from GET /api/v1/vigil/digest?days=7: the
// graph's decision log for the window, the call patterns that earned autonomy,
// and the decision chain's integrity. Nothing is shown when it fails.

interface Autonomy { agent: string; repo?: string; tool: string; capabilities: string; clean_since_last_incident: number }
interface Digest {
  decisions: number; by_verdict: Record<string, number>; by_stage: Record<string, number>
  model_free_fraction: number; graph_queried: number; graph_ms_p50: number; graph_ms_p95: number
  autonomy: Autonomy[]; chain_links: number; chain_broken: number
}
interface Reply { days: number; observe_mode: boolean; trust_threshold: number; digest: Digest }

function Body({ r }: { r: Reply }) {
  const d = r.digest
  const stopped = (d.by_verdict.BLOCK ?? 0) + (d.by_verdict.PAUSE ?? 0)
  const stages = Object.entries(d.by_stage).filter(([s]) => s !== 'default').sort((a, b) => b[1] - a[1])
  const maxStage = Math.max(1, ...stages.map(s => s[1]))
  const win = `last ${r.days} days`

  return (
    <>
      {r.observe_mode ? (
        <div className="app-banner app-banner-warn" role="status">
          <Eye className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span><b>Observe mode.</b> VIGIL records what it would have decided but does not enforce it: every call runs, and earned autonomy changes nothing yet. The counts below are what enforcement would have done.</span>
        </div>
      ) : (
        <div className="app-banner app-banner-info" role="status">
          <ShieldCheck className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
          <span>Enforcing. A call pattern (agent, repo, tool and capabilities) that reaches <b>{r.trust_threshold} clean runs</b> since its last incident runs without an approval prompt. Any refusal, or a change to the tool, resets its count.</span>
        </div>
      )}

      {d.chain_broken > 0 && (
        <div className="app-banner app-banner-error mt-3" role="alert">
          <VerdictBadge v="critical" solid />
          <span><b>{d.chain_broken} broken link{d.chain_broken === 1 ? '' : 's'} in the decision chain.</b> A decision was dropped or changed after it was recorded, so the clean-run counts on this page may not be trustworthy. Export the ledger from the Risk page and check it with <span className="font-mono">vigil-cli verify-ledger</span>.</span>
        </div>
      )}

      <section aria-labelledby="earned-h" className="mt-6">
        <h2 id="earned-h" className="app-h2">Autonomy earned</h2>
        <p className="app-sub mt-1 mb-3">Call patterns with at least {r.trust_threshold} clean runs since their last incident, {win}.</p>
        {d.autonomy.length === 0 ? (
          <StatePanel kind="empty" title="Nothing earned yet">
            No call pattern has reached {r.trust_threshold} clean runs since its last incident in the {win}. Every clean, executed call counts toward it; any refusal or tool change resets it.
          </StatePanel>
        ) : (
          <div className="app-table-wrap">
            <table className="data-table">
              <caption className="sr-only">Call patterns that earned autonomy</caption>
              <thead><tr><th scope="col">Tool</th><th scope="col" className="text-right">Clean runs since last incident</th><th scope="col">Agent</th><th scope="col">Capabilities</th><th scope="col">Repo</th></tr></thead>
              <tbody>
                {d.autonomy.map(a => (
                  <tr key={`${a.agent}|${a.repo}|${a.tool}|${a.capabilities}`}>
                    <td className="app-mono whitespace-nowrap">{a.tool}</td>
                    <td className="text-right tabular-nums font-semibold whitespace-nowrap">{a.clean_since_last_incident.toLocaleString()} <span className="app-meta font-normal">/ {r.trust_threshold} needed</span></td>
                    <td className="app-mono whitespace-nowrap">{a.agent}</td>
                    <td>{a.capabilities ? <span className="flex flex-wrap gap-1">{a.capabilities.split(',').map(c => <span key={c} className="pill pill-gray">{c}</span>)}</span> : <span className="text-[#6b6158]">none</span>}</td>
                    <td className="app-mono whitespace-nowrap text-[#5e544b]">{a.repo || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <div className="mt-6 grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Kpi value={stopped.toLocaleString()} label={r.observe_mode ? 'Would have stopped' : 'Stopped'} note={`blocked or paused · ${win}`} tone={stopped ? VERDICT.blocked.ink : undefined} />
        <Kpi value={d.decisions.toLocaleString()} label="Decisions" note={win} />
        <Kpi value={d.decisions ? `${Math.round(d.model_free_fraction * 100)}%` : null} label="Decided without a model" note={d.decisions ? win : 'no decisions in the window'} />
        <Kpi value={d.graph_queried ? `${d.graph_ms_p50.toFixed(2)} ms` : null} label="Graph time, median" note={d.graph_queried ? `p95 ${d.graph_ms_p95.toFixed(2)} ms` : 'no graph queries in the window'} />
      </div>

      <div className="mt-6 grid grid-cols-1 lg:grid-cols-2 gap-4">
        <section className="app-card p-5" aria-labelledby="why-h">
          <h2 id="why-h" className="app-h2">Why calls were stopped or rewritten</h2>
          <p className="app-sub mt-1 mb-4">By the graph signal that decided them, {win}.</p>
          {stages.length === 0 ? (
            <p className="app-sub">Nothing was stopped or rewritten in this window.</p>
          ) : (
            <ul className="space-y-3">
              {stages.map(([stage, n]) => (
                <li key={stage} className="text-[13px]">
                  <div className="flex justify-between gap-3"><span>{stageLabel(stage)}</span><span className="font-semibold tabular-nums">{n.toLocaleString()}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-[#f5f1ea]" aria-hidden="true"><div className="h-full rounded-full bg-[#5e544b]" style={{ width: `${(n / maxStage) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="app-card p-5" aria-labelledby="chain-h">
          <h2 id="chain-h" className="app-h2">Decision chain</h2>
          <p className="app-sub mt-1">Every decision is a node whose PREV edge must reach exactly the hash it names. The audit ledger on disk is the source of truth this mirrors.</p>
          <div className="mt-4 flex flex-wrap items-center gap-3">
            {d.chain_broken > 0
              ? <VerdictBadge v="critical" />
              : <span className="inline-flex items-center gap-1.5 text-[14px] font-semibold"><CheckCircle2 className="w-4 h-4 text-[#15803d]" aria-hidden="true" />Intact</span>}
            <span className="text-[14px] tabular-nums">{d.chain_links.toLocaleString()} linked, {d.chain_broken.toLocaleString()} broken</span>
          </div>
          {d.chain_broken > 0 && <p className="mt-2 text-[13px] text-[#7a1a12]">A broken link means a decision was dropped or rewritten after the fact.</p>}
        </section>
      </div>
    </>
  )
}

export default function AutonomyPage() {
  const r = useResource<Reply>('/api/v1/vigil/digest?days=7', { intervalMs: 30000 })
  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Earned autonomy</h1>
      <p>Which calls agents have run cleanly often enough to skip the approval prompt, from the graph&apos;s last 7 days.</p>
      <div className="mt-6">
        <ResourceGate r={r} loading="Reading the last 7 days from the graph…">{d => <Body r={d} />}</ResourceGate>
      </div>
    </div>
  )
}
