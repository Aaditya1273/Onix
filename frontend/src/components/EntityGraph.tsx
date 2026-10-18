'use client'

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type MutableRefObject } from 'react'
import dynamic from 'next/dynamic'
import { Maximize2, Minimize2, Scan, ZoomIn, ZoomOut } from 'lucide-react'
import type { ForceGraphMethods, ForceGraphProps } from 'react-force-graph-2d'
import { VERDICT, type Verdict } from '@/lib/verdict'
import { StatePanel } from '@/components/app/ui'

// One renderer for every graph on the Graph memory pages (ontology, blast
// radius, memory timeline, decision flow). The canvas comes from
// react-force-graph-2d; on top of it sits a layer of real buttons, one per node
// and relationship, so keyboard and screen-reader users can reach every part
// of the graph, and a table carries the same relationships as text.

export interface Triplet {
  source: { entity_id: string; name: string; type?: string; namespace?: string }
  relation: { canonical_predicate: string; context?: string }
  target: { entity_id: string; name: string; type?: string; namespace?: string }
}
export interface ChunkRelation { triplets: Triplet[]; combined_context?: string }
export interface GraphContext { chunk_relations?: ChunkRelation[]; query_paths?: unknown[] }

interface GNode { id: string; name: string; type: string; val: number; x?: number; y?: number }
interface GLink { id: string; source: string | GNode; target: string | GNode; label: string; cut: boolean }
type Methods = ForceGraphMethods
type Item = { kind: 'node'; id: string; node: GNode } | { kind: 'link'; id: string; link: GLink }

// react-force-graph-2d touches `window` at module load, so it can only load in
// the browser. The wrapper forwards the ref and spaces nodes far enough apart
// for their labels once the graph exists.
const ForceGraph2D = dynamic(async () => {
  const FG = (await import('react-force-graph-2d')).default
  function Graph({ fgRef, spacing, ...p }: ForceGraphProps & { fgRef: MutableRefObject<Methods | undefined>; spacing: number }) {
    const dag = !!p.dagMode
    useEffect(() => {
      const fg = fgRef.current
      if (!fg) return
      // Short-range repulsion: disconnected components stay near each other
      // instead of drifting to the edges of the canvas.
      fg.d3Force('charge')?.strength(-spacing * (dag ? 4 : 2)).distanceMax(spacing * 3)
      // In a left-to-right DAG the level fixes x; weak links let siblings
      // spread vertically instead of stacking their labels on each other.
      fg.d3Force('link')?.distance(spacing).strength(dag ? 0.08 : 1)
      fg.d3Force('gravity', gravity(dag ? 0 : 0.03, dag ? 0.03 : 0.09))
      fg.d3ReheatSimulation()
    }, [fgRef, spacing, dag])
    return <FG ref={fgRef} {...p} />
  }
  return Graph
}, { ssr: false })

// A gentle pull toward the centre, stronger vertically: disconnected parts of
// the graph stay close and spread along the (wide) box instead of drifting off.
function gravity(sx: number, sy: number) {
  let nodes: { x?: number; y?: number; vx?: number; vy?: number }[] = []
  const force = (alpha: number) => {
    for (const n of nodes) {
      n.vx = (n.vx ?? 0) - (n.x ?? 0) * sx * alpha
      n.vy = (n.vy ?? 0) - (n.y ?? 0) * sy * alpha
    }
  }
  force.initialize = (ns: typeof nodes) => { nodes = ns }
  return force
}

// Same decisive-edge treatment as the Go-served graphs (vigil.css --cut): one
// red, a thick line and a "✂ CUT" label that is always drawn, never hover-only.
const CUT = '#d62d20'
const INK = '#14100d'
const MUTED = '#6b6158'
const CONTEXT_EDGE = 'rgba(143,132,120,0.5)'
const DIM_EDGE = 'rgba(143,132,120,0.22)'
const BG = '#fcfaf6'
const NODE_R = 7
const LABEL_PX = 12 // on-screen size: labels are drawn in screen pixels, so zooming out never shrinks them
const MIN_FIT = 0.6 // fitting never shrinks the graph past this; wider graphs pan instead
const MAX_FIT = 1.8

const TYPE: Record<string, { name: string; color: string }> = {
  PERSON: { name: 'Person', color: '#3d4a52' },
  POLICY: { name: 'Policy', color: '#ff6b00' },
  ENTITYTYPE: { name: 'Entity type', color: '#8f8478' },
  DOCUMENT: { name: 'Document', color: '#6b4f8a' },
  CAPABILITY: { name: 'Capability', color: '#2f6f5e' },
  PACKAGE: { name: 'Package', color: '#3d4a52' },
  SERVICE: { name: 'Service', color: '#6b4f8a' },
  MAINTAINER: { name: 'Maintainer', color: '#2f6f5e' },
  FACT: { name: 'Fact', color: '#5e544b' },
  FLOWSOURCE: { name: 'Source', color: INK },
  FLOWREAD: { name: 'Earlier read', color: '#3d4a52' },
  FLOWVALUE: { name: 'Tainted value', color: '#ff6b00' },
  ARGSLOT: { name: 'Argument', color: '#8f8478' },
  EFFECT: { name: 'Call effect', color: '#5e544b' },
  FLOWSINK: { name: 'Sink', color: INK },
}
const typeOf = (t: string) => TYPE[t] ?? { name: t ? t[0] + t.slice(1).toLowerCase() : 'Entity', color: '#8f8478' }
const endId = (e: string | GNode) => (typeof e === 'string' ? e : e.id)
const clip = (s: string, n = 28) => (s.length > n ? s.slice(0, n - 1) + '…' : s)
// A min-cut edge's label ends in "CUT" (see graph.FlowTriplets).
const isCut = (label: string) => /\bCUT$/.test(label)

function toGraphData(ctx: GraphContext | undefined) {
  const nodes = new Map<string, GNode>()
  const links: GLink[] = []
  const seen = new Set<string>()
  const degree = new Map<string, number>()
  const add = (e: Triplet['source']) => {
    if (!nodes.has(e.entity_id)) nodes.set(e.entity_id, { id: e.entity_id, name: e.name, type: (e.type || '').toUpperCase(), val: 1 })
    degree.set(e.entity_id, (degree.get(e.entity_id) || 0) + 1)
  }
  for (const cr of ctx?.chunk_relations || []) {
    for (const t of cr.triplets || []) {
      const key = `${t.source.entity_id}|${t.relation.canonical_predicate}|${t.target.entity_id}`
      if (seen.has(key)) continue
      seen.add(key)
      add(t.source); add(t.target)
      const label = t.relation.canonical_predicate
      links.push({ id: `l${links.length}`, source: t.source.entity_id, target: t.target.entity_id, label, cut: isCut(label) })
    }
  }
  // Size grows with degree: a hub (a maintainer shared across packages, a
  // person named by many aliases) stands out, which is real signal.
  for (const n of nodes.values()) n.val = 1 + Math.min(5, (degree.get(n.id) || 1) - 1)
  return { nodes: [...nodes.values()], links }
}

// The decisive path: everything upstream of a cut edge and downstream of it.
// In a flow network only what the source reaches carries the taint (an
// untainted argument also points at the effect, but it is context).
function decisivePath(nodes: GNode[], links: GLink[]) {
  const res = { nodes: new Set<string>(), links: new Set<string>() }
  const cuts = links.filter(l => l.cut)
  if (!cuts.length) return res
  const walk = (start: string[], forward: boolean) => {
    const set = new Set(start)
    const queue = [...start]
    while (queue.length) {
      const id = queue.pop()!
      for (const l of links) {
        const [from, to] = forward ? [endId(l.source), endId(l.target)] : [endId(l.target), endId(l.source)]
        if (from === id && !set.has(to)) { set.add(to); queue.push(to) }
      }
    }
    return set
  }
  const up = walk(cuts.map(l => endId(l.source)), false)
  const down = walk(cuts.map(l => endId(l.target)), true)
  const roots = nodes.filter(n => n.type === 'FLOWSOURCE').map(n => n.id)
  const reach = roots.length ? walk(roots, true) : null
  const ok = (id: string) => !reach || reach.has(id)
  for (const l of links) {
    const s = endId(l.source), t = endId(l.target)
    if (l.cut || (ok(s) && ok(t) && ((up.has(s) && up.has(t)) || (down.has(s) && down.has(t))))) {
      res.links.add(l.id); res.nodes.add(s); res.nodes.add(t)
    }
  }
  return res
}

const RM = '(prefers-reduced-motion: reduce)'
function useReducedMotion() {
  return useSyncExternalStore(
    cb => { const m = matchMedia(RM); m.addEventListener('change', cb); return () => m.removeEventListener('change', cb) },
    () => matchMedia(RM).matches,
    () => false,
  )
}

export function EntityGraph({ graphContext, height = 420, label = 'Graph', layout = 'force', verdict, table = true, emptyTitle = 'No relationships to draw', emptyText }: {
  graphContext: GraphContext | undefined
  height?: number
  /** Accessible name of the graph, e.g. "Identity graph". */
  label?: string
  /** 'dag' lays a directed causal network out left to right. */
  layout?: 'force' | 'dag'
  /** Colours the call-effect node of a decision network by its verdict. */
  verdict?: Verdict
  /** Show the built-in relationships table (turn off when the page has a richer one). */
  table?: boolean
  emptyTitle?: string
  emptyText?: React.ReactNode
}) {
  // Polling pages hand over a fresh object with the same content; keying on
  // the content keeps the layout (and the user's zoom) stable across refreshes.
  const key = JSON.stringify(graphContext ?? null)
  const data = useMemo(() => toGraphData(JSON.parse(key) as GraphContext | undefined), [key])
  const decisive = useMemo(() => decisivePath(data.nodes, data.links), [data])
  const byId = useMemo(() => new Map(data.nodes.map(n => [n.id, n])), [data])
  const reduced = useReducedMotion()
  const dur = reduced ? 0 : 400

  const fgRef = useRef<Methods | undefined>(undefined)
  const font = useRef('Inter, system-ui, sans-serif')
  const [size, setSize] = useState({ w: 0, h: 0 })
  const [fs, setFs] = useState(false)
  const [hover, setHover] = useState<string | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [cursor, setCursor] = useState(0)
  const [view, setView] = useState<{ pos: Record<string, { x: number; y: number }>; k: number }>({ pos: {}, k: 1 })
  const [settled, setSettled] = useState(false)
  const fitted = useRef(false)
  const dragged = useRef(false)
  const raf = useRef(0)
  const btns = useRef<(HTMLButtonElement | null)[]>([])
  const dialogRef = useRef<HTMLDialogElement>(null)
  const fsBtn = useRef<HTMLButtonElement>(null)

  // One observer per mounted canvas box (inline or full screen), removed with it.
  const boxRef = useCallback((el: HTMLDivElement | null) => {
    if (!el) return
    font.current = getComputedStyle(el).fontFamily || font.current
    const ro = new ResizeObserver(([e]) => {
      const w = Math.round(e.contentRect.width), h = Math.round(e.contentRect.height)
      setSize(s => (s.w === w && s.h === h ? s : { w, h }))
    })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Screen positions of nodes and relationship midpoints for the button layer.
  const measure = useCallback(() => {
    const fg = fgRef.current
    if (!fg) return
    const pos: Record<string, { x: number; y: number }> = {}
    for (const n of data.nodes) if (n.x != null && n.y != null) pos[n.id] = fg.graph2ScreenCoords(n.x, n.y)
    for (const l of data.links) {
      const s = l.source, t = l.target
      if (typeof s === 'object' && typeof t === 'object' && s.x != null && t.x != null && s.y != null && t.y != null)
        pos[l.id] = fg.graph2ScreenCoords((s.x + t.x) / 2, (s.y + t.y) / 2)
    }
    setView({ pos, k: fg.zoom() })
  }, [data])
  const schedule = useCallback(() => { cancelAnimationFrame(raf.current); raf.current = requestAnimationFrame(measure) }, [measure])
  useEffect(() => () => cancelAnimationFrame(raf.current), [])

  const midpoint = useCallback((id: string) => {
    const n = byId.get(id)
    if (n) return n.x != null && n.y != null ? { x: n.x, y: n.y } : null
    const l = data.links.find(x => x.id === id)
    const s = l?.source, t = l?.target
    if (typeof s !== 'object' || typeof t !== 'object' || s.x == null || t.x == null || s.y == null || t.y == null) return null
    return { x: (s.x + t.x) / 2, y: (s.y + t.y) / 2 }
  }, [byId, data])

  // Fit the graph to its box, but never below a readable scale: a wide graph
  // is centred on its cut and panned rather than shrunk into illegibility.
  const fit = useCallback((ms: number) => {
    const fg = fgRef.current
    if (!fg || !size.w || !data.nodes.length) return
    const b = fg.getGraphBbox()
    if (!b) return
    const pad = 64
    const raw = Math.min((size.w - pad * 2) / Math.max(b.x[1] - b.x[0], 1), (size.h - pad) / Math.max(b.y[1] - b.y[0], 1))
    const k = Math.min(MAX_FIT, Math.max(MIN_FIT, raw))
    let c = { x: (b.x[0] + b.x[1]) / 2, y: (b.y[0] + b.y[1]) / 2 }
    const cut = data.links.find(l => l.cut)
    if (raw < MIN_FIT && cut) c = midpoint(cut.id) ?? c
    // Two animated calls would interrupt each other (one d3 zoom transition),
    // so the scale jumps and only the pan animates.
    fg.zoom(k, 0)
    fg.centerAt(c.x, c.y, ms)
  }, [size, data, midpoint])

  // Refit when the box changes size (window resize, entering or leaving full
  // screen); a fitted view of the wrong box would cut the graph off.
  useEffect(() => { if (fitted.current) fit(0) }, [fit])

  // Every layout run ends fitted to the box, except one the user started by
  // dragging a node: that would yank the view away from what they moved.
  const onEngineStop = () => {
    if (!dragged.current) { fitted.current = true; fit(dur) }
    setSettled(true)
    schedule()
  }

  // Full screen is a modal <dialog>: it sits in the top layer (position fixed,
  // whatever transforms its ancestors carry), traps focus and closes on Escape.
  useEffect(() => {
    const d = dialogRef.current
    if (fs && d && !d.open) d.showModal()
  }, [fs])
  const toggleFs = () => {
    if (fs) dialogRef.current?.close()
    else setFs(true)
  }
  const onDialogClose = () => { setFs(false); fsBtn.current?.focus() }

  // ---- what is lit up -------------------------------------------------------
  const activeId = focusId ?? hover ?? selected
  const nb = useMemo(() => {
    if (!activeId) return null
    const nodes = new Set<string>(), links = new Set<string>()
    for (const l of data.links) {
      const s = endId(l.source), t = endId(l.target)
      if (l.id === activeId || s === activeId || t === activeId) { links.add(l.id); nodes.add(s); nodes.add(t) }
    }
    if (byId.has(activeId)) nodes.add(activeId)
    return { nodes, links }
  }, [activeId, data, byId])

  const items: Item[] = useMemo(() => {
    const nodes = [...data.nodes].sort((a, b) =>
      Number(decisive.nodes.has(b.id)) - Number(decisive.nodes.has(a.id)) || (a.x ?? 0) - (b.x ?? 0))
    const links = [...data.links].sort((a, b) => Number(b.cut) - Number(a.cut))
    return [...nodes.map(n => ({ kind: 'node' as const, id: n.id, node: n })), ...links.map(l => ({ kind: 'link' as const, id: l.id, link: l }))]
    // positions settle once; re-sort when the layout does
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, decisive, settled])

  const nodeName = (id: string) => byId.get(id)?.name ?? id
  const verdictSuffix = (n: GNode) => (verdict && n.type === 'EFFECT' ? ` · ${VERDICT[verdict].label}` : '')
  const describeLink = (l: GLink) => `${nodeName(endId(l.source))} ${l.label.replace(/\s*✂\s*CUT$/, '')} ${nodeName(endId(l.target))}`
  const connections = (id: string) => data.links.filter(l => endId(l.source) === id || endId(l.target) === id)
  const itemName = (it: Item) => {
    if (it.kind === 'link') return `Relationship: ${describeLink(it.link)}${it.link.cut ? '. The min cut severed this edge.' : ''}${decisive.links.has(it.id) && !it.link.cut ? '. On the decisive path.' : ''}`
    const n = it.node, c = connections(n.id).length
    return `${n.name}${verdictSuffix(n)}, ${typeOf(n.type).name}, ${c} ${c === 1 ? 'relationship' : 'relationships'}${decisive.nodes.has(n.id) ? ', on the decisive path' : ''}`
  }

  // ---- canvas drawing ---------------------------------------------------------
  const showAllEdgeLabels = data.links.length <= 40
  const drawNode = (obj: object, ctx: CanvasRenderingContext2D, k: number) => {
    const n = obj as GNode
    if (n.x == null || n.y == null) return
    const r = NODE_R * Math.sqrt(n.val)
    const lit = nb ? nb.nodes.has(n.id) : decisive.nodes.size ? decisive.nodes.has(n.id) : true
    ctx.globalAlpha = lit ? 1 : 0.38
    ctx.beginPath(); ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = verdict && n.type === 'EFFECT' ? VERDICT[verdict].mark : typeOf(n.type).color
    ctx.fill()
    ctx.lineWidth = 1.5 / k; ctx.strokeStyle = '#fff'; ctx.stroke()
    ctx.globalAlpha = 1
    const ring = n.id === selected ? '#ff6b00' : n.id === activeId || (!nb && decisive.nodes.has(n.id)) ? INK : null
    if (ring) { ctx.beginPath(); ctx.arc(n.x, n.y, r + 3 / k, 0, 2 * Math.PI); ctx.lineWidth = (n.id === selected ? 2.5 : 1.5) / k; ctx.strokeStyle = ring; ctx.stroke() }
    const fsz = LABEL_PX / k
    ctx.font = `${n.id === activeId || decisive.nodes.has(n.id) ? 600 : 500} ${fsz}px ${font.current}`
    ctx.textAlign = 'center'; ctx.textBaseline = 'top'; ctx.lineJoin = 'round'
    const text = clip(n.name) + verdictSuffix(n)
    const y = n.y + r + 4 / k
    ctx.lineWidth = 3.5 / k; ctx.strokeStyle = BG; ctx.strokeText(text, n.x, y)
    ctx.fillStyle = lit ? INK : MUTED; ctx.fillText(text, n.x, y)
  }
  const linkColor = (obj: object) => {
    const l = obj as GLink
    if (l.cut) return CUT
    if (nb) return nb.links.has(l.id) ? INK : DIM_EDGE
    if (decisive.links.size) return decisive.links.has(l.id) ? INK : CONTEXT_EDGE
    return '#8f8478'
  }
  const linkWidth = (obj: object) => {
    const l = obj as GLink
    return l.cut ? 3.5 : nb?.links.has(l.id) ? 2.5 : decisive.links.has(l.id) ? 2 : 1.25
  }
  const drawLinkLabel = (obj: object, ctx: CanvasRenderingContext2D, k: number) => {
    const l = obj as GLink
    const s = l.source, t = l.target
    if (typeof s !== 'object' || typeof t !== 'object' || s.x == null || t.x == null || s.y == null || t.y == null) return
    const lit = nb?.links.has(l.id)
    if (!(showAllEdgeLabels || l.cut || lit)) return
    if (nb && !lit && !l.cut) return
    const fsz = (l.cut ? LABEL_PX : LABEL_PX - 1) / k
    ctx.font = `${l.cut || lit ? 600 : 500} ${fsz}px ${font.current}`
    // Sits just above the line, so neither the line nor an end node covers it.
    ctx.textAlign = 'center'; ctx.textBaseline = 'bottom'; ctx.lineJoin = 'round'
    const x = (s.x + t.x) / 2, y = (s.y + t.y) / 2 - 4 / k
    ctx.lineWidth = 4 / k; ctx.strokeStyle = BG; ctx.strokeText(l.label, x, y)
    ctx.fillStyle = l.cut ? CUT : lit ? INK : '#5e544b'; ctx.fillText(l.label, x, y)
  }

  // ---- keyboard layer ---------------------------------------------------------
  const focusItem = (i: number) => {
    const j = (i + items.length) % items.length
    setCursor(j)
    btns.current[j]?.focus()
  }
  const onItemFocus = (e: React.FocusEvent) => {
    const i = btns.current.indexOf(e.target as HTMLButtonElement)
    const it = items[i]
    if (!it) return
    setCursor(i); setFocusId(it.id)
    const p = view.pos[it.id], m = midpoint(it.id)
    if (m && (!p || p.x < 24 || p.y < 24 || p.x > size.w - 24 || p.y > size.h - 24)) fgRef.current?.centerAt(m.x, m.y, dur)
  }
  const onKey = (e: React.KeyboardEvent) => {
    const k = e.key
    const cursor = Math.max(0, btns.current.indexOf(document.activeElement as HTMLButtonElement))
    if (k === 'ArrowRight' || k === 'ArrowDown') { e.preventDefault(); focusItem(cursor + 1) }
    else if (k === 'ArrowLeft' || k === 'ArrowUp') { e.preventDefault(); focusItem(cursor - 1) }
    else if (k === 'Home') { e.preventDefault(); focusItem(0) }
    else if (k === 'End') { e.preventDefault(); focusItem(items.length - 1) }
    else if (k === 'Escape' && selected) { e.stopPropagation(); e.preventDefault(); setSelected(null) }
  }

  if (data.nodes.length === 0) return <StatePanel kind="empty" title={emptyTitle} compact>{emptyText}</StatePanel>

  const zoomBy = (f: number) => { const fg = fgRef.current; if (fg) fg.zoom(fg.zoom() * f, dur) }
  const types = [...new Set(data.nodes.map(n => n.type))]
  const hasCut = data.links.some(l => l.cut)

  const toolbar = (inDialog: boolean) => (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
      <ul className="flex flex-wrap items-center gap-x-3 gap-y-1 app-meta mr-auto" aria-label="Legend">
        {types.map(t => (
          <li key={t} className="inline-flex items-center gap-1.5">
            <span aria-hidden="true" className="w-2.5 h-2.5 rounded-full ring-1 ring-white" style={{ background: verdict && t === 'EFFECT' ? VERDICT[verdict].mark : typeOf(t).color }} />
            {typeOf(t).name}{verdict && t === 'EFFECT' ? ` (${VERDICT[verdict].label.toLowerCase()})` : ''}
          </li>
        ))}
        {hasCut && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-5 h-[3px] rounded" style={{ background: CUT }} /><span>✂ CUT: the edge the min cut severed</span></li>}
        {decisive.links.size > 1 && <li className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-5 h-[2px] rounded" style={{ background: INK }} />Decisive path</li>}
      </ul>
      <div className="flex items-center gap-1.5">
        <button type="button" className="app-btn app-btn-secondary app-btn-sm" onClick={() => zoomBy(1.4)} aria-label="Zoom in"><ZoomIn className="w-4 h-4" aria-hidden="true" /></button>
        <button type="button" className="app-btn app-btn-secondary app-btn-sm" onClick={() => zoomBy(1 / 1.4)} aria-label="Zoom out"><ZoomOut className="w-4 h-4" aria-hidden="true" /></button>
        <button type="button" className="app-btn app-btn-secondary app-btn-sm" onClick={() => fit(dur)} aria-label="Fit graph to view"><Scan className="w-4 h-4" aria-hidden="true" /></button>
        <button type="button" ref={inDialog ? undefined : fsBtn} className="app-btn app-btn-secondary app-btn-sm" onClick={toggleFs}>
          {fs ? <Minimize2 className="w-4 h-4" aria-hidden="true" /> : <Maximize2 className="w-4 h-4" aria-hidden="true" />}
          {fs ? 'Exit full screen' : 'Full screen'}
        </button>
      </div>
    </div>
  )

  const canvas = (grow: boolean) => (
    <div ref={boxRef} className={`relative overflow-hidden rounded-xl border border-[#e6ded2] ${grow ? 'flex-1 min-h-0' : ''}`}
      style={{ height: grow ? undefined : height, background: BG, visibility: reduced && !settled ? 'hidden' : undefined }}>
      {size.w > 0 && size.h > 0 && (
        <ForceGraph2D
          fgRef={fgRef}
          spacing={layout === 'dag' ? 95 : 110}
          graphData={data}
          width={size.w}
          height={size.h}
          backgroundColor={BG}
          dagMode={layout === 'dag' ? 'lr' : undefined}
          dagLevelDistance={layout === 'dag' ? 190 : undefined}
          onDagError={() => { /* a cycle: fall back to the force layout's positions */ }}
          nodeRelSize={NODE_R}
          nodeVal={(n: object) => (n as GNode).val}
          nodeLabel={() => ''}
          linkLabel={() => ''}
          nodeCanvasObjectMode={() => 'replace'}
          nodeCanvasObject={drawNode}
          linkColor={linkColor}
          linkWidth={linkWidth}
          linkDirectionalArrowLength={6}
          linkDirectionalArrowRelPos={1}
          linkDirectionalArrowColor={linkColor}
          linkCanvasObjectMode={() => 'after'}
          linkCanvasObject={drawLinkLabel}
          minZoom={0.25}
          maxZoom={6}
          cooldownTicks={reduced ? 60 : 140}
          onEngineStop={onEngineStop}
          onZoom={schedule}
          onNodeDragEnd={() => { dragged.current = true; schedule() }}
          onNodeHover={(n: object | null) => setHover(n ? (n as GNode).id : null)}
          onLinkHover={(l: object | null) => setHover(l ? (l as GLink).id : null)}
          onNodeClick={(n: object) => setSelected(s => (s === (n as GNode).id ? null : (n as GNode).id))}
          onLinkClick={(l: object) => setSelected(s => (s === (l as GLink).id ? null : (l as GLink).id))}
          onBackgroundClick={() => setSelected(null)}
        />
      )}
      <div role="group" aria-label={`${label}: ${data.nodes.length} nodes, ${data.links.length} relationships. Arrow keys move between them, Enter pins one.`}
        className="absolute inset-0 pointer-events-none" onKeyDown={onKey} onFocus={onItemFocus}
        onBlur={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setFocusId(null) }}>
        {items.map((it, i) => {
          const p = view.pos[it.id] ?? { x: size.w / 2, y: size.h / 2 }
          const d = it.kind === 'node' ? Math.max(24, 2 * NODE_R * Math.sqrt(it.node.val) * view.k + 8) : 22
          return (
            <button key={it.id} type="button" ref={el => { btns.current[i] = el }} tabIndex={i === cursor ? 0 : -1}
              aria-label={itemName(it)} aria-pressed={selected === it.id}
              onClick={() => setSelected(s => (s === it.id ? null : it.id))}
              className="absolute rounded-full bg-transparent"
              style={{ left: p.x - d / 2, top: p.y - d / 2, width: d, height: d }} />
          )
        })}
      </div>
    </div>
  )

  const shown = activeId
  const detail = (
    <div className="min-h-[100px] rounded-lg bg-[#faf7f2] border border-[#efe9e0] px-3 py-2 text-[13.5px] leading-5 text-[#5e544b]">
      {shown && byId.has(shown) ? (() => {
        const n = byId.get(shown)!
        const c = connections(n.id)
        return (
          <div className="flex flex-wrap items-baseline gap-x-2">
            <strong className="text-[#14100d] font-semibold break-all">{n.name}</strong>
            <span>{typeOf(n.type).name}{verdictSuffix(n)}</span>
            <span className="app-meta">· {c.length} {c.length === 1 ? 'relationship' : 'relationships'}{decisive.nodes.has(n.id) ? ' · on the decisive path' : ''}</span>
            <ul className="basis-full mt-1 space-y-0.5 app-mono text-[#14100d]">
              {c.slice(0, 3).map(l => <li key={l.id} className="break-all">{l.cut && <span className="font-semibold" style={{ color: CUT }}>✂ </span>}{describeLink(l)}</li>)}
              {c.length > 3 && <li className="app-meta">and {c.length - 3} more</li>}
            </ul>
          </div>
        )
      })() : shown ? (() => {
        const l = data.links.find(x => x.id === shown)
        if (!l) return null
        return (
          <p><span className="app-mono text-[#14100d] break-all">{nodeName(endId(l.source))} —{l.label}→ {nodeName(endId(l.target))}</span>
            {l.cut && <span className="block mt-0.5 font-medium" style={{ color: '#b42318' }}>The min cut severed this edge: removing it is what decided the call.</span>}</p>
        )
      })() : (
        <p>Hover or tap a node to see its relationships. Tab into the graph, then use the arrow keys to step through every node and relationship. Scroll or pinch to zoom, drag to pan.</p>
      )}
      {selected && <button type="button" className="app-btn app-btn-ghost app-btn-sm mt-1 -ml-2" onClick={() => setSelected(null)}>Clear selection</button>}
    </div>
  )

  return (
    <figure className="m-0 flex flex-col gap-3" aria-label={label}>
      {toolbar(false)}
      {fs ? (
        <div className="grid place-items-center rounded-xl border border-dashed border-[#e6ded2] app-meta" style={{ height: Math.min(height, 160) }}>The graph is open in full screen.</div>
      ) : canvas(false)}
      {!fs && detail}
      {fs && (
        <dialog ref={dialogRef} onClose={onDialogClose} aria-label={`${label}, full screen`}
          className="fixed inset-4 m-0 w-auto h-auto max-w-none max-h-none rounded-2xl border border-[#e6ded2] bg-white p-4 text-[#14100d] open:flex flex-col gap-3 backdrop:bg-[#14100d]/45">
          {toolbar(true)}
          {canvas(true)}
          {detail}
        </dialog>
      )}
      {table && (
        <details className="group">
          <summary className="cursor-pointer app-label w-fit">Relationships as a table ({data.links.length})</summary>
          <div className="app-table-wrap mt-2">
            <table className="data-table">
              <thead><tr><th scope="col">From</th><th scope="col">Relationship</th><th scope="col">To</th></tr></thead>
              <tbody>
                {[...data.links].sort((a, b) => Number(b.cut) - Number(a.cut)).map(l => {
                  const s = byId.get(endId(l.source)), t = byId.get(endId(l.target))
                  return (
                    <tr key={l.id}>
                      <td><span className="app-mono break-all">{s?.name}</span> <span className="app-meta">{s && typeOf(s.type).name}</span></td>
                      <td className="app-mono">{l.cut ? <strong style={{ color: '#b42318' }}>{l.label}</strong> : l.label}</td>
                      <td><span className="app-mono break-all">{t?.name}</span> <span className="app-meta">{t && typeOf(t.type).name}</span></td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </details>
      )}
    </figure>
  )
}
