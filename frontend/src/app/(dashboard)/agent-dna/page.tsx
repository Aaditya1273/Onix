'use client'

import { useState } from 'react'
import Link from 'next/link'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel, InfoPopover } from '@/components/app/ui'

// GET /vigil/dna/profiles. Today the server builds each profile from the
// agent's live state. Only the fields that come from that state are shown:
// the response also carries fixed baselines (cost per run, latency, tokens),
// a p95 that is twice the last latency and a run count derived from tokens,
// which are placeholders rather than measurements.
interface DNAProfile {
  agent_id: string
  anomaly_score: number
  drift_detected: boolean
  avg_cost: number
  avg_latency: number
  tool_usage_distribution: Record<string, number> | null
  last_updated: string
}

const money = (v: number) => `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`
const score = (s: number) => Math.round(s * 100)
const level = (s: number) => (s > 0.7 ? 'High' : s > 0.4 ? 'Elevated' : 'Low')
const updated = (iso: string) => {
  const d = new Date(iso)
  return !iso || iso.startsWith('0001') || Number.isNaN(d.getTime()) ? '—' : d.toLocaleString()
}

export default function AgentDNAPage() {
  const res = useResource<DNAProfile[] | null>('/api/vigil/dna/profiles', { intervalMs: 15000 })
  // Selection is kept by id, so a refresh that returns new objects (or a new order) keeps it.
  const [selectedId, setSelectedId] = useState<string | null>(null)

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Agent DNA</h1>
      <p className="mb-8">A risk score per agent from its status and spend, as the server reports it. It is a simple rule today, not a learned baseline.</p>

      <ResourceGate r={res} loading="Loading agent profiles…"
        isEmpty={d => !d || d.length === 0}
        empty={
          <StatePanel kind="empty" title="No agents have connected yet">
            A profile appears for each agent once it connects to this server. <Link href="/connect" className="underline decoration-[#ff6b00] decoration-2 underline-offset-2 text-[#14100d]">How to connect an agent</Link>
          </StatePanel>
        }>
        {d => {
          const profiles = (d ?? []).slice().sort((a, b) => a.agent_id.localeCompare(b.agent_id)) // stable order: a poll never reshuffles the list
          const selected = profiles.find(p => p.agent_id === selectedId) ?? profiles[0]
          const lost = selectedId !== null && selected.agent_id !== selectedId
          return (
            <div className="grid gap-6 lg:grid-cols-12">
              <section className="lg:col-span-5" aria-labelledby="dna-list">
                <h2 id="dna-list" className="app-h2">Agents</h2>
                <p className="app-sub mb-3">{profiles.length} reported. Select one to see its profile.</p>
                <div className="app-table-wrap">
                  <table className="data-table">
                    <thead><tr><th scope="col">Agent</th><th scope="col">Flag</th><th scope="col" className="text-right">Score</th></tr></thead>
                    <tbody>
                      {profiles.map(p => {
                        const on = p.agent_id === selected.agent_id
                        return (
                          <tr key={p.agent_id} className="app-row-button" tabIndex={0} aria-selected={on}
                            onClick={() => setSelectedId(p.agent_id)}
                            onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setSelectedId(p.agent_id) } }}>
                            <td className="app-mono break-all">{p.agent_id}</td>
                            <td className="text-[13px] whitespace-nowrap">{p.drift_detected ? <span className="pill pill-red">Flagged</span> : '—'}</td>
                            <td className="app-mono text-right">{score(p.anomaly_score)}</td>
                          </tr>
                        )
                      })}
                    </tbody>
                  </table>
                </div>
              </section>

              <section className="lg:col-span-7" aria-labelledby="dna-detail">
                <h2 id="dna-detail" className="app-h2 break-all">{selected.agent_id}</h2>
                <p className="app-sub mb-3">Last updated {updated(selected.last_updated)}</p>
                {lost && (
                  <div className="app-banner app-banner-info mb-3" role="status">
                    The agent you selected is no longer reported by the server; showing the first one instead.
                  </div>
                )}
                <Detail p={selected} />
              </section>
            </div>
          )
        }}
      </ResourceGate>
    </div>
  )
}

function Detail({ p }: { p: DNAProfile }) {
  const s = score(p.anomaly_score)
  const tools = Object.keys(p.tool_usage_distribution ?? {})
  return (
    <div className="app-card p-5">
      <div className="flex flex-wrap items-start gap-4">
        <div>
          <span className="app-label inline-flex items-center gap-1.5">Score
            <InfoPopover label="How the score is worked out">
              The server sets 85 when the agent is blocked or stopped. Otherwise it is the agent&apos;s spend divided by $10
              once spend passes $1 (capped at 100), and 10 below that. &ldquo;Flagged&rdquo; means blocked or stopped.
            </InfoPopover>
          </span>
          <div className="app-num mt-1">{s}<span className="text-[15px] font-normal text-[#5e544b]"> / 100</span></div>
          <p className="text-[14px] font-semibold mt-1">{level(p.anomaly_score)}{p.drift_detected ? ' · Flagged: blocked or stopped' : ''}</p>
        </div>
        <div className="flex-1 min-w-[180px] self-center">
          <div className="h-2 rounded-full bg-[#efe8de]" role="meter" aria-valuemin={0} aria-valuemax={100} aria-valuenow={s} aria-label="Score">
            <div className="h-full rounded-full motion-safe:transition-[width]" style={{ width: `${s}%`, background: p.anomaly_score > 0.7 ? '#b42318' : p.anomaly_score > 0.4 ? '#ff6b00' : '#8f8478' }} />
          </div>
          <div className="flex justify-between app-meta mt-1"><span>0</span><span>100</span></div>
        </div>
      </div>

      <dl className="grid grid-cols-1 sm:grid-cols-3 gap-4 mt-6">
        <div><dt className="app-label">Spend so far (est.)</dt><dd className="app-mono text-[15px] font-semibold mt-0.5">{money(p.avg_cost ?? 0)}</dd></div>
        <div>
          <dt className="app-label">Last reported latency</dt>
          <dd className="app-mono text-[15px] font-semibold mt-0.5">{p.avg_latency ? `${p.avg_latency} ms` : '—'}</dd>
          {!p.avg_latency && <dd className="app-meta">Not reported by this agent</dd>}
        </div>
        <div><dt className="app-label">Last tool</dt><dd className="app-mono text-[15px] font-semibold mt-0.5 break-all">{tools[0] || '—'}</dd></div>
      </dl>

      <p className="app-meta mt-6">
        The server&apos;s profile also includes fixed baseline figures and a derived p95 and run count. They are placeholders, not
        measurements, so this page does not show them.
      </p>
    </div>
  )
}
