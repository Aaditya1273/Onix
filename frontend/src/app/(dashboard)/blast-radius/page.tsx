'use client'

import { useState } from 'react'
import { Search, ShieldAlert } from 'lucide-react'
import { EntityGraph, type GraphContext } from '@/components/EntityGraph'
import { useResource } from '@/lib/useResource'
import { InfoPopover, Kpi, ResourceGate, StatePanel } from '@/components/app/ui'

interface BlastRadiusResult {
  package: string
  squat_of?: string
  dependents: number
  exposed_services: string[]
  maintainer_shared: string[]
  typosquats: string[]
  maintainer_risk?: { name: string; score: number }[]
  dependency_graph: GraphContext
  maintainer_graph: GraphContext
  typosquat_graph: GraphContext
  blast_radius_time_ms: number
}

// Package names to try. Whether each is in your graph depends on what was
// loaded (`vigil-cli graph-seed`, or scripts/ingest_npm.py for real npm data).
const EXAMPLES = ['reqeusts', 'cross-env-2', 'express', 'lodash', 'left-pad']

export default function BlastRadiusPage() {
  const [input, setInput] = useState('')
  const [pkg, setPkg] = useState('')
  const check = (name: string) => { const n = name.trim(); setInput(n); setPkg(n) }

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Blast Radius</h1>
      <p>What a package can reach before it is installed: who depends on it, who else its maintainers control, and whether it is a look-alike of a real package. VIGIL runs the same graph checks on <code className="app-mono">pip install</code> and <code className="app-mono">npm install</code>.</p>

      <form onSubmit={e => { e.preventDefault(); check(input) }} className="app-card p-4 sm:p-5 mt-6 mb-6">
        <div className="flex flex-col sm:flex-row sm:items-end gap-3">
          <div className="app-field flex-1">
            <label htmlFor="br-pkg">Package name</label>
            <div className="relative">
              <Search className="w-4 h-4 text-[#6b6158] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
              <input id="br-pkg" value={input} onChange={e => setInput(e.target.value)} className="app-input" style={{ paddingLeft: 36 }}
                placeholder="e.g. reqeusts" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
            </div>
          </div>
          <button type="submit" className="app-btn app-btn-primary" disabled={!input.trim()}>Check package</button>
        </div>
        <div className="flex flex-wrap items-center gap-2 mt-3">
          <span className="app-meta">Try:</span>
          {EXAMPLES.map(s => (
            <button key={s} type="button" onClick={() => check(s)} aria-pressed={pkg === s} className="app-btn app-btn-secondary app-btn-sm app-mono">{s}</button>
          ))}
        </div>
      </form>

      {pkg ? <Result key={pkg} pkg={pkg} /> : (
        <StatePanel kind="empty" title="Check a package">Enter a package name, or pick one of the examples, to query the code graph in FalkorDB.</StatePanel>
      )}
    </div>
  )
}

function Result({ pkg }: { pkg: string }) {
  const r = useResource<BlastRadiusResult>(`/api/v1/blast-radius?package=${encodeURIComponent(pkg)}`)
  return (
    <ResourceGate r={r} loading={`Querying the code graph for ${pkg}…`}>
      {d => {
        const squat = !!d.squat_of
        const impersonators = d.typosquats.filter(t => t.toLowerCase() !== d.package.toLowerCase())
        const graph: GraphContext = { chunk_relations: [...(d.dependency_graph.chunk_relations ?? []), ...(d.maintainer_graph.chunk_relations ?? []), ...(d.typosquat_graph.chunk_relations ?? [])] }
        const nothing = !squat && d.dependents === 0 && !d.maintainer_shared.length && !impersonators.length && !graph.chunk_relations!.some(c => c.triplets?.length)
        return (
          <>
            {squat ? (
              <div className="app-banner app-banner-error mb-4" role="status">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <span><strong className="font-semibold">{d.package} is a look-alike of {d.squat_of}.</strong> The graph has a TYPOSQUAT_OF edge from it to the real package. VIGIL’s install check finds this same edge and blocks the install (in observe mode it only records it).</span>
              </div>
            ) : impersonators.length > 0 ? (
              <div className="app-banner app-banner-warn mb-4" role="status">
                <ShieldAlert className="w-5 h-5 shrink-0 mt-0.5" aria-hidden="true" />
                <span><strong className="font-semibold">{d.package} has {impersonators.length} look-alike{impersonators.length === 1 ? '' : 's'}:</strong> {impersonators.join(', ')}. The package itself is the real one; the look-alikes are what VIGIL stops.</span>
              </div>
            ) : nothing ? (
              <div className="app-banner app-banner-info mb-4" role="status">
                <span>The code graph has no dependents, maintainers or look-alikes recorded for <strong className="font-semibold">{d.package}</strong>. Either it is not in the graph, or nothing links to it. This is not a statement that the package is safe.</span>
              </div>
            ) : null}

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              <Kpi value={d.dependents} label="Dependents" note="Packages and services that depend on it, up to 4 hops" />
              <Kpi value={d.exposed_services.length} label="Exposed services" note="Services among those dependents" />
              <Kpi value={d.maintainer_shared.length} label="Shared maintainers" note="Maintainers who also control other packages" />
              <div className="app-kpi">
                <div className="app-num">{d.blast_radius_time_ms < 1 ? '<1' : Math.round(d.blast_radius_time_ms)} ms</div>
                <span className="app-label inline-flex items-center gap-1.5">Graph time
                  <InfoPopover label="About graph time" align="right">Measured on the server across the three traversals (dependents, maintainers, look-alikes) and the maintainer PageRank.</InfoPopover>
                </span>
              </div>
            </div>

            <section aria-labelledby="br-graph" className="app-panel p-4 sm:p-5 mb-6">
              <h2 id="br-graph" className="app-h2">Blast radius of {d.package}</h2>
              <p className="app-sub mb-4">Dependency, maintainer and look-alike edges around the package, in one graph.</p>
              <EntityGraph graphContext={graph} label={`Blast radius of ${d.package}`} height={420}
                emptyTitle="No edges around this package" emptyText="The code graph has no DEPENDS_ON, MAINTAINS or TYPOSQUAT_OF edges touching it." />
            </section>

            <section aria-labelledby="br-exposure">
              <h2 id="br-exposure" className="app-h2">Exposure</h2>
              <p className="app-sub mb-3">Everything the graph links to {d.package}, and how.</p>
              <div className="app-table-wrap">
                <table className="data-table">
                  <thead><tr><th scope="col">Package, service or maintainer</th><th scope="col">How it is linked</th></tr></thead>
                  <tbody>
                    {d.squat_of && <tr><td className="app-mono">{d.squat_of}</td><td>Real package that <span className="app-mono">{d.package}</span> imitates</td></tr>}
                    {impersonators.map(s => <tr key={`t${s}`}><td className="app-mono">{s}</td><td>Look-alike of <span className="app-mono">{d.package}</span></td></tr>)}
                    {d.exposed_services.map(s => <tr key={`s${s}`}><td className="app-mono">{s}</td><td>Service that depends on it</td></tr>)}
                    {d.maintainer_shared.map(s => <tr key={`m${s}`}><td className="app-mono">{s}</td><td>Maintainer who also controls other packages</td></tr>)}
                    {!d.squat_of && !impersonators.length && !d.exposed_services.length && !d.maintainer_shared.length && (
                      <tr><td colSpan={2} className="app-meta">No exposure recorded in the graph.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
              {!!d.maintainer_risk?.length && (
                <div className="app-card p-4 mt-4">
                  <h3 className="app-h3">Maintainer reach</h3>
                  <p className="app-meta mb-2">PageRank (over DEPENDS_ON) of everything each maintainer controls: one account takeover reaches all of it.</p>
                  <ul className="space-y-1">
                    {d.maintainer_risk.map(m => <li key={m.name} className="flex justify-between gap-3 text-[13.5px]"><span className="break-all">{m.name}</span><span className="app-mono">{m.score.toFixed(3)}</span></li>)}
                  </ul>
                </div>
              )}
            </section>
          </>
        )
      }}
    </ResourceGate>
  )
}
