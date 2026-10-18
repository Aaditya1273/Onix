'use client'

import { useSyncExternalStore } from 'react'
import { useResource, type Resource } from '@/lib/useResource'
import { describe } from '@/lib/api'
import { CopyButton } from '@/components/app/ui'

const HOSTED = 'https://vigil-server.onrender.com'
const MCP_URL = `${HOSTED}/api/v1/mcp`
const CLAUDE_CODE_CMD = `claude mcp add --transport sse vigil ${MCP_URL}`

const noSubscribe = () => () => {}

type Row = { label: string; value: string; detail: string; tone?: 'warn' | 'error' }

function row<T>(label: string, r: Resource<T>, ok: (d: T) => Omit<Row, 'label'>, onError?: (r: Resource<T>) => Omit<Row, 'label'> | null): Row {
  if (r.status === 'loading') return { label, value: 'Checking…', detail: '' }
  if (r.status === 'error' || !r.data) return { label, ...(onError?.(r) ?? { value: 'Unknown', detail: describe(r.error), tone: 'error' as const }) }
  return { label, ...ok(r.data) }
}

export default function SettingsPage() {
  const digest = useResource<{ observe_mode: boolean }>('/api/v1/vigil/digest?days=1', { intervalMs: 60000 })
  const models = useResource<{ configured: boolean; provider: string }>('/api/v1/vigil/models', { intervalMs: 60000 })
  const stats = useResource<{ budget: number }>('/api/vigil/stats', { intervalMs: 60000 })
  // Read after mount: the server has no window, and rendering it inline makes
  // the server and browser HTML disagree (a hydration error).
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => '')

  const rows: Row[] = [
    row('Graph memory (FalkorDB)', digest,
      () => ({ value: 'Connected', detail: 'Decisions, earned trust and threat intel persist across restarts.' }),
      r => r.error?.kind === 'unavailable'
        ? { value: 'Not configured', detail: 'VIGIL_FALKORDB_URL is not set on the server. Intent and cost checks still run, but nothing is remembered across sessions.', tone: 'warn' }
        : null),
    row('Claude Code hook', digest, d => d.observe_mode
      ? { value: 'Observe mode', detail: 'Hook calls are decided and recorded, but not enforced (VIGIL_MODE=observe).', tone: 'warn' }
      : { value: 'Enforcing', detail: 'Hook calls get the verdict VIGIL decides.' },
      r => r.error?.kind === 'unavailable' ? { value: 'Unknown', detail: 'The mode is reported with the graph digest, which needs graph memory.' } : null),
    row('Inference', models, d => d.configured
      ? { value: 'Configured', detail: `Provider: ${d.provider}. Used only when the deterministic checks are uncertain.` }
      : { value: 'None', detail: 'Every call is decided without a model. This is a supported setup.' }),
    row('Server budget limit', stats, d => d.budget > 0
      ? { value: `$${d.budget.toLocaleString()}`, detail: 'The default budget for a session that did not set one.' }
      : { value: 'No budget limit set', detail: 'Sessions are not capped by a server-wide budget.', tone: 'warn' }),
  ]

  const endpoints = [
    { label: 'MCP endpoint (hosted, SSE)', value: MCP_URL },
    { label: 'Claude Code command', value: CLAUDE_CODE_CMD },
    { label: 'OAuth discovery (hosted)', value: `${HOSTED}/.well-known/oauth-authorization-server` },
    ...(origin ? [{ label: 'This dashboard', value: origin }] : []),
  ]

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Settings</h1>
      <p>How this server is configured, as it reports itself. These values are set on the server; nothing on this page changes them.</p>

      <section className="mt-8" aria-labelledby="st-h">
        <h2 id="st-h" className="app-h2">Server status</h2>
        <p className="app-sub mt-1 mb-4">Checked every minute.</p>
        <dl className="app-card divide-y divide-[#efe9e0]">
          {rows.map(r => (
            <div key={r.label} className="grid grid-cols-1 sm:grid-cols-[220px_180px_1fr] gap-1 sm:gap-4 px-4 py-3">
              <dt className="app-label sm:pt-0.5">{r.label}</dt>
              <dd className={`font-semibold ${r.tone === 'error' ? 'text-[#b42318]' : r.tone === 'warn' ? 'text-[#7a4f0f]' : ''}`}>{r.value}</dd>
              <dd className="app-sub">{r.detail}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section className="mt-8" aria-labelledby="ep-h">
        <h2 id="ep-h" className="app-h2">Endpoints</h2>
        <p className="app-sub mt-1 mb-4">What to give an MCP client. Set-up for each client is on Plugins.</p>
        <ul className="app-card divide-y divide-[#efe9e0]">
          {endpoints.map(e => (
            <li key={e.label} className="flex flex-col sm:flex-row sm:items-center gap-2 sm:gap-4 px-4 py-3">
              <span className="app-label sm:w-[220px] shrink-0">{e.label}</span>
              <code className="app-mono flex-1 min-w-0 break-all select-all">{e.value}</code>
              <CopyButton text={e.value} label={`Copy ${e.label}`} className="self-start sm:self-auto" />
            </li>
          ))}
        </ul>
      </section>
    </div>
  )
}
