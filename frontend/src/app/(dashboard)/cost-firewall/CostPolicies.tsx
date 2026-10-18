'use client'

import { useState } from 'react'
import { Plus } from 'lucide-react'
import { fetchJSON, describe } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { ResourceGate, StatePanel } from '@/components/app/ui'

// GET/POST /api/v1/vigil/cost/policies. The server has no edit or delete
// endpoint for these, so the page offers neither.
interface CostPolicy {
  id: string
  name: string
  condition: { dimension: string; operator: string; threshold: number }
  action: string
  enabled: boolean
  created_at: string
}

// The dimensions the server's policy engine knows how to measure.
const DIMENSIONS: Record<string, string> = {
  run_cost: 'Cost of one run',
  daily_budget: 'Spend today',
  'model_gpt-4': 'Spend on gpt-4',
}
const ACTIONS: Record<string, string> = { ALERT: 'Alert', KILL_RUN: 'Stop the run' }

const usd = (v: number) => `$${v < 1 ? v.toFixed(4) : v.toFixed(2)}`

export function CostPolicies() {
  const res = useResource<CostPolicy[] | null>('/api/v1/vigil/cost/policies', { intervalMs: 15000 })
  const [open, setOpen] = useState(false)

  return (
    <section className="mt-10" aria-labelledby="cp-title">
      <div className="flex flex-wrap items-end justify-between gap-3 mb-3">
        <div>
          <h2 id="cp-title" className="app-h2">Cost policies</h2>
          <p className="app-sub">
            Rules stored on the server, kept in memory until it restarts. This server stores them but does not yet check calls against them.
            They cannot be edited or deleted here.
          </p>
        </div>
        {!open && (
          <button type="button" className="app-btn app-btn-primary" onClick={() => setOpen(true)}>
            <Plus className="w-4 h-4" aria-hidden="true" />New cost policy
          </button>
        )}
      </div>

      {open && <NewPolicy onClose={() => setOpen(false)} onCreated={res.retry} />}

      <ResourceGate r={res} loading="Loading cost policies…" compact
        isEmpty={d => !d || d.length === 0}
        empty={<StatePanel kind="empty" title="No cost policies" compact>None have been added since the server started.</StatePanel>}>
        {d => (
          <div className="app-table-wrap">
            <table className="data-table">
              <thead>
                <tr><th scope="col">Name</th><th scope="col">Rule</th><th scope="col">Action</th><th scope="col">Enabled</th><th scope="col">Added</th></tr>
              </thead>
              <tbody>
                {(d ?? []).map((p, i) => (
                  <tr key={p.id || i}>
                    <td className="font-medium">{p.name || '—'}</td>
                    <td className="text-[13px]">
                      {DIMENSIONS[p.condition?.dimension] ?? (p.condition?.dimension || 'No measure set')}{' '}
                      <span className="app-mono">{p.condition?.operator} {usd(p.condition?.threshold ?? 0)}</span>
                    </td>
                    <td className="text-[13px]">{ACTIONS[p.action] ?? (p.action || '—')}</td>
                    <td className="text-[13px]">{p.enabled ? 'Yes' : 'No'}</td>
                    <td className="app-mono whitespace-nowrap">
                      {p.created_at && !p.created_at.startsWith('0001') ? new Date(p.created_at).toLocaleString() : '—'}
                    </td>
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

function NewPolicy({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('')
  const [dimension, setDimension] = useState('run_cost')
  const [operator, setOperator] = useState('>')
  const [limit, setLimit] = useState('')
  const [action, setAction] = useState('ALERT')
  const [touched, setTouched] = useState(false)
  const [busy, setBusy] = useState(false)
  const [serverError, setServerError] = useState('')
  const [saved, setSaved] = useState('')

  const amount = Number(limit)
  const nameError = name.trim() ? '' : 'Give the policy a name.'
  const limitError = limit.trim() === '' ? 'Enter a limit in US dollars.'
    : !Number.isFinite(amount) || amount <= 0 ? 'The limit must be a number above 0.' : ''

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setTouched(true); setServerError(''); setSaved('')
    if (nameError || limitError) return
    setBusy(true)
    try {
      await fetchJSON('/api/v1/vigil/cost/policies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: `cost-${Date.now()}`,
          name: name.trim(),
          condition: { dimension, operator, threshold: amount },
          action,
          enabled: true,
          created_at: new Date().toISOString(),
        }),
      })
      // Only a 2xx reaches here.
      setSaved(`Saved “${name.trim()}”.`)
      setName(''); setLimit(''); setTouched(false)
      onCreated()
    } catch (err) {
      setServerError(`Not saved. ${describe(err)}`)
    } finally { setBusy(false) }
  }

  return (
    <form onSubmit={submit} noValidate className="app-card p-5 mb-4" aria-labelledby="np-title">
      <h3 id="np-title" className="app-h3 mb-3">New cost policy</h3>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-6">
        <label className="app-field lg:col-span-2">
          <span className="app-label">Name</span>
          <input className="app-input" value={name} onChange={e => setName(e.target.value)} maxLength={80}
            aria-invalid={touched && !!nameError} aria-describedby={touched && nameError ? 'np-name-err' : undefined} />
          {touched && nameError && <span id="np-name-err" className="app-error-text">{nameError}</span>}
        </label>
        <label className="app-field">
          <span className="app-label">Measure</span>
          <select className="app-input" value={dimension} onChange={e => setDimension(e.target.value)}>
            {Object.entries(DIMENSIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
        <div className="grid grid-cols-[130px_1fr] gap-2 lg:col-span-2">
          <label className="app-field">
            <span className="app-label">When</span>
            <select className="app-input" value={operator} onChange={e => setOperator(e.target.value)}>
              <option value=">">above</option>
              <option value=">=">at or above</option>
            </select>
          </label>
          <label className="app-field">
            <span className="app-label">Limit (USD)</span>
            <input className="app-input" inputMode="decimal" value={limit} onChange={e => setLimit(e.target.value)} placeholder="5.00"
              aria-invalid={touched && !!limitError} aria-describedby={touched && limitError ? 'np-limit-err' : undefined} />
          </label>
        </div>
        <label className="app-field">
          <span className="app-label">Action</span>
          <select className="app-input" value={action} onChange={e => setAction(e.target.value)}>
            {Object.entries(ACTIONS).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
          </select>
        </label>
      </div>
      {touched && limitError && <p id="np-limit-err" className="app-error-text mt-2">{limitError}</p>}
      <div className="flex flex-wrap items-center gap-2 mt-4">
        <button type="submit" className="app-btn app-btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save policy'}</button>
        <button type="button" className="app-btn app-btn-ghost" onClick={onClose} disabled={busy}>Close</button>
        <span aria-live="polite" className="text-[13px]">
          {saved && <span className="text-[#14100d]">{saved}</span>}
        </span>
      </div>
      {serverError && <div className="app-banner app-banner-error mt-3" role="alert">{serverError}</div>}
    </form>
  )
}
