'use client'

import { useState } from 'react'
import { Search } from 'lucide-react'
import { EntityGraph, type GraphContext } from '@/components/EntityGraph'
import { useResource } from '@/lib/useResource'
import { Kpi, ResourceGate, StatePanel } from '@/components/app/ui'

interface OntologyResult { query: string; entity_paths: string[]; graph_context: GraphContext }

interface EntityProfile {
  name: string
  aliases: string[]
  alias_paths: string[]
  alias_contexts: string[]
  contradiction_paths: string[]
  entity_types?: string[]
  denied_by?: string[]
  policy_paths: string[]
  contradiction_contexts: string[]
  trust_paths: string[]
  query_time_ms: number
}

// Paths come back as "source --[PREDICATE]--> target".
function splitPath(path: string) {
  const m = path.match(/^(.*?) --\[(.*?)\]--> (.*)$/)
  return m ? { source: m[1], predicate: m[2], target: m[3] } : null
}

// Confidence, when the backend records one, lives in the context sentence of
// the alias edge ("...resolved with confidence 0.97..."), not on the triplet.
function confidenceFor(alias: string, contexts: string[]): number | null {
  const hit = contexts.find(c => c.toLowerCase().includes(alias.toLowerCase()))
  const m = hit?.match(/confidence(?:\s+(?:of|is))?\s+([\d.]+)/i)
  return m ? parseFloat(m[1]) : null
}

// The profile's own edges, drawn as a graph (the endpoint returns paths only).
function pathsToContext(paths: string[]): GraphContext {
  const ent = (name: string) => ({ entity_id: name, name })
  const triplets = paths.map(splitPath).filter(Boolean).map(x => ({ source: ent(x!.source), relation: { canonical_predicate: x!.predicate }, target: ent(x!.target) }))
  return { chunk_relations: [{ triplets }] }
}

function trustScores(paths: string[]) {
  const seen = new Map<string, number>()
  for (const p of paths) {
    const parts = splitPath(p)
    const score = parts ? parseFloat(parts.target) : NaN
    if (parts && !Number.isNaN(score)) seen.set(parts.source, Math.max(seen.get(parts.source) ?? 0, score))
  }
  return Array.from(seen, ([source, score]) => ({ source, score })).sort((a, b) => b.score - a.score)
}

// What each relationship in the identity graph means, in plain words.
const KINDS: { predicate: string; title: string; note: string }[] = [
  { predicate: 'SAME_AS', title: 'Aliases', note: 'Names resolved to one person' },
  { predicate: 'IS_A', title: 'Entity types', note: 'What kind of party each person is' },
  { predicate: 'DENIES', title: 'Policy denials', note: 'What a policy forbids sharing with' },
  { predicate: 'CONTRADICTS', title: 'Contradictions', note: 'Records that disagree' },
]

export default function OntologyPage() {
  const [input, setInput] = useState('')
  const [query, setQuery] = useState('')

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Ontology</h1>
      <p>The identity graph VIGIL checks before data leaves: people joined through their aliases, what kind of party each one is, and the policies that forbid sharing with them.</p>

      <form onSubmit={e => { e.preventDefault(); setQuery(input.trim()) }} className="app-card p-4 sm:p-5 mt-6 mb-6 flex flex-col sm:flex-row sm:items-end gap-3">
        <div className="app-field flex-1">
          <label htmlFor="onto-q">Look up a person or alias</label>
          <div className="relative">
            <Search className="w-4 h-4 text-[#6b6158] absolute left-3 top-1/2 -translate-y-1/2" aria-hidden="true" />
            <input id="onto-q" value={input} onChange={e => setInput(e.target.value)} className="app-input" style={{ paddingLeft: 36 }} placeholder="e.g. Sam or J. Blake" aria-describedby="onto-q-hint" />
          </div>
          <span id="onto-q-hint" className="app-meta">Names are matched as typed. Leave empty to see the whole identity graph.</span>
        </div>
        <div className="flex gap-2">
          <button type="submit" className="app-btn app-btn-primary">Look up</button>
          {query && <button type="button" className="app-btn app-btn-secondary" onClick={() => { setInput(''); setQuery('') }}>Whole graph</button>}
        </div>
      </form>

      {query ? <Profile key={query} name={query} /> : <Overview />}
    </div>
  )
}

function Overview() {
  const r = useResource<OntologyResult>('/api/v1/ontology')
  return (
    <ResourceGate r={r} loading="Reading the identity graph…"
      isEmpty={d => !d.entity_paths?.length}
      empty={<StatePanel kind="empty" title="The identity graph is empty">No aliases, entity types or policies have been recorded in FalkorDB yet. Seeding the demo graph (<code className="app-mono">vigil-cli graph-seed</code>) adds the examples.</StatePanel>}>
      {d => {
        const parsed = d.entity_paths.map(splitPath).filter(Boolean) as NonNullable<ReturnType<typeof splitPath>>[]
        const count = (p: string) => parsed.filter(x => x.predicate === p).length
        const other = parsed.filter(x => !KINDS.some(k => k.predicate === x.predicate))
        return (
          <>
            <section aria-labelledby="onto-graph" className="app-panel p-4 sm:p-5 mb-6">
              <h2 id="onto-graph" className="app-h2">Identity graph</h2>
              <p className="app-sub mb-4">{parsed.length} relationships between {new Set(parsed.flatMap(x => [x.source, x.target])).size} entities, as stored in FalkorDB.</p>
              <EntityGraph graphContext={d.graph_context} label="Identity graph" height={500} table={false} />
            </section>

            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 mb-6">
              {KINDS.map(k => <Kpi key={k.predicate} value={count(k.predicate)} label={k.title} note={k.note} />)}
            </div>

            <section aria-labelledby="onto-list">
              <h2 id="onto-list" className="app-h2">Every relationship, by kind</h2>
              <p className="app-sub mb-3">The same edges as the graph above, as text.</p>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                {[...KINDS.map(k => ({ ...k, rows: parsed.filter(x => x.predicate === k.predicate) })), ...(other.length ? [{ predicate: '*', title: 'Other', note: '', rows: other }] : [])].map(k => (
                  <div key={k.predicate} className="app-card p-4">
                    <h3 className="app-h3">{k.title} <span className="app-meta font-normal">({k.rows.length})</span></h3>
                    {k.rows.length === 0 ? <p className="app-meta mt-2">None recorded.</p> : (
                      <ul className="mt-2 space-y-1.5">
                        {k.rows.map((x, i) => (
                          <li key={i} className="text-[13.5px] leading-5 break-words">
                            <span className="font-medium">{x.source}</span> <span className="app-mono text-[#5e544b]">{x.predicate}</span> <span className="font-medium">{x.target}</span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                ))}
              </div>
            </section>
          </>
        )
      }}
    </ResourceGate>
  )
}

function Profile({ name }: { name: string }) {
  const r = useResource<EntityProfile>(`/api/v1/ontology/entity?name=${encodeURIComponent(name)}`)
  return (
    <ResourceGate r={r} loading={`Looking up “${name}”…`}
      isEmpty={p => !p.aliases.length && !p.policy_paths.length && !(p.entity_types?.length) && !(p.denied_by?.length) && !p.contradiction_contexts.length && !p.trust_paths.length}
      empty={<StatePanel kind="empty" title={`Nothing recorded for “${name}”`}>The identity graph has no aliases, entity type, policy or contradiction for this name. Names are matched as typed, so check the spelling, or look at the whole graph for the names it knows.</StatePanel>}>
      {p => {
        const contradictions = p.contradiction_contexts.filter(c => c.toLowerCase().includes('contradict'))
        const trust = trustScores(p.trust_paths)
        return (
          <section aria-labelledby="onto-profile">
            <div className="app-panel p-4 sm:p-5 mb-4">
              <span className="app-label">Looked up</span>
              <h2 id="onto-profile" className="app-h2 break-words">{p.name}</h2>
              <p className="app-meta mt-1">Answered by the graph in {p.query_time_ms < 1 ? '<1' : Math.round(p.query_time_ms)} ms.</p>
              {!!p.entity_types?.length && <p className="app-sub mt-3">Recorded as: <strong className="text-[#14100d]">{p.entity_types.join(', ')}</strong></p>}
              {!!p.denied_by?.length && <p className="app-sub mt-1">Sharing denied by policy: <strong className="text-[#14100d]">{p.denied_by.join(', ')}</strong></p>}
            </div>

            <div className="app-panel p-4 sm:p-5 mb-4">
              <h3 className="app-h3" style={{ marginBottom: 12 }}>Edges around {p.name}</h3>
              <EntityGraph graphContext={pathsToContext([...p.alias_paths, ...p.policy_paths, ...p.contradiction_paths])} label={`Edges around ${p.name}`} height={340}
                emptyTitle="No edges to draw" emptyText="This name has no alias, type or contradiction edges." />
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-3 mb-4">
              <div className="app-card p-4">
                <h3 className="app-h3">Same person as <span className="app-meta font-normal">({p.aliases.length})</span></h3>
                {p.aliases.length === 0 ? <p className="app-meta mt-2">No aliases resolved.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {p.aliases.map(a => {
                      const conf = confidenceFor(a, p.alias_contexts)
                      return <li key={a} className="flex items-center justify-between gap-2 text-[13.5px]"><span className="break-words">{a}</span>{conf !== null && <span className="app-mono text-[#5e544b]">confidence {conf.toFixed(2)}</span>}</li>
                    })}
                  </ul>
                )}
              </div>
              <div className="app-card p-4">
                <h3 className="app-h3">Contradictory records <span className="app-meta font-normal">({contradictions.length})</span></h3>
                {contradictions.length === 0 ? <p className="app-meta mt-2">None found.</p> : (
                  <ul className="mt-2 space-y-1.5">{contradictions.map((c, i) => <li key={i} className="text-[13.5px] leading-5">{c}</li>)}</ul>
                )}
              </div>
              <div className="app-card p-4">
                <h3 className="app-h3">Source trust</h3>
                {trust.length === 0 ? <p className="app-meta mt-2">No trust scores recorded.</p> : (
                  <ul className="mt-2 space-y-2">
                    {trust.map(({ source, score }) => (
                      <li key={source} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 text-[13px]">
                        <span className="truncate" title={source}>{source}</span>
                        <span className="app-mono">{score.toFixed(2)}</span>
                        <span className="col-span-2 h-1.5 rounded-full bg-[#efe9e0]" aria-hidden="true"><span className="block h-full rounded-full bg-[#ff6b00]" style={{ width: `${Math.max(0, Math.min(1, score)) * 100}%` }} /></span>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>

            {p.policy_paths.length > 0 && (
              <div className="app-card p-4">
                <h3 className="app-h3">Entity type and policy edges</h3>
                <ul className="mt-2 space-y-1">{p.policy_paths.map((x, i) => <li key={i} className="app-mono break-words">{x}</li>)}</ul>
              </div>
            )}
          </section>
        )
      }}
    </ResourceGate>
  )
}
