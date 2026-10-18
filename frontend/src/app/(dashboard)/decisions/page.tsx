'use client'

import { useEffect, useRef, useState } from 'react'
import { EntityGraph, type GraphContext } from '@/components/EntityGraph'
import { useResource, type Resource } from '@/lib/useResource'
import { describe } from '@/lib/api'
import { stageLabel, verdictOf, VERDICT } from '@/lib/verdict'
import { CopyButton, ResourceGate, StatePanel, VerdictBadge } from '@/components/app/ui'

interface DecisionRow {
  id: string
  ts: number // unix ns
  agent: string
  session: string
  tool: string
  verdict: string
  stage: string
  reason: string
  cut_edges: string[]
  cut_cost: number
  hidden_effect: boolean
}
interface EffectRef { kind: string; name: string; hidden?: boolean }
interface Effects { predicted: EffectRef[]; observed: EffectRef[]; hidden_effect: boolean }
interface WhyAnswer { flips: boolean; edge?: string; cause_decision?: string; sentence: string; method: string }
interface FlowEdge { from: string; from_label?: string; kind: string; to: string; to_label?: string; cap: number; cut: boolean }
interface Digest { observe_mode: boolean; digest: { chain_links: number; chain_broken: number } }

const POLL_MS = 10_000
const fmtCap = (c: number) => (c >= 1_000_000 ? '∞' : String(c))
const when = (ns: number) => new Date(ns / 1e6).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'medium' })
// The cut, in plain words: "terminal" is the edge from the call to its effect.
const cutWords = (e: string) => (e === 'terminal' ? 'the call itself (blocked)' : e.startsWith('arg:') ? `argument “${e.slice(4)}” (removed)` : e)

export default function DecisionsPage() {
  const list = useResource<{ decisions: DecisionRow[] | null }>('/api/v1/vigil/graph/decisions?limit=40', { intervalMs: POLL_MS })
  const digest = useResource<Digest>('/api/v1/vigil/digest?days=7', { intervalMs: 30_000 })
  // The selected row is kept as an object, so it survives refreshes, and a
  // decision that scrolls out of the newest 40 stays open.
  const [sel, setSel] = useState<DecisionRow | null>(null)
  const select = (d: DecisionRow) => setSel(d)

  return (
    <div className="p-4 sm:p-8 max-w-6xl mx-auto animate-fadeIn">
      <h1>Decisions</h1>
      <p>Every call VIGIL blocked, paused or rewrote, read from the graph. Select one to see the path of influence that decided it and the edge the min cut severed.</p>

      <ChainStatus r={digest} />

      <section aria-labelledby="dec-list" className="min-w-0">
        <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 mb-3">
          <h2 id="dec-list" className="app-h2">Stopped and rewritten calls</h2>
          {list.loadedAt && <span className="app-meta">Newest 40 · checked {new Date(list.loadedAt).toLocaleTimeString()} · refreshes every {POLL_MS / 1000} s</span>}
        </div>
        <ResourceGate r={list} loading="Reading decisions from the graph…"
          isEmpty={d => !d.decisions?.length}
          empty={<StatePanel kind="empty" title="No call has been blocked, paused or rewritten yet">Allowed calls are not listed here. When VIGIL stops or rewrites a call, it appears within {POLL_MS / 1000} seconds.</StatePanel>}>
          {d => (
            <div className="app-table-wrap">
              <table className="data-table">
                <caption className="sr-only">Decisions, newest first. Select a row to open its evidence full screen.</caption>
                <thead>
                  <tr><th scope="col">Verdict</th><th scope="col">Tool</th><th scope="col">Why</th><th scope="col">When</th><th scope="col">Agent</th><th scope="col"><span className="sr-only">Open</span></th></tr>
                </thead>
                <tbody>
                  {d.decisions!.map(row => {
                    const v = verdictOf(row.verdict, row.stage)
                    const on = sel?.id === row.id
                    return (
                      <tr key={row.id} className="app-row-button" tabIndex={0} aria-selected={on}
                        onClick={() => select(row)} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); select(row) } }}>
                        <td className="whitespace-nowrap">
                          <span className="inline-flex flex-wrap gap-1"><VerdictBadge v={v} />{row.hidden_effect && <VerdictBadge v="critical" title="The call did something its prediction did not cover" />}</span>
                        </td>
                        <td className="app-mono">{row.tool}</td>
                        <td className="text-[13.5px] min-w-[160px]">{stageLabel(row.stage)}{row.hidden_effect && <span className="block app-meta">and a hidden side effect</span>}</td>
                        <td className="whitespace-nowrap app-meta">{when(row.ts)}</td>
                        <td className="app-mono text-[#5e544b]">{row.agent || '—'}</td>
                        <td className="text-right whitespace-nowrap"><span className="text-[13px] font-semibold text-[#14100d] underline decoration-[#ff6b00] decoration-2 underline-offset-[3px]">Open</span></td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          )}
        </ResourceGate>
      </section>

      {sel && <Detail key={sel.id} d={sel} observe={!!digest.data?.observe_mode} onClose={() => setSel(null)} />}
    </div>
  )
}

function ChainStatus({ r }: { r: Resource<Digest> }) {
  if (r.status === 'loading') return <p className="app-meta mt-4" role="status">Checking the decision chain…</p>
  if (!r.data) return <div className="app-banner app-banner-warn mt-4" role="status"><span>Decision-chain integrity could not be checked: {describe(r.error)}</span></div>
  const { chain_links: links, chain_broken: broken } = r.data.digest
  return (
    <div className="mt-4 space-y-2">
      {broken > 0 ? (
        <div className="app-banner app-banner-error items-center" role="alert">
          <VerdictBadge v="critical" solid />
          <span><strong className="font-semibold">{broken} of {links} links in the decision chain do not match the hash they name.</strong> The recorded history may have been altered; do not rely on it until it is checked.</span>
        </div>
      ) : (
        <p className="app-meta">Decision chain: {links} links checked in the graph, none broken{r.stale ? ` (as of ${r.loadedAt ? new Date(r.loadedAt).toLocaleTimeString() : 'earlier'}; the latest check failed)` : ''}.</p>
      )}
      {r.data.observe_mode && (
        <div className="app-banner app-banner-info" role="status"><span>VIGIL is in observe mode: these verdicts were recorded but not enforced, so the calls ran.</span></div>
      )}
    </div>
  )
}

function Detail({ d, observe, onClose }: { d: DecisionRow; observe: boolean; onClose: () => void }) {
  const id = encodeURIComponent(d.id)
  const flow = useResource<{ edges: FlowEdge[] | null; graph_context: GraphContext }>(`/api/v1/vigil/decisions/${id}/flow`)
  const why = useResource<WhyAnswer>(`/api/v1/vigil/decisions/${id}/why`)
  const effects = useResource<Effects>(`/api/v1/vigil/calls/${id}/effects`)
  const v = verdictOf(d.verdict, d.stage)
  // A native modal dialog: it covers the whole window, traps focus, closes on Escape
  // and gives focus back to the row that opened it.
  const dlg = useRef<HTMLDialogElement>(null)
  const [vh, setVh] = useState(900)
  useEffect(() => {
    const el = dlg.current
    if (el && !el.open) el.showModal()
    const fit = () => setVh(window.innerHeight)
    fit(); window.addEventListener('resize', fit)
    // No close() here: removing the element takes it out of the top layer, and a
    // close() would fire onClose and clear the selection on a re-mount.
    return () => window.removeEventListener('resize', fit)
  }, [])

  return (
    <dialog ref={dlg} onClose={onClose} aria-labelledby="dec-detail"
      className="app-shell fixed inset-0 m-0 h-dvh max-h-none w-screen max-w-none overflow-y-auto bg-[#f7f3ec] p-0 text-[#14100d] backdrop:bg-[#14100d]/50">
      <header className="sticky top-0 z-10 border-b border-[#e6ded2] bg-[#f7f3ec]/95 backdrop-blur px-5 sm:px-10 py-5">
      <div className="flex flex-wrap items-start gap-3 max-w-[1600px] mx-auto">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="dec-detail" className="app-h2 app-mono break-all" style={{ fontSize: 19 }}>{d.tool}</h2>
            <VerdictBadge v={v} solid />
            {d.hidden_effect && <VerdictBadge v="critical" />}
          </div>
          <p className="app-sub mt-1">{stageLabel(d.stage)} · {observe && v !== 'allowed' ? 'Recorded in observe mode, not enforced: the call ran.' : VERDICT[v].meaning}</p>
          <p className="app-meta mt-1">{when(d.ts)} · agent <span className="app-mono">{d.agent || '—'}</span> · session <span className="app-mono">{d.session || '—'}</span></p>
        </div>
        <div className="flex items-center gap-2">
          <CopyButton text={d.id} label="Copy decision ID" />
          <button type="button" className="app-btn app-btn-secondary app-btn-sm" onClick={() => dlg.current?.close()} autoFocus>Close <kbd className="app-meta font-normal">Esc</kbd></button>
        </div>
      </div>
      </header>

      <div className="max-w-[1600px] mx-auto px-5 sm:px-10 py-8 grid grid-cols-1 xl:grid-cols-[minmax(0,1.7fr)_minmax(360px,1fr)] gap-8 items-start">
      <div className="min-w-0">

      <h3 className="app-h3">Path of influence</h3>
      <p className="app-sub mb-3">From the earlier reads that introduced a tainted value, through the argument that carries it, to this call. The red edge is the one FalkorDB&apos;s min cut severed.</p>
      <ResourceGate r={flow} loading="Loading the influence network…" compact
        isEmpty={f => !f.edges?.length}
        empty={<StatePanel kind="empty" compact title="No influence network for this decision">No tainted value reached this call, so no cut was computed. It was decided by {stageLabel(d.stage).toLowerCase()} instead.</StatePanel>}>
        {f => (
          <>
            <EntityGraph graphContext={f.graph_context} label={`Influence network of ${d.tool}`} layout="dag" verdict={v} table={false} height={Math.max(420, vh - 330)} />
            <details className="mt-3">
              <summary className="cursor-pointer app-label w-fit">The network as a table ({f.edges!.length} edges, with capacities)</summary>
              <div className="app-table-wrap mt-2">
                <table className="data-table">
                  <thead><tr><th scope="col">From</th><th scope="col">Edge</th><th scope="col">To</th><th scope="col">Cost to cut</th><th scope="col">Cut</th></tr></thead>
                  <tbody>
                    {[...f.edges!].sort((a, b) => Number(b.cut) - Number(a.cut)).map((e, i) => (
                      <tr key={i}>
                        <td className="app-mono break-all">{e.from}</td>
                        <td className="app-mono">{e.kind}</td>
                        <td className="app-mono break-all">{e.to}</td>
                        <td className="app-mono">{fmtCap(e.cap)}</td>
                        <td>{e.cut ? <strong style={{ color: '#b42318' }}>✂ Cut</strong> : <span className="app-meta">—</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        )}
      </ResourceGate>

      </div>

      <aside className="min-w-0 space-y-8 xl:sticky xl:top-[120px]">
      <div className="rounded-xl border border-[#e6ded2] bg-[#faf7f2] p-4">
        <span className="app-label">Reason recorded with the decision</span>
        <p className="mt-1 text-[15px] leading-[22px]">{d.reason || '—'}</p>
        {d.cut_edges.length > 0 && (
          <p className="mt-2 text-[14px]"><strong className="font-semibold" style={{ color: '#b42318' }}>✂ The min cut severed</strong> {d.cut_edges.map(cutWords).join(', ')} <span className="app-meta">(cost {d.cut_cost})</span></p>
        )}
        <div className="mt-3 pt-3 border-t border-[#e6ded2]">
          <span className="app-label">The one edge that decided it</span>
          {why.status === 'loading' ? <p className="app-meta mt-1" role="status">Replaying the decision without each edge…</p>
            : !why.data ? <p className="app-meta mt-1">{why.error?.kind === 'not_found' ? 'The server has no counterfactual for this decision.' : `No counterfactual could be loaded: ${describe(why.error)}`}</p>
            : (
              <>
                <p className="mt-1 text-[15px] leading-[22px]">{why.data.sentence}</p>
                {why.data.edge && <p className="app-mono mt-1 break-all">{why.data.flips ? 'Without this edge the call would have run: ' : 'Edge examined: '}{why.data.edge}</p>}
                <p className="app-meta mt-1">Method: {why.data.method}{why.data.cause_decision ? <> · earlier decision that allowed it: <span className="app-mono">{why.data.cause_decision}</span></> : null}</p>
              </>
            )}
        </div>
      </div>

      <div>
      <h3 className="app-h3">Shadow execution: predicted and observed effects</h3>
      <p className="app-sub mb-3">What the call was expected to touch, and what it actually touched. An effect nobody predicted is a hidden side effect.</p>
      <ResourceGate r={effects} loading="Loading effects…" compact
        isEmpty={e => !e.predicted?.length && !e.observed?.length}
        empty={<StatePanel kind="empty" compact title="No effects recorded">Nothing was predicted or observed for this call.</StatePanel>}>
        {e => (
          <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-1 gap-3">
            {(['predicted', 'observed'] as const).map(side => (
              <div key={side} className="app-card p-4">
                <h4 className="app-label">{side === 'predicted' ? 'Predicted' : 'Observed'}</h4>
                {!e[side]?.length ? <p className="app-meta mt-1">Nothing reported.</p> : (
                  <ul className="mt-2 space-y-1.5">
                    {e[side].map((x, i) => (
                      <li key={i} className="flex flex-wrap items-center gap-2 text-[13.5px]">
                        <span className="app-mono break-all">{x.kind}: {x.name}</span>
                        {x.hidden && <VerdictBadge v="critical" title="Hidden side effect: nobody predicted it" />}
                        {x.hidden && <span className="app-meta">not predicted</span>}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        )}
      </ResourceGate>
      </div>
      </aside>
      </div>
    </dialog>
  )
}
