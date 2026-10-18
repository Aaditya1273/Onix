'use client'

import { useEffect, useState, Suspense } from 'react'
import { useSearchParams } from 'next/navigation'
import { AlertTriangle, Clock, Loader2 } from 'lucide-react'
import '@/app/(dashboard)/app.css'
import { fetchJSON, ApiError, describe } from '@/lib/api'
import { useResource } from '@/lib/useResource'
import { StatePanel, CopyButton } from '@/components/app/ui'
import { ConnectGuide } from './guide'

// The OAuth consent screen. Claude (or any MCP client) sends the user here
// with ?request=<id>; everything shown comes from GET /api/vigil/oauth/request.
// Nothing is granted until Approve returns 2xx, and the user only leaves for
// the client's redirect address after the server has answered.

interface OAuthRequest {
  request_id: string
  client_name: string
  client_id: string
  scope: string
  redirect_uri?: string
  expires_at: string
}

// The server turns a budget <= 0 into $10, so there is no "unlimited": $10 is the default.
const DEFAULT_BUDGET = 10
const PRESETS = [5, 10, 25, 50]

// What the connection can actually do: the tools the MCP server lists
// (internal/mcp/tools.go and internal/appserver/ask.go). The file and shell
// tools work inside the VIGIL server's own project folder, not on your computer.
const CAN_DO = [
  'Read, search and list files, and run shell commands, inside the VIGIL server’s own project folder (not on your computer).',
  'Ask VIGIL what it would decide for a call, what a call would touch, and why a call was stopped.',
  'Read VIGIL’s list of agents, a session’s behaviour profile and the cost status.',
]

function hostOf(uri?: string) {
  if (!uri) return null
  try { return new URL(uri) } catch { return null }
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="app-shell min-h-screen bg-[#F5F1EA] text-[#14100D] flex justify-center px-4 py-8 sm:py-14">
      <div className="w-full max-w-[520px]">
        <p className="font-[Epilogue,sans-serif] text-[20px] font-black tracking-[-0.04em] mb-6">VIGIL</p>
        {children}
      </div>
    </main>
  )
}

// An end state: expired, not found, denied, redirecting. Says what happened and what was (not) granted.
function Outcome({ title, children, busy }: { title: string; children: React.ReactNode; busy?: boolean }) {
  return (
    <Shell>
      <section className="app-panel p-6 sm:p-8" role="status" aria-live="polite">
        <h1 className="font-[Epilogue,sans-serif] text-[24px] leading-[30px] font-bold tracking-[-0.02em] flex items-center gap-2">
          {busy && <Loader2 className="w-5 h-5 animate-spin motion-reduce:animate-none text-[#6B6158]" aria-hidden="true" />}{title}
        </h1>
        <div className="app-sub mt-3 space-y-3">{children}</div>
      </section>
    </Shell>
  )
}

type Phase = { k: 'form' } | { k: 'approved'; to: string } | { k: 'denied'; to: string } | { k: 'expired'; denied?: boolean }

function Consent({ requestId }: { requestId: string }) {
  const r = useResource<OAuthRequest>(`/api/vigil/oauth/request?id=${encodeURIComponent(requestId)}`)
  const [phase, setPhase] = useState<Phase>({ k: 'form' })
  const [budget, setBudget] = useState(String(DEFAULT_BUDGET))
  const [busy, setBusy] = useState<'approve' | 'deny' | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())

  // The countdown, and the moment the request expires.
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 5000); return () => clearInterval(t) }, [])

  // Leave for the client only after the server has answered, and only to the address it returned.
  useEffect(() => {
    if (phase.k === 'approved' || phase.k === 'denied') window.location.assign(phase.to)
  }, [phase])

  if (phase.k === 'approved') return <Outcome title="Approved" busy>Returning you to <b className="text-[#14100D]">{hostOf(phase.to)?.host ?? 'the app'}</b>…</Outcome>
  if (phase.k === 'denied') return <Outcome title="Access denied" busy>Nothing was granted. Returning you to <b className="text-[#14100D]">{hostOf(phase.to)?.host ?? 'the app'}</b> so it knows you said no…</Outcome>
  if (phase.k === 'expired') {
    return (
      <Outcome title="This request already expired">
        <p>
          VIGIL no longer holds this request, so your {phase.denied ? 'Deny' : 'Approve'} changed nothing. Requests last 10 minutes and
          can be answered once; if you answered it in another tab, that answer stands.
        </p>
        <p>To connect, start again from your app (in Claude: Settings, Connectors).</p>
      </Outcome>
    )
  }

  if (r.status === 'loading') return <Shell><StatePanel kind="loading" title="Loading the connection request…" /></Shell>
  if (r.status === 'error' || !r.data) {
    if (r.error?.kind === 'not_found') {
      return (
        <Outcome title="Connection request not found">
          <p>There is no pending request with this link. It may have expired (requests last 10 minutes), been answered already, or the link is incomplete.</p>
          <p>Nothing was granted. Start the connection again from your app.</p>
        </Outcome>
      )
    }
    const sleeping = ['sleeping', 'network', 'timeout'].includes(r.error?.kind ?? '')
    return (
      <Shell>
        <StatePanel kind={sleeping ? 'sleeping' : 'error'} title={sleeping ? 'Cannot reach VIGIL yet' : 'The request could not be loaded'} onRetry={r.retry}>
          {describe(r.error)} Nothing has been granted.
        </StatePanel>
      </Shell>
    )
  }

  const req = r.data
  const expires = new Date(req.expires_at)
  const msLeft = expires.getTime() - now
  const expired = !isNaN(msLeft) && msLeft <= 0
  const minsLeft = Math.max(0, Math.ceil(msLeft / 60000))
  const dest = hostOf(req.redirect_uri)
  const insecure = dest && dest.protocol !== 'https:' && !['localhost', '127.0.0.1', '[::1]'].includes(dest.hostname)
  const amount = Number(budget)
  const budgetError = budget.trim() === '' || !Number.isFinite(amount) ? 'Enter a budget in US dollars.'
    : amount <= 0 ? 'The budget must be more than $0.' : null

  const approve = async () => {
    if (budgetError || expired) return
    setBusy('approve'); setErr(null)
    try {
      const d = await fetchJSON<{ redirect_to?: string }>('/api/vigil/oauth/approve', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ request_id: req.request_id, budget_limit: Math.round(amount * 100) / 100 }),
      })
      if (!d.redirect_to) throw new ApiError('parse', 'VIGIL approved the request but sent no address to return to. Start the connection again from your app.')
      setPhase({ k: 'approved', to: d.redirect_to })
    } catch (e) {
      if (e instanceof ApiError && e.kind === 'not_found') setPhase({ k: 'expired' })
      else { setErr(`Approval did not go through. ${describe(e)}`); setBusy(null) }
    }
  }

  const deny = async () => {
    setBusy('deny'); setErr(null)
    try {
      const d = await fetchJSON<{ redirect_to?: string; status?: string }>('/api/vigil/oauth/deny', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ request_id: req.request_id }),
      })
      if (d.status === 'already_expired') setPhase({ k: 'expired', denied: true })
      else if (d.redirect_to) setPhase({ k: 'denied', to: d.redirect_to })
      else throw new ApiError('parse', 'VIGIL did not say where to send you back.')
    } catch (e) {
      setErr(`Deny did not go through. ${describe(e)} Nothing has been granted; the request expires on its own at ${expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}.`)
      setBusy(null)
    }
  }

  return (
    <Shell>
      <section className="app-panel overflow-hidden" aria-labelledby="consent-title">
        <div className="p-6 sm:p-7 border-b border-[#E6DED2]">
          <h1 id="consent-title" className="font-[Epilogue,sans-serif] text-[24px] leading-[30px] font-bold tracking-[-0.02em]">Allow this app to use VIGIL?</h1>
          <p className="app-sub mt-2">An app is asking to connect to VIGIL&apos;s MCP tools. Check who it is and where approval sends you before you answer.</p>
          <p className={`mt-3 inline-flex items-center gap-1.5 text-[13px] font-medium ${expired || minsLeft <= 2 ? 'text-[#8A5A12]' : 'text-[#5E544B]'}`}>
            <Clock className="w-3.5 h-3.5" aria-hidden="true" />
            {isNaN(msLeft) ? 'Expiry time not reported.'
              : expired ? 'This request has expired.'
              : <>Expires at {expires.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} (in {minsLeft} minute{minsLeft === 1 ? '' : 's'})</>}
          </p>
        </div>

        <dl className="p-6 sm:p-7 space-y-5 border-b border-[#E6DED2]">
          <div>
            <dt className="app-label">The app</dt>
            <dd className="mt-1">
              <span className="text-[16px] font-semibold">{req.client_name ? `“${req.client_name}”` : 'No name given'}</span>
              <p className="app-meta mt-1">The app chose this name when it registered itself; VIGIL cannot verify it. The return address below is what identifies where your approval goes.</p>
              <div className="mt-2 flex items-center gap-2 min-w-0">
                <span className="app-meta shrink-0">Client ID</span>
                <code className="app-mono min-w-0 truncate" title={req.client_id}>{req.client_id}</code>
                <CopyButton text={req.client_id} label="Copy the client ID" />
              </div>
            </dd>
          </div>

          <div>
            <dt className="app-label">Returns you to</dt>
            <dd className="mt-1">
              {dest ? (
                <>
                  <span className="app-mono text-[15px] font-semibold text-[#14100D] break-all">{dest.host}</span>
                  <details className="mt-1">
                    <summary className="app-meta cursor-pointer w-fit">Full address</summary>
                    <code className="app-mono block mt-1 break-all text-[#5E544B]">{req.redirect_uri}</code>
                  </details>
                  {insecure && (
                    <p className="app-banner app-banner-warn mt-2"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />This address is not HTTPS, so the approval code would travel unencrypted.</p>
                  )}
                </>
              ) : (
                <span className="app-sub">— {req.redirect_uri ? <>an address this page could not read: <code className="app-mono break-all">{req.redirect_uri}</code></> : 'this server did not report it.'}</span>
              )}
            </dd>
          </div>

          <div>
            <dt className="app-label">Scope requested</dt>
            <dd className="mt-1 app-sub">
              {req.scope ? <code className="app-mono text-[#14100D]">{req.scope}</code> : <>None named (VIGIL has one scope, <code className="app-mono">mcp</code>: its MCP tools).</>}
            </dd>
          </div>

          <div>
            <dt className="app-label">With it, the app can</dt>
            <dd className="mt-1">
              <ul className="list-disc pl-5 space-y-1 text-[14px] leading-[21px] text-[#14100D]">
                {CAN_DO.map(t => <li key={t}>{t}</li>)}
              </ul>
              <p className="app-meta mt-2">Every call it makes is decided by VIGIL first and charged against the budget below.</p>
            </dd>
          </div>
        </dl>

        <div className="p-6 sm:p-7 bg-[#FAF7F2] border-b border-[#E6DED2]">
          <div className="app-field">
            <label htmlFor="budget" className="app-h3">Session budget (US dollars)</label>
            <div className="flex flex-wrap items-center gap-2">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-[#5E544B] text-[14px]" aria-hidden="true">$</span>
                <input id="budget" className="app-input" style={{ width: 120, paddingLeft: 24 }} type="number" inputMode="decimal" min="0.01" step="0.01"
                  value={budget} onChange={e => setBudget(e.target.value)} aria-invalid={!!budgetError} aria-describedby="budget-help budget-err" />
              </div>
              <div className="flex gap-1.5" role="group" aria-label="Common budgets">
                {PRESETS.map(p => (
                  <button key={p} type="button" onClick={() => setBudget(String(p))} aria-pressed={amount === p}
                    className={`app-btn app-btn-sm ${amount === p ? 'app-btn-primary' : 'app-btn-secondary'}`}>${p}</button>
                ))}
              </div>
            </div>
            {budgetError && <p id="budget-err" className="app-error-text" role="alert">{budgetError}</p>}
            <p id="budget-help" className="app-meta">When this session&apos;s spend reaches the budget, VIGIL blocks its further calls. There is no unlimited option; the default is ${DEFAULT_BUDGET}.</p>
          </div>
        </div>

        <div className="p-6 sm:p-7">
          {err && <p className="app-banner app-banner-error mb-4" role="alert"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" aria-hidden="true" />{err}</p>}
          <div className="flex flex-col-reverse sm:flex-row gap-3">
            <button type="button" onClick={deny} disabled={!!busy || expired} className="app-btn app-btn-secondary flex-1 min-h-[44px]">
              {busy === 'deny' && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Deny
            </button>
            <button type="button" onClick={approve} disabled={!!busy || expired || !!budgetError} className="app-btn app-btn-primary flex-1 min-h-[44px]">
              {busy === 'approve' && <Loader2 className="w-4 h-4 animate-spin motion-reduce:animate-none" aria-hidden="true" />}Approve with a ${budgetError ? '—' : amount.toFixed(2)} budget
            </button>
          </div>
          {expired && <p className="app-meta mt-3">This request expired, so it can no longer be approved or denied. Start the connection again from your app.</p>}
        </div>
      </section>
    </Shell>
  )
}

// Claude's OAuth flow lands here with ?request=…; anyone else gets the setup guide.
function ConnectRoute() {
  const id = useSearchParams().get('request')
  return id ? <Consent requestId={id} /> : <ConnectGuide />
}

export default function ConnectPage() {
  return (
    <Suspense fallback={<Shell><StatePanel kind="loading" title="Loading…" /></Shell>}>
      <ConnectRoute />
    </Suspense>
  )
}
