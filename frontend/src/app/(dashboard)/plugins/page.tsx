'use client'

import { usePageTab } from '@/lib/usePageTab'
import { useId, useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { useResource } from '@/lib/useResource'
import { useVigilSocket, type VigilEvent } from '@/lib/useVigilSocket'
import { ApiError, describe, fetchJSON } from '@/lib/api'
import { CopyButton, ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'

// One endpoint and one command, everywhere they are shown.
const MCP_URL = 'https://vigil-server.onrender.com/api/v1/mcp'
const CLAUDE_CODE_CMD = `claude mcp add --transport sse vigil ${MCP_URL}`
const CLAUDE_WEB_LINK = `https://claude.ai/customize/connectors?modal=add-custom-connector&connectorName=vigil&connectorUrl=${encodeURIComponent(MCP_URL)}`

const json = (o: object) => JSON.stringify(o, null, 2)
// Formats are taken from each client's own documentation (linked). Clients
// marked untested have not been tried against this server yet.
const CLIENTS: { name: string; how: string; code?: string; docs?: string; untested?: boolean }[] = [
  { name: 'Cursor', how: 'Add this to .cursor/mcp.json, then reload the client.', code: json({ mcpServers: { vigil: { url: MCP_URL } } }) },
  { name: 'VS Code', how: 'Add this to .vscode/mcp.json, then reload the client.', code: json({ servers: { vigil: { type: 'sse', url: MCP_URL } } }) },
  { name: 'Claude Desktop', untested: true, docs: 'https://support.claude.com/en/articles/11175166-getting-started-with-custom-connectors-using-remote-mcp',
    how: 'Settings → Connectors → Add custom connector. Name it vigil, paste the endpoint above, then approve the sign-in when VIGIL opens in your browser. Needs a Claude plan with custom connectors.' },
  { name: 'Codex CLI', untested: true, docs: 'https://developers.openai.com/codex/mcp',
    how: 'Run this in a terminal, then codex mcp login vigil to sign in. Codex connects over streamable HTTP, not SSE.', code: `codex mcp add vigil --url ${MCP_URL}` },
  { name: 'Windsurf', untested: true, docs: 'https://docs.windsurf.com/windsurf/cascade/mcp',
    how: 'Add this to ~/.codeium/windsurf/mcp_config.json, then restart Windsurf.', code: json({ mcpServers: { vigil: { serverUrl: MCP_URL } } }) },
  { name: 'Kiro', untested: true, docs: 'https://kiro.dev/docs/mcp/configuration/',
    how: 'Add this to ~/.kiro/settings/mcp.json (all workspaces) or .kiro/settings/mcp.json (this workspace).', code: json({ mcpServers: { vigil: { url: MCP_URL } } }) },
  { name: 'Zed', untested: true, docs: 'https://zed.dev/docs/ai/mcp',
    how: 'Command palette → "zed: open settings file", and add this. With no Authorization header, Zed signs you in through the MCP OAuth flow.', code: json({ context_servers: { vigil: { url: MCP_URL } } }) },
  { name: 'Antigravity', untested: true, docs: 'https://codelabs.developers.google.com/google-workspace-mcp-antigravity',
    how: 'In the agent panel: … → MCP Servers → Manage MCP Servers → View raw config, and add this.', code: json({ mcpServers: { vigil: { serverUrl: MCP_URL } } }) },
  { name: 'Any other MCP client', how: "Add this to the client's MCP config, then reload the client.", code: json({ mcpServers: { vigil: { url: MCP_URL } } }) },
]

interface Session {
  id: string; client_name?: string; client_version?: string; connected_at?: string
  total_cost: number; tool_calls: number; budget_limit: number; blocked: boolean
}
interface ToolCall { key: number; tool: string; agent_id: string; cost: number; total: number; at: string }

const usd = (x: number | undefined) => (typeof x === 'number' && Number.isFinite(x) ? `$${x.toFixed(4)}` : '—')

function CodeLine({ code, label }: { code: string; label: string }) {
  return (
    <div className="flex flex-col sm:flex-row sm:items-start gap-2 mt-2">
      <pre className="app-mono flex-1 min-w-0 whitespace-pre-wrap break-all select-all bg-[#faf7f2] border border-[#e6ded2] rounded-lg px-3 py-2 m-0">{code}</pre>
      <CopyButton text={code} label={label} className="self-start" />
    </div>
  )
}

export default function PluginsPage() {
  const tab = usePageTab('/plugins')
  const sessions = useResource<{ sessions: Session[] | null }>('/api/vigil/mcp/sessions', { intervalMs: 5000 })
  const [calls, setCalls] = useState<ToolCall[]>([])
  const [seq, setSeq] = useState(0)

  const live = useVigilSocket((m: VigilEvent) => {
    if (m.type === 'MCP_TOOL_CALL') {
      setSeq(s => s + 1)
      setCalls(p => [{
        key: Date.now() + Math.random(), tool: String(m.tool ?? ''), agent_id: String(m.agent_id ?? ''),
        cost: Number(m.cost), total: Number(m.total), at: String(m.timestamp ?? ''),
      }, ...p].slice(0, 50))
    }
    if (m.type === 'MCP_EVENT') sessions.retry() // a connect, block or approve changed the session list
  })

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Plugins</h1>
      <p>Connect an MCP client to VIGIL. Every tool call it makes then goes through the firewall and is metered against its session budget.</p>

      <section className="mt-6" aria-labelledby="conn-h" hidden={tab !== 'connect'}>
        <h2 id="conn-h" className="app-h2">Connect a client</h2>
        <p className="app-sub mt-1 mb-4">The hosted VIGIL server speaks MCP at one endpoint, over SSE or plain HTTP requests.</p>

        <div className="app-card p-4 sm:p-5 space-y-5">
          <div>
            <h3 className="app-h3">MCP endpoint</h3>
            <CodeLine code={MCP_URL} label="Copy the MCP endpoint" />
          </div>
          <div>
            <h3 className="app-h3">Claude Code</h3>
            <p className="app-meta mt-0.5">Run once in a terminal. <code className="app-mono">claude mcp list</code> then shows <code className="app-mono">vigil</code>.</p>
            <CodeLine code={CLAUDE_CODE_CMD} label="Copy the Claude Code command" />
          </div>
          <div>
            <h3 className="app-h3">claude.ai</h3>
            <p className="app-meta mt-0.5 max-w-[75ch]">
              Add a custom connector with the endpoint above. claude.ai then sends you to VIGIL to approve the connection and set its budget.
            </p>
            <a href={CLAUDE_WEB_LINK} target="_blank" rel="noopener noreferrer" className="app-btn app-btn-secondary mt-2">
              Open claude.ai connectors<ExternalLink className="w-4 h-4" aria-hidden="true" /><span className="sr-only">(opens in a new tab)</span>
            </a>
          </div>
          <div className="space-y-2">
            <h3 className="app-h3">Other clients</h3>
            {CLIENTS.map(c => (
              <details key={c.name} className="border border-[#e6ded2] rounded-lg px-3 py-2">
                <summary className="cursor-pointer font-medium text-sm">
                  {c.name}{c.untested && <span className="pill pill-gray ml-2 align-middle">not yet tested with VIGIL</span>}
                </summary>
                <p className="app-meta mt-2 max-w-[75ch]">
                  {c.how}
                  {c.docs && <> <a href={c.docs} target="_blank" rel="noopener noreferrer" className="underline text-[#5e544b] hover:text-[#14100d]">{c.name} docs<span className="sr-only"> (opens in a new tab)</span></a></>}
                </p>
                {c.code && <CodeLine code={c.code} label={`Copy the ${c.name} ${c.code.startsWith('{') ? 'config' : 'command'}`} />}
              </details>
            ))}
          </div>
        </div>
      </section>

      <section className="mt-6" aria-labelledby="sess-h" hidden={tab !== 'sessions'}>
        <h2 id="sess-h" className="app-h2">MCP sessions</h2>
        <p className="app-sub mt-1 mb-4">Clients connected to this server, refreshed every 5 seconds. Session controls need an operator account.</p>
        <ResourceGate r={sessions} loading="Loading MCP sessions…" isEmpty={d => !d.sessions?.length}
          empty={<StatePanel kind="empty" title="No MCP sessions">No client is connected to this server right now. Connect one above.</StatePanel>}>
          {d => (
            <div className="app-table-wrap">
              <table className="data-table">
                <thead><tr>
                  <th scope="col">Client</th><th scope="col">Session</th><th scope="col" className="text-right">Calls</th>
                  <th scope="col" className="text-right">Spend</th><th scope="col" className="text-right">Budget</th><th scope="col">State</th><th scope="col">Controls</th>
                </tr></thead>
                <tbody>{d.sessions!.map(s => <SessionRow key={s.id} s={s} onDone={sessions.retry} />)}</tbody>
              </table>
            </div>
          )}
        </ResourceGate>
      </section>

      <section className="mt-6" aria-labelledby="calls-h" hidden={tab !== 'calls'}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 id="calls-h" className="app-h2">Tool calls</h2>
          <span className="inline-flex items-center gap-2 app-meta" role="status">
            <span aria-hidden="true" className={`w-2 h-2 rounded-full ${live ? 'bg-[#15803d]' : 'bg-[#8f8478]'}`} />
            {live ? 'Event stream connected' : 'Event stream not connected, retrying'}
          </span>
        </div>
        <p className="app-sub mt-1 mb-4">MCP tool calls as the server reports them, since this page was opened{seq > calls.length ? ` (latest ${calls.length} of ${seq})` : ''}.</p>
        {calls.length === 0 ? (
          <StatePanel kind="empty" title="No tool calls since this page opened">
            {live ? 'Calls appear here as a connected client makes them.' : 'The page is not connected to the event stream, so calls cannot appear until it reconnects.'}
          </StatePanel>
        ) : (
          <div className="app-table-wrap">
            <table className="data-table">
              <thead><tr><th scope="col">Time</th><th scope="col">Tool</th><th scope="col">Session</th><th scope="col" className="text-right">Cost</th><th scope="col" className="text-right">Session total</th></tr></thead>
              <tbody>
                {calls.map(c => (
                  <tr key={c.key}>
                    <td className="app-mono whitespace-nowrap">{c.at ? new Date(c.at).toLocaleTimeString() : '—'}</td>
                    <td className="app-mono">{c.tool || '—'}</td>
                    <td className="app-mono break-all">{c.agent_id || '—'}</td>
                    <td className="text-right tabular-nums app-mono">{usd(c.cost)}</td>
                    <td className="text-right tabular-nums app-mono">{usd(c.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  )
}

function SessionRow({ s, onDone }: { s: Session; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [confirmBlock, setConfirmBlock] = useState(false)
  const [editBudget, setEditBudget] = useState(false)
  const [budget, setBudget] = useState('')
  const [budgetErr, setBudgetErr] = useState<string | null>(null)
  const id = useId()

  const act = async (action: 'approve' | 'block' | 'budget', body: object = {}) => {
    setBusy(action); setErr(null)
    try {
      await fetchJSON(`/api/vigil/mcp/sessions/${encodeURIComponent(s.id)}/${action}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      setConfirmBlock(false); setEditBudget(false); onDone()
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'not_found' ? 'This session is no longer on the server: it disconnected or the server restarted.' : describe(e))
    } finally { setBusy(null) }
  }

  const saveBudget = (e: React.FormEvent) => {
    e.preventDefault()
    const v = Number(budget)
    if (budget.trim() === '' || !Number.isFinite(v) || v <= 0) { setBudgetErr('Enter an amount above $0.'); return }
    if (v > 100000) { setBudgetErr('Enter $100,000 or less.'); return }
    setBudgetErr(null); act('budget', { budget: v })
  }

  return (
    <tr>
      <td className="font-medium">
        {s.client_name || 'Unnamed client'}
        {s.client_version && <span className="block app-meta font-normal">{s.client_version}</span>}
      </td>
      <td className="app-mono break-all min-w-[140px]">
        {s.id}
        {s.connected_at && <span className="block app-meta">since {new Date(s.connected_at).toLocaleString()}</span>}
      </td>
      <td className="text-right tabular-nums">{s.tool_calls.toLocaleString()}</td>
      <td className="text-right tabular-nums app-mono">{usd(s.total_cost)}</td>
      <td className="text-right tabular-nums app-mono">{s.budget_limit > 0 ? `$${s.budget_limit.toFixed(2)}` : 'None'}</td>
      <td>{s.blocked ? <VerdictBadge v="blocked" title="Calls from this session do not run" /> : 'Accepting calls'}</td>
      <td className="min-w-[220px]">
        <div className="flex flex-wrap gap-2">
          {s.blocked ? (
            <button type="button" className="app-btn app-btn-secondary app-btn-sm" disabled={!!busy} onClick={() => act('approve')}>
              {busy === 'approve' ? 'Unblocking…' : 'Unblock'}
            </button>
          ) : confirmBlock ? (
            <>
              <button type="button" className="app-btn app-btn-danger app-btn-sm" disabled={!!busy} onClick={() => act('block')}>
                {busy === 'block' ? 'Blocking…' : 'Confirm block'}
              </button>
              <button type="button" className="app-btn app-btn-ghost app-btn-sm" disabled={!!busy} onClick={() => setConfirmBlock(false)}>Cancel</button>
            </>
          ) : (
            <button type="button" className="app-btn app-btn-secondary app-btn-sm" disabled={!!busy} onClick={() => setConfirmBlock(true)}>Block</button>
          )}
          {!editBudget && (
            <button type="button" className="app-btn app-btn-ghost app-btn-sm" disabled={!!busy}
              onClick={() => { setEditBudget(true); setBudget(s.budget_limit > 0 ? String(s.budget_limit) : ''); setBudgetErr(null) }}>Set budget</button>
          )}
        </div>
        {confirmBlock && !s.blocked && <p className="app-meta mt-1">Every further call from this session will be refused.</p>}
        {editBudget && (
          <form className="mt-2" onSubmit={saveBudget} noValidate>
            <label htmlFor={`${id}-b`} className="app-label block">Budget (USD)</label>
            <div className="flex gap-2 mt-1">
              <input id={`${id}-b`} className="app-input" style={{ width: 112 }} type="number" inputMode="decimal" min="0.01" step="0.01" value={budget}
                onChange={e => { setBudget(e.target.value); setBudgetErr(null) }} aria-invalid={!!budgetErr} aria-describedby={`${id}-bh`} />
              <button type="submit" className="app-btn app-btn-primary app-btn-sm" disabled={!!busy}>{busy === 'budget' ? 'Saving…' : 'Save'}</button>
              <button type="button" className="app-btn app-btn-ghost app-btn-sm" disabled={!!busy} onClick={() => setEditBudget(false)}>Cancel</button>
            </div>
            <p id={`${id}-bh`} className={budgetErr ? 'app-error-text mt-1' : 'app-meta mt-1'}>{budgetErr ?? 'Saving a budget also unblocks the session.'}</p>
          </form>
        )}
        {err && <p className="app-error-text mt-1" role="alert">{err}</p>}
      </td>
    </tr>
  )
}
