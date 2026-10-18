'use client'

import { useId, useState } from 'react'
import { AlertTriangle, Check, X } from 'lucide-react'
import { ApiError, describe, fetchJSON } from '@/lib/api'

interface Policy {
  declared_intent: string
  allowed_tools: string[] | null
  denied_tools: string[] | null
  allowed_resources: string[] | null
  denied_resources: string[] | null
  budget_usd: number
  risk_tolerance: string
  network_access: boolean
  secret_access: boolean
}

interface Draft {
  id: string
  session_id: string
  policy: Policy
  dangerous: string[] | null
  model_used: string
  provider: string
}

const EXAMPLE =
  'Allow reading project files and running tests. Block network access, secrets, ' +
  'and arbitrary shell commands. Limit this session to $2.'
const MAX = 2000

const list = (xs: string[] | null | undefined) => (xs && xs.length ? xs.join(', ') : 'none')

// The draft endpoint answers 503 when no inference model is configured; say that,
// not the generic "graph database" sentence a 503 gets elsewhere.
const draftError = (e: unknown) =>
  e instanceof ApiError && e.status === 503 && e.kind !== 'sleeping'
    ? 'Policy drafting is unavailable on this server: no inference model is configured.'
    : describe(e)

/**
 * Compiles plain English into a policy, then makes a human approve it.
 *
 * The draft the backend returns is inert: the model has no path to
 * enforcement. Applying it is a separate, explicit request, which is why this
 * is two steps instead of one.
 */
export function PolicyGenerator({ sessionId, onApplied, unavailable }: { sessionId: string; onApplied?: () => void; unavailable?: string | null }) {
  const [text, setText] = useState('')
  const [draft, setDraft] = useState<Draft | null>(null)
  const [busy, setBusy] = useState<null | 'draft' | 'apply' | 'discard'>(null)
  const [err, setErr] = useState<string | null>(null)
  const [invalid, setInvalid] = useState<string | null>(null)
  const [applied, setApplied] = useState<string | null>(null)
  const id = useId()

  const generate = async () => {
    const t = text.trim()
    if (!t) { setInvalid('Describe what the session may and may not do.'); return }
    if (t.length > MAX) { setInvalid(`Keep it under ${MAX} characters.`); return }
    setInvalid(null); setBusy('draft'); setErr(null); setApplied(null); setDraft(null)
    try {
      const d = await fetchJSON<{ draft: Draft }>('/api/v1/vigil/policy/draft', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ session_id: sessionId, text: t }), timeoutMs: 60000,
      })
      setDraft(d.draft)
    } catch (e) { setErr(draftError(e)) } finally { setBusy(null) }
  }

  const apply = async () => {
    if (!draft) return
    setBusy('apply'); setErr(null)
    try {
      await fetchJSON(`/api/v1/vigil/policy/draft/${encodeURIComponent(draft.id)}/confirm`, { method: 'POST' })
      setApplied(draft.session_id || sessionId); setDraft(null); setText(''); onApplied?.()
    } catch (e) {
      setErr(e instanceof ApiError && e.kind === 'not_found' ? 'This draft no longer exists on the server (it may have restarted). Generate it again.' : describe(e))
    } finally { setBusy(null) }
  }

  const discard = async () => {
    if (!draft) return
    setBusy('discard'); setErr(null)
    try {
      await fetchJSON(`/api/v1/vigil/policy/draft/${encodeURIComponent(draft.id)}`, { method: 'DELETE' })
      setDraft(null)
    } catch (e) {
      // Already gone on the server is the outcome discard wanted.
      if (e instanceof ApiError && e.kind === 'not_found') setDraft(null)
      else setErr(`Could not discard the draft: ${describe(e)}`)
    } finally { setBusy(null) }
  }

  return (
    <div className="app-card p-4 sm:p-6">
      <h3 className="app-h3">Draft a policy from plain English</h3>
      <p className="app-sub mt-1 mb-4">
        A model compiles your sentence into a structured policy. You review it; nothing is enforced until you apply it.
      </p>

      {unavailable && <div className="app-banner app-banner-info mb-4" role="status">{unavailable}</div>}

      <div className="app-field">
        <label htmlFor={`${id}-t`}>What may this session do?</label>
        <textarea id={`${id}-t`} className="app-input app-mono h-24" placeholder={EXAMPLE} value={text} maxLength={MAX + 200}
          aria-invalid={!!invalid} aria-describedby={invalid ? `${id}-e` : undefined}
          onChange={e => { setText(e.target.value); setInvalid(null) }} disabled={!!unavailable} />
        {invalid && <span id={`${id}-e`} className="app-error-text">{invalid}</span>}
      </div>

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button type="button" className="app-btn app-btn-primary" onClick={generate} disabled={!!busy || !!unavailable}>
          {busy === 'draft' ? 'Drafting…' : 'Draft policy'}
        </button>
        <button type="button" className="app-btn app-btn-ghost" onClick={() => { setText(EXAMPLE); setInvalid(null) }} disabled={!!busy || !!unavailable}>
          Use the example
        </button>
      </div>

      <div aria-live="polite">
        {err && <div className="app-banner app-banner-error mt-4" role="alert"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{err}</div>}
        {applied && <div className="app-banner app-banner-info mt-4"><Check className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />Applied. The server confirmed this policy is enforcing for session <code className="app-mono">{applied}</code>.</div>}
      </div>

      {draft && (
        <section className="mt-6 pt-5 border-t border-[#e6ded2]" aria-label="Proposed policy">
          <div className="flex flex-wrap items-center justify-between gap-2 mb-3">
            <h4 className="app-h3">Proposed policy: not enforced</h4>
            <span className="app-meta">Drafted by {draft.model_used || draft.provider || 'the model'}</span>
          </div>

          {!!draft.dangerous?.length && (
            <div className="app-banner app-banner-warn mb-4" role="note">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />
              <div><strong>Review before applying</strong><ul className="list-disc pl-5 mt-1">{draft.dangerous.map((d, i) => <li key={i}>{d}</li>)}</ul></div>
            </div>
          )}

          <dl className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2 text-sm">
            {[
              ['Intent', draft.policy.declared_intent || 'none stated'],
              ['Budget', `$${draft.policy.budget_usd}`],
              ['Allowed tools', draft.policy.allowed_tools?.length ? list(draft.policy.allowed_tools) : 'any tool not denied'],
              ['Denied tools', list(draft.policy.denied_tools)],
              ['Denied resources', list(draft.policy.denied_resources)],
              ['Network', draft.policy.network_access ? 'allowed' : 'denied'],
              ['Secrets', draft.policy.secret_access ? 'allowed' : 'denied'],
              ['When unsure', draft.policy.risk_tolerance],
            ].map(([k, v]) => (
              <div key={k} className="flex gap-2 min-w-0"><dt className="app-label shrink-0 w-32">{k}</dt><dd className="min-w-0 break-words">{v}</dd></div>
            ))}
          </dl>
          <details className="mt-3">
            <summary className="app-meta cursor-pointer">Raw policy JSON</summary>
            <pre className="app-mono mt-2 bg-[#faf7f2] border border-[#e6ded2] rounded-lg p-3 overflow-x-auto">{JSON.stringify(draft.policy, null, 2)}</pre>
          </details>

          <div className="flex flex-wrap items-center gap-2 mt-4">
            <button type="button" className="app-btn app-btn-primary" onClick={apply} disabled={!!busy}>
              <Check className="w-4 h-4" aria-hidden="true" />{busy === 'apply' ? 'Applying…' : `Apply to session ${draft.session_id || sessionId}`}
            </button>
            <button type="button" className="app-btn app-btn-secondary" onClick={discard} disabled={!!busy}>
              <X className="w-4 h-4" aria-hidden="true" />{busy === 'discard' ? 'Discarding…' : 'Discard'}
            </button>
          </div>
        </section>
      )}
    </div>
  )
}
