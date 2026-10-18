'use client'

import { useRef, useState } from 'react'
import Link from 'next/link'
import { Pause, Play, X, Wifi, WifiOff, RefreshCw } from 'lucide-react'
import { useVigilSocket, type SocketState } from '@/lib/useVigilSocket'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel, Kpi, InfoPopover } from '@/components/app/ui'
import { DecisionStream, when } from '@/components/DecisionStream'
import { PredictiveCost } from '@/components/PredictiveCost'

interface Agent {
  agent_id: string
  status: 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'DEAD'
  current_cost: number
  current_tokens: number
  latency_ms: number
  last_tool: string
  updated_at?: string
}
interface Stats { total_agents: number; healthy: number; blocked: number; active_incidents: number; total_cost: number }
type Act = 'kill' | 'pause' | 'resume'
interface ToolCall { tool: string; agent: string; cost: number; total: number; at: number }

const STATUS: Record<Agent['status'], { label: string; pill: string }> = {
  RUNNING: { label: 'Running', pill: 'pill-green' },
  PAUSED: { label: 'Paused', pill: 'pill-orange' },
  BLOCKED: { label: 'Blocked', pill: 'pill-red' },
  DEAD: { label: 'Stopped', pill: 'pill-gray' },
}

const DONE: Record<Act, string> = {
  kill: 'Kill accepted: the server marked this agent Stopped and sent it a kill command.',
  pause: 'Pause accepted: the server marked this agent Paused and sent it a pause command.',
  resume: 'Resume accepted: the server marked this agent Running and sent it a resume command.',
}

// Honest wording for each way POST /api/vigil/agents/{id}/{action} can fail.
function actionError(status: number, body: { error?: string; kind?: string } | null) {
  if (status === 401 && body?.kind === 'unauthorized') return 'Not done: sign in with an operator account to control agents.'
  if (status === 401) return 'Not done: the control plane refused the request. This dashboard has no valid operator token configured, so it cannot send control actions.'
  if (status === 403) return 'Not done: your account is not an operator on this dashboard.'
  if (status === 502 && body?.kind === 'sleeping') return 'Not done: the control plane is waking up or restarting. Try again in a minute.'
  if (status === 502) return 'Not done: the control plane could not be reached.'
  if (status === 404) return 'Not done: this server does not offer that action.'
  return `Not done: the control plane returned an error (${status}${body?.error ? `: ${body.error}` : ''}).`
}

const money = (v: number) => `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`

export default function MissionControlPage() {
  const agents = useResource<Agent[] | null>('/api/vigil/agents', { intervalMs: 5000 })
  const stats = useResource<Stats>('/api/vigil/stats', { intervalMs: 5000 })
  const [lastCall, setLastCall] = useState<ToolCall | null>(null)
  const lastPush = useRef(0)

  // The socket only says that something changed; the lists are re-read from
  // the API so the page never mixes two versions of the truth. At most once a second.
  const socket = useVigilSocket(m => {
    if (m.type === 'MCP_TOOL_CALL') {
      setLastCall({ tool: String(m.tool ?? ''), agent: String(m.agent_id ?? ''), cost: Number(m.cost) || 0, total: Number(m.total) || 0, at: Date.now() })
    }
    if (m.type === 'AGENTS_UPDATE' || m.type === 'MCP_TOOL_CALL') {
      const now = Date.now()
      if (now - lastPush.current > 1000) { lastPush.current = now; agents.retry(); stats.retry() }
    }
  })

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Mission Control</h1>
      <p className="mb-4">The agents connected to this server, what they are doing, and controls to pause or stop them.</p>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 mb-6">
        <SocketBadge s={socket} />
        {lastCall && (
          <span className="app-meta" aria-live="polite">
            Last tool call <span className="app-mono text-[#14100d]">{lastCall.tool}</span> at {when(lastCall.at)}, est. {money(lastCall.cost)}
            {' '}(session total {money(lastCall.total)})
          </span>
        )}
      </div>

      <ResourceGate r={stats} loading="Loading totals…" compact>
        {s => (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 gap-3">
            <Kpi value={s.total_agents} label="Agents known" />
            <Kpi value={s.healthy} label="Running" />
            <Kpi value={s.blocked} label="Blocked" tone={s.blocked > 0 ? '#f26500' : undefined} />
            <Kpi value={s.active_incidents} label="Blocked or stopped" tone={s.active_incidents > 0 ? '#f26500' : undefined} />
            <Kpi value={money(s.total_cost)} label="Spend since server start" note="Estimated, all agents" />
          </div>
        )}
      </ResourceGate>

      <section className="mt-10" aria-labelledby="ag-title">
        <h2 id="ag-title" className="app-h2">Agents</h2>
        <p className="app-sub mb-3">
          Spend is VIGIL&apos;s per-call estimate. Tokens and latency show — when the agent does not report them (MCP sessions do not).
        </p>
        <ResourceGate r={agents} loading="Loading agents…"
          isEmpty={d => !d || d.length === 0}
          empty={
            <StatePanel kind="empty" title="No agents have connected yet">
              Agents appear here once they connect over MCP or the Claude Code hook. <Link href="/connect" className="underline decoration-[#ff6b00] decoration-2 underline-offset-2 text-[#14100d]">How to connect an agent</Link>
            </StatePanel>
          }>
          {d => <AgentTable agents={d ?? []} onChanged={agents.retry} />}
        </ResourceGate>
      </section>

      <DecisionStream />

      <div className="mt-10">
        <PredictiveCost />
      </div>
    </div>
  )
}

function SocketBadge({ s }: { s: SocketState }) {
  const text = s.state === 'connected' ? 'Event stream connected'
    : s.state === 'connecting' ? 'Connecting to the event stream…'
    : `Event stream disconnected, retrying in ${Math.round(s.retryInMs / 1000)} s`
  const Icon = s.state === 'connected' ? Wifi : s.state === 'connecting' ? RefreshCw : WifiOff
  return (
    <span className="inline-flex items-center gap-2">
      <span role="status" className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[13px] font-medium ${
        s.state === 'connected' ? 'border-[#8f8478] bg-white text-[#14100d]' : s.state === 'connecting' ? 'border-[#e6ded2] bg-[#faf7f2] text-[#5e544b]' : 'border-[#ff6b00] bg-white text-[#a8380a]'}`}>
        <Icon className={`w-3.5 h-3.5 ${s.state === 'connecting' ? 'motion-safe:animate-spin' : ''}`} aria-hidden="true" />{text}
      </span>
      <InfoPopover label="About the event stream">
        Agent changes and tool calls arrive over a WebSocket while it is connected. Whether or not it is, the agent list and totals are
        re-read from the server every 5 seconds.
      </InfoPopover>
    </span>
  )
}

function AgentTable({ agents, onChanged }: { agents: Agent[]; onChanged: () => void }) {
  const [pending, setPending] = useState<Record<string, Act>>({})
  const [notes, setNotes] = useState<Record<string, { ok: boolean; text: string }>>({})
  const [confirming, setConfirming] = useState<string | null>(null)

  const run = async (id: string, act: Act) => {
    setConfirming(null)
    setPending(p => ({ ...p, [id]: act }))
    setNotes(n => { const c = { ...n }; delete c[id]; return c })
    let note: { ok: boolean; text: string }
    try {
      const r = await fetch(`/api/vigil/agents/${encodeURIComponent(id)}/${act}`, { method: 'POST', cache: 'no-store', signal: AbortSignal.timeout(20000) })
      const body = await r.json().catch(() => null)
      note = r.ok ? { ok: true, text: DONE[act] } : { ok: false, text: actionError(r.status, body) }
    } catch {
      note = { ok: false, text: 'No answer from the control plane (network error or timeout). The agent may not have changed: check its status here.' }
    }
    setPending(p => { const c = { ...p }; delete c[id]; return c })
    setNotes(n => ({ ...n, [id]: note }))
    onChanged()
  }

  return (
    <div className="app-table-wrap">
      <table className="data-table">
        <thead>
          <tr>
            <th scope="col">Agent</th><th scope="col">Status</th><th scope="col" className="text-right">Spend (est.)</th>
            <th scope="col" className="text-right">Tokens</th><th scope="col" className="text-right">Latency</th>
            <th scope="col">Last tool</th><th scope="col">Updated</th><th scope="col" className="text-right">Actions</th>
          </tr>
        </thead>
        <tbody>
          {agents.map(a => {
            const s = STATUS[a.status] ?? { label: a.status || 'Unknown', pill: 'pill-gray' }
            const busy = pending[a.agent_id]
            const note = notes[a.agent_id]
            return [
              <tr key={a.agent_id}>
                <td className="app-mono break-all min-w-[160px]">{a.agent_id}</td>
                <td><span className={`pill ${s.pill}`}>{s.label}</span></td>
                <td className="app-mono text-right">{money(a.current_cost ?? 0)}</td>
                <td className="app-mono text-right">{a.current_tokens ? a.current_tokens.toLocaleString() : '—'}</td>
                <td className="app-mono text-right">{a.latency_ms ? `${a.latency_ms} ms` : '—'}</td>
                <td className="app-mono">{a.last_tool || '—'}</td>
                <td className="app-mono whitespace-nowrap">{a.updated_at && !a.updated_at.startsWith('0001') ? when(a.updated_at) : '—'}</td>
                <td className="text-right">
                  <div className="flex items-center justify-end gap-1.5">
                    {a.status === 'RUNNING' && (
                      <button type="button" className="app-btn app-btn-secondary app-btn-sm" disabled={!!busy} onClick={() => run(a.agent_id, 'pause')}
                        aria-label={`Pause agent ${a.agent_id}`}>
                        <Pause className="w-3.5 h-3.5" aria-hidden="true" />{busy === 'pause' ? 'Pausing…' : 'Pause'}
                      </button>
                    )}
                    {a.status === 'PAUSED' && (
                      <button type="button" className="app-btn app-btn-secondary app-btn-sm" disabled={!!busy} onClick={() => run(a.agent_id, 'resume')}
                        aria-label={`Resume agent ${a.agent_id}`}>
                        <Play className="w-3.5 h-3.5" aria-hidden="true" />{busy === 'resume' ? 'Resuming…' : 'Resume'}
                      </button>
                    )}
                    {a.status !== 'DEAD' && (
                      <button type="button" className="app-btn app-btn-danger app-btn-sm" disabled={!!busy || confirming === a.agent_id}
                        onClick={() => setConfirming(a.agent_id)} aria-label={`Kill agent ${a.agent_id}`} aria-expanded={confirming === a.agent_id}>
                        <X className="w-3.5 h-3.5" aria-hidden="true" />{busy === 'kill' ? 'Killing…' : 'Kill'}
                      </button>
                    )}
                    {a.status === 'DEAD' && <span className="app-meta">No actions</span>}
                  </div>
                </td>
              </tr>,
              confirming === a.agent_id && (
                <tr key={`${a.agent_id}-confirm`}>
                  <td colSpan={8}>
                    <div className="app-banner app-banner-warn flex-wrap sticky left-0 max-w-[calc(100vw-4rem)] lg:max-w-none" role="group" aria-label={`Confirm killing agent ${a.agent_id}`}
                      onKeyDown={e => { if (e.key === 'Escape') setConfirming(null) }}>
                      <span>Kill <span className="app-mono">{a.agent_id}</span>? The server marks it Stopped and sends it a kill command. This page cannot resume a stopped agent.</span>
                      <span className="flex gap-2 ml-auto">
                        <button type="button" className="app-btn app-btn-danger app-btn-sm" onClick={() => run(a.agent_id, 'kill')}>Kill agent</button>
                        <button type="button" className="app-btn app-btn-secondary app-btn-sm" autoFocus onClick={() => setConfirming(null)}>Cancel</button>
                      </span>
                    </div>
                  </td>
                </tr>
              ),
              note && (
                <tr key={`${a.agent_id}-note`}>
                  <td colSpan={8}>
                    <div className={`app-banner ${note.ok ? 'app-banner-info' : 'app-banner-error'} sticky left-0 max-w-[calc(100vw-4rem)] lg:max-w-none`} role={note.ok ? 'status' : 'alert'}>
                      <span>{note.text}</span>
                      <button type="button" className="app-btn app-btn-ghost app-btn-sm ml-auto"
                        onClick={() => setNotes(n => { const c = { ...n }; delete c[a.agent_id]; return c })}>Dismiss</button>
                    </div>
                  </td>
                </tr>
              ),
            ]
          })}
        </tbody>
      </table>
    </div>
  )
}
