'use client'

import { useId, useState } from 'react'
import { Check, Plus } from 'lucide-react'
import { PolicyGenerator } from '@/components/PolicyGenerator'
import { useResource, type Resource } from '@/lib/useResource'
import { describe, fetchJSON } from '@/lib/api'
import { ResourceGate, StatePanel } from '@/components/app/ui'

interface CostPolicy {
  id?: string
  name: string
  condition?: { dimension?: string; metric?: string; threshold: number; operator: string }
  action: string
  enabled?: boolean
}

interface IntentPolicy {
  session_id: string
  declared_intent: string
  allowed_tools: string[] | null
  denied_tools: string[] | null
  denied_resources: string[] | null
  budget_usd: number
  risk_tolerance: string
  network_access: boolean
  secret_access: boolean
  created_at?: string
}

interface SessionPolicy { policy: IntentPolicy; is_default: boolean; enforcing: boolean }
interface Sessions { sessions: { id: string; client_name?: string }[] | null }
interface Models { configured: boolean }

const DIMENSIONS: Record<string, string> = { run_cost: 'Cost of one run', daily_budget: 'Spend today' }
const ACTIONS: Record<string, string> = {
  KILL_RUN: 'Stop the run', ALERT: 'Alert only', CIRCUIT_BREAKER: 'Open the circuit breaker', TRIGGER_FALLBACK: 'Switch to a fallback',
}
const EMPTY = { name: '', dimension: 'run_cost', operator: '>', threshold: '5', action: 'KILL_RUN' }

const list = (xs: string[] | null | undefined) => (xs && xs.length ? xs.join(', ') : null)

function validate(f: typeof EMPTY) {
  const e: Partial<Record<keyof typeof EMPTY, string>> = {}
  if (!f.name.trim()) e.name = 'Give the policy a name.'
  else if (f.name.trim().length > 80) e.name = 'Keep the name under 80 characters.'
  const t = Number(f.threshold)
  if (f.threshold.trim() === '' || !Number.isFinite(t)) e.threshold = 'Enter a dollar amount.'
  else if (t <= 0) e.threshold = 'The threshold must be more than $0.'
  else if (t > 1_000_000) e.threshold = 'The threshold must be $1,000,000 or less.'
  return e
}

export default function PoliciesPage() {
  const [session, setSession] = useState('default')
  const sessions = useResource<Sessions>('/api/vigil/mcp/sessions', { intervalMs: 30000 })
  const models = useResource<Models>('/api/v1/vigil/models')
  const current = useResource<SessionPolicy>(`/api/v1/vigil/sessions/${encodeURIComponent(session)}/policy`)
  const costs = useResource<CostPolicy[]>('/api/v1/vigil/cost/policies')
  const digest = useResource<{ observe_mode: boolean }>('/api/v1/vigil/digest?days=1')

  const ids = ['default', ...(sessions.data?.sessions ?? []).map(s => s.id).filter(x => x !== 'default')]
  const unavailable = models.data && !models.data.configured
    ? 'Drafting needs an inference model, and none is configured on this server. Set a vendor API key on the server to enable it.'
    : null

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Policies</h1>
      <p>Intent policies decide what one session may do. Cost policies are thresholds recorded on the server.</p>

      {digest.data?.observe_mode && (
        <div className="app-banner app-banner-warn mt-6" role="status">
          Observe mode is on: for Claude Code hook calls VIGIL records what these policies would decide, but does not enforce them.
        </div>
      )}

      <section className="mt-8" aria-labelledby="intent-h">
        <h2 id="intent-h" className="app-h2">Intent policy</h2>
        <p className="app-sub mt-1 mb-4">Checked first on every tool call in the session, before the graph and the budget.</p>

        <div className="app-field max-w-md mb-4">
          <label htmlFor="sess">Session</label>
          <select id="sess" className="app-input app-mono" value={session} onChange={e => setSession(e.target.value)}>
            {ids.map(id => <option key={id} value={id}>{id}</option>)}
          </select>
          {sessions.status === 'error' && <span className="app-meta">Connected MCP sessions could not be listed: {describe(sessions.error)}</span>}
        </div>

        <div className="mb-4">
          <ResourceGate r={current} loading="Loading this session's policy…" compact>
            {p => p.policy.session_id === session ? <CurrentPolicy p={p} /> : <StatePanel kind="loading" title="Loading this session's policy…" compact />}
          </ResourceGate>
        </div>

        <PolicyGenerator key={session} sessionId={session} onApplied={current.retry} unavailable={unavailable} />
      </section>

      <CostPolicies costs={costs} />
    </div>
  )
}

function CurrentPolicy({ p }: { p: SessionPolicy }) {
  const x = p.policy
  if (p.is_default) {
    return (
      <div className="app-card p-4">
        <p className="app-h3">No declared intent</p>
        <p className="app-sub mt-1">
          This session runs under the permissive default: every tool is allowed, network and secrets included. Only the budget
          {x.budget_usd > 0 ? <> of <strong>${x.budget_usd}</strong></> : null} and the graph checks apply.
        </p>
      </div>
    )
  }
  const rows: [string, string | null][] = [
    ['Intent', x.declared_intent || null],
    ['Budget', x.budget_usd > 0 ? `$${x.budget_usd}` : null],
    ['Allowed tools', list(x.allowed_tools) ?? 'any tool not denied'],
    ['Denied tools', list(x.denied_tools)],
    ['Denied resources', list(x.denied_resources)],
    ['Network', x.network_access ? 'allowed' : 'denied'],
    ['Secrets', x.secret_access ? 'allowed' : 'denied'],
    ['When unsure', x.risk_tolerance],
  ]
  return (
    <div className="app-card p-4">
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <p className="app-h3">Declared intent</p>
        <span className="app-label">{p.enforcing ? 'Enforcing (reported by the server)' : 'Not enforcing'}</span>
      </div>
      <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
        {rows.filter(([, v]) => v).map(([k, v]) => (
          <div key={k} className="flex gap-2 min-w-0"><dt className="app-label shrink-0 w-32">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
        ))}
      </dl>
    </div>
  )
}

function CostPolicies({ costs }: { costs: Resource<CostPolicy[]> }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState(EMPTY)
  const [errors, setErrors] = useState<ReturnType<typeof validate>>({})
  const [saving, setSaving] = useState(false)
  const [saveErr, setSaveErr] = useState<string | null>(null)
  const [saved, setSaved] = useState<string | null>(null)
  const id = useId()

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setForm(f => ({ ...f, [k]: e.target.value })); setErrors(x => ({ ...x, [k]: undefined }))
  }

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    const v = validate(form)
    setErrors(v); setSaveErr(null)
    if (Object.keys(v).length) return
    setSaving(true)
    try {
      await fetchJSON('/api/v1/vigil/cost/policies', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: form.name.trim(),
          condition: { dimension: form.dimension, operator: form.operator, threshold: Number(form.threshold) },
          action: form.action,
          enabled: true,
        }),
      })
      setSaved(form.name.trim()); setForm(EMPTY); setOpen(false); costs.retry()
    } catch (err) {
      setSaveErr(`Not saved: ${describe(err)}`) // the form keeps what was typed
    } finally { setSaving(false) }
  }

  const fieldErr = (k: keyof typeof EMPTY) => errors[k] && <span id={`${id}-${k}-e`} className="app-error-text">{errors[k]}</span>

  return (
    <section className="mt-10" aria-labelledby="cost-h">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="cost-h" className="app-h2">Cost policies</h2>
          <p className="app-sub mt-1">
            Stored in server memory until it restarts, and listed on Cost Firewall. This server does not yet evaluate them against tool calls:
            spending is stopped by session budgets. There is no edit or delete on this server.
          </p>
        </div>
        {!open && (
          <button type="button" className="app-btn app-btn-secondary" onClick={() => { setOpen(true); setSaved(null) }}>
            <Plus className="w-4 h-4" aria-hidden="true" />New cost policy
          </button>
        )}
      </div>

      <div aria-live="polite">
        {saved && <div className="app-banner app-banner-info mt-4"><Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />Saved “{saved}”. The server accepted it.</div>}
      </div>

      {open && (
        <form className="app-card p-4 sm:p-5 mt-4" onSubmit={save} noValidate aria-labelledby={`${id}-h`}>
          <h3 id={`${id}-h`} className="app-h3 mb-4">New cost policy</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="app-field">
              <label htmlFor={`${id}-name`}>Name</label>
              <input id={`${id}-name`} className="app-input" value={form.name} onChange={set('name')} placeholder="Stop runs over $10"
                aria-invalid={!!errors.name} aria-describedby={errors.name ? `${id}-name-e` : undefined} />
              {fieldErr('name')}
            </div>
            <div className="app-field">
              <label htmlFor={`${id}-dim`}>Measure</label>
              <select id={`${id}-dim`} className="app-input" value={form.dimension} onChange={set('dimension')}>
                {Object.entries(DIMENSIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
            <div className="app-field">
              <label htmlFor={`${id}-thr`}>Threshold (USD)</label>
              <div className="flex gap-2">
                <select aria-label="Comparison" className="app-input shrink-0" style={{ width: 72 }} value={form.operator} onChange={set('operator')}>
                  <option value=">">&gt;</option><option value=">=">≥</option>
                </select>
                <input id={`${id}-thr`} className="app-input min-w-0" type="number" inputMode="decimal" min="0.01" step="0.01" value={form.threshold}
                  onChange={set('threshold')} aria-invalid={!!errors.threshold} aria-describedby={errors.threshold ? `${id}-threshold-e` : undefined} />
              </div>
              {fieldErr('threshold')}
            </div>
            <div className="app-field">
              <label htmlFor={`${id}-act`}>Action</label>
              <select id={`${id}-act`} className="app-input" value={form.action} onChange={set('action')}>
                {Object.entries(ACTIONS).map(([k, l]) => <option key={k} value={k}>{l}</option>)}
              </select>
            </div>
          </div>
          {saveErr && <div className="app-banner app-banner-error mt-4" role="alert">{saveErr}</div>}
          <div className="flex gap-2 mt-4">
            <button type="submit" className="app-btn app-btn-primary" disabled={saving}>{saving ? 'Saving…' : 'Save policy'}</button>
            <button type="button" className="app-btn app-btn-ghost" disabled={saving} onClick={() => { setOpen(false); setErrors({}); setSaveErr(null) }}>Cancel</button>
          </div>
        </form>
      )}

      <div className="mt-4">
        <ResourceGate r={costs} loading="Loading cost policies…" isEmpty={d => !d.length}
          empty={<StatePanel kind="empty" title="No cost policies">None have been saved since the server started.</StatePanel>}>
          {d => (
            <div className="app-table-wrap">
              <table className="data-table">
                <thead><tr><th scope="col">Name</th><th scope="col">Condition</th><th scope="col">Action</th><th scope="col">State</th></tr></thead>
                <tbody>
                  {d.map((p, i) => {
                    const dim = p.condition?.dimension || p.condition?.metric || ''
                    return (
                      <tr key={p.id || `${p.name}-${i}`}>
                        <td className="font-medium">{p.name}</td>
                        <td className="app-mono">{DIMENSIONS[dim] ?? (dim || '—')} {p.condition?.operator} ${p.condition?.threshold}</td>
                        <td>{ACTIONS[p.action] ?? p.action}</td>
                        <td className="text-[#5e544b]">{p.enabled ? 'Recorded, not evaluated' : 'Disabled'}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ResourceGate>
      </div>
    </section>
  )
}
