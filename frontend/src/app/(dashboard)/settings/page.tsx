'use client'

import { useEffect, useState, useSyncExternalStore } from 'react'
import { Shield, Database, CheckCircle, AlertTriangle, Copy, Check } from 'lucide-react'

function CopyBtn({ text }: { text: string }) {
  const [c, setC] = useState(false)
  return (
    <button onClick={() => { navigator.clipboard.writeText(text); setC(true); setTimeout(() => setC(false), 1500) }}
      className="p-1.5 rounded-lg hover:bg-gray-100 transition-colors text-gray-400 hover:text-gray-600">
      {c ? <Check className="w-3.5 h-3.5 text-green-600" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

type GraphState = 'loading' | 'connected' | 'unconfigured' | 'offline'

const noSubscribe = () => () => {}

export default function SettingsPage() {
  const [graph, setGraph] = useState<GraphState>('loading')
  const [observe, setObserve] = useState(false)
  // Read after mount: the server has no window, and rendering it inline makes
  // the server and browser HTML disagree (a hydration error).
  const origin = useSyncExternalStore(noSubscribe, () => window.location.origin, () => '—')

  const BACKEND = process.env.NEXT_PUBLIC_VIGIL_BACKEND_URL || 'https://vigil-server.onrender.com'

  useEffect(() => {
    // The digest answers from FalkorDB, and is a 503 when no graph is configured.
    fetch(`${BACKEND}/api/v1/vigil/digest?days=1`)
      .then(async r => {
        if (r.status === 503) { setGraph('unconfigured'); return }
        if (!r.ok) { setGraph('offline'); return }
        const body = await r.json()
        setObserve(!!body.observe_mode)
        setGraph('connected')
      })
      .catch(() => setGraph('offline'))
  }, [BACKEND])

  return (
    <div className="p-8 max-w-4xl mx-auto animate-fadeIn">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Settings</h1>
        <p className="text-sm text-gray-500 mt-1">VIGIL configuration and graph memory status.</p>
      </div>

      <div className="card p-6 mb-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
            <Database className="w-5 h-5 text-orange-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900">FalkorDB graph memory</h2>
          {graph === 'connected' && (
            <span className={`pill ml-auto ${observe ? 'pill-orange' : 'pill-green'}`}>{observe ? 'Observe mode' : 'Enforcing'}</span>
          )}
        </div>
        {graph === 'loading' && <p className="text-sm text-gray-400">Checking…</p>}
        {graph === 'connected' && (
          <p className="flex items-center gap-2 text-sm text-green-700">
            <CheckCircle className="w-4 h-4" /> Connected. Decisions, earned trust and threat intel persist across restarts.
          </p>
        )}
        {graph === 'unconfigured' && (
          <div className="px-4 py-3 rounded-xl bg-orange-50 border border-orange-200 text-sm text-orange-700">
            No graph configured. Set <code className="font-mono text-xs bg-white px-1 rounded border">VIGIL_FALKORDB_URL</code> on
            the server (<code className="font-mono text-xs bg-white px-1 rounded border">docker compose up</code> runs one locally).
            Without it the firewall still enforces intent and cost, but has no memory.
          </div>
        )}
        {graph === 'offline' && (
          <div className="flex items-center gap-2 px-4 py-3 rounded-xl bg-red-50 border border-red-200 text-sm text-red-600">
            <AlertTriangle className="w-4 h-4 flex-shrink-0" />
            Backend offline — start the Go server on :8080
          </div>
        )}
      </div>

      {/* VIGIL server info */}
      <div className="card p-6">
        <div className="flex items-center gap-3 mb-4">
          <div className="w-9 h-9 rounded-xl bg-orange-50 flex items-center justify-center">
            <Shield className="w-5 h-5 text-orange-600" />
          </div>
          <h2 className="text-sm font-semibold text-gray-900">VIGIL Backend</h2>
        </div>
        <div className="grid grid-cols-2 gap-3">
          {[
            { l: 'Backend URL',     v: BACKEND },
            { l: 'Dashboard URL',   v: origin },
            { l: 'MCP Endpoint',    v: `${BACKEND}/api/v1/mcp` },
            { l: 'OAuth Discovery', v: `${BACKEND}/.well-known/oauth-authorization-server` },
          ].map(s => (
            <div key={s.l} className="bg-gray-50 rounded-xl px-4 py-3 flex items-center justify-between">
              <div>
                <p className="text-xs text-gray-500">{s.l}</p>
                <p className="text-xs font-mono text-gray-800 mt-0.5 truncate max-w-[220px]">{s.v}</p>
              </div>
              <CopyBtn text={s.v} />
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}
