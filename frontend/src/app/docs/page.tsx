'use client'

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import '../styles/base.css'
import '../styles/docs.css'
import { VERDICT } from '@/lib/verdict'

const SECTIONS = [
  { id: 'abstract', label: 'Abstract' },
  { id: 'goals', label: 'Design goals' },
  { id: 'architecture', label: 'Architecture' },
  { id: 'pipeline', label: 'Decision pipeline' },
  { id: 'calculus', label: 'Decision calculus' },
  { id: 'inference', label: 'Inference chain' },
  { id: 'verification', label: 'On-call verification' },
  { id: 'audit', label: 'Audit trail' },
  { id: 'quickstart', label: 'Quickstart' },
  { id: 'connect', label: 'Connecting an agent' },
  { id: 'api', label: 'API reference' },
  { id: 'limitations', label: 'Trust & limitations' },
  { id: 'evaluation', label: 'Implementation & evaluation' },
  { id: 'references', label: 'References' },
]

/* ── Charts ─────────────────────────────────────────────────────────────
   Plain inline SVG, no charting library — three data points, no dependency
   is warranted. Colors: brand orange as the single sequential hue for
   ordered/magnitude data; the fixed good/critical status pair (from the
   design system's status palette) for the allow/block distribution, always
   paired with a direct value label rather than relying on hue alone. */

function CostForecastChart() {
  const w = 640, h = 220, pad = { l: 44, r: 16, t: 16, b: 30 }
  const plotW = w - pad.l - pad.r, plotH = h - pad.t - pad.b
  const budget = 2.0, soft = 1.6, hard = 2.0, horizonMin = 5
  const x = (min: number) => pad.l + (min / horizonMin) * plotW
  const y = (cost: number) => pad.t + plotH - (Math.min(cost, budget * 1.08) / (budget * 1.08)) * plotH
  // Illustrative trajectory following forecast.Compute()'s own shape: observed
  // burn rate for the first 2 minutes, then the same rate projected forward —
  // not a live feed, but the identical formula from firewall/forecast.go.
  const observed = [[0, 0.05], [0.5, 0.28], [1, 0.55], [1.5, 0.86], [2, 1.18]]
  const projected = [[2, 1.18], [3, 1.66], [4, 2.05], [5, 2.35]]
  const path = (pts: number[][]) => pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${x(p[0])} ${y(p[1])}`).join(' ')
  const areaPath = `${path(observed)} L ${x(2)} ${y(0)} L ${x(0)} ${y(0)} Z`

  return (
    <div className="docs-chart-card">
      <div className="docs-chart-head">
        <span className="docs-chart-title">Cost trajectory vs. budget</span>
        <span className="docs-chart-src illustrative">illustrative, not measured</span>
      </div>
      <p className="docs-chart-sub">
        Same shape as <code>forecast.Compute()</code>: burn rate measured from the rolling window, projected
        forward. The $2.00 budget is the default session limit in <code>demo/scenes.py</code> (<code>VIGIL_BUDGET_LIMIT</code>); the
        trajectory itself is made up to show the shape.
      </p>
      <svg className="docs-chart-svg" viewBox={`0 0 ${w} ${h}`} role="img" aria-label="Cost trajectory approaching the soft and hard budget limits">
        <title>Illustrative cost trajectory using the real forecast formula</title>
        {/* soft/hard reference lines */}
        <line x1={pad.l} y1={y(hard)} x2={w - pad.r} y2={y(hard)} stroke="#B42318" strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={w - pad.r} y={y(hard) - 6} textAnchor="end" fontSize={12} fill="#B42318">hard limit · $2.00</text>
        <line x1={pad.l} y1={y(soft)} x2={w - pad.r} y2={y(soft)} stroke="#8A5A12" strokeWidth={1.5} strokeDasharray="4 4" />
        <text x={w - pad.r} y={y(soft) - 6} textAnchor="end" fontSize={12} fill="#8A5A12">soft limit · $1.60</text>
        {/* area under observed */}
        <path d={areaPath} fill="var(--color-orange)" opacity={0.12} />
        {/* observed (solid) */}
        <path d={path(observed)} fill="none" stroke="var(--color-orange)" strokeWidth={2.5} strokeLinecap="round" />
        {/* projected (dashed) */}
        <path d={path(projected)} fill="none" stroke="var(--color-orange)" strokeWidth={2.5} strokeDasharray="2 5" strokeLinecap="round" opacity={0.85} />
        <circle cx={x(2)} cy={y(1.18)} r={4} fill="var(--color-orange)" />
        <text x={x(2) + 8} y={y(1.18) - 8} fontSize={12} fill="var(--color-ink)" fontWeight={700}>now</text>
        {/* x axis labels */}
        {[0, 1, 2, 3, 4, 5].map((m) => (
          <text key={m} x={x(m)} y={h - 8} textAnchor="middle" fontSize={12} fill="#6B6158">{m}m</text>
        ))}
      </svg>
      <div className="docs-legend">
        <div className="docs-legend-item"><span className="docs-legend-swatch" style={{ background: 'var(--color-orange)' }} />Observed burn</div>
        <div className="docs-legend-item"><span className="docs-legend-swatch" style={{ background: 'var(--color-orange)', opacity: 0.5 }} />Projected (rate × horizon)</div>
        <div className="docs-legend-item"><span className="docs-legend-swatch" style={{ background: '#8A5A12' }} />Soft limit (0.80×) → reroute recommended</div>
        <div className="docs-legend-item"><span className="docs-legend-swatch" style={{ background: '#B42318' }} />Hard limit (1.0×) → BLOCK</div>
      </div>
    </div>
  )
}

/* Fires a bar chart's width transition once it's actually on screen, rather
   than at mount — a chart three sections down otherwise "finishes" filling
   before anyone scrolls to it. */
function useInViewBars<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [visible, setVisible] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const obs = new IntersectionObserver(([e]) => { if (e.isIntersecting) { setVisible(true); obs.disconnect() } }, { threshold: 0.3 })
    obs.observe(el)
    return () => obs.disconnect()
  }, [])
  return { ref, visible }
}

function TierBarChart() {
  const data = [
    { tier: 'Normal', pct: 82, note: 'no inference — ALLOW on deterministic checks alone', shade: 'rgba(255,107,0,0.18)' },
    { tier: 'Suspicious', pct: 11, note: 'fast classifier consulted', shade: 'rgba(255,107,0,0.42)' },
    { tier: 'Uncertain', pct: 5, note: 'policy reasoner consulted', shade: 'rgba(255,107,0,0.7)' },
    { tier: 'High risk', pct: 2, note: 'reasoner + reviewer, most severe wins', shade: 'var(--color-ink)' },
  ]
  const max = 82
  const { ref, visible } = useInViewBars<HTMLDivElement>()
  return (
    <div className="docs-chart-card">
      <div className="docs-chart-head">
        <span className="docs-chart-title">Calls by escalation tier</span>
        <span className="docs-chart-src illustrative">illustrative, not measured</span>
      </div>
      <p className="docs-chart-sub">
        Made-up percentages to show the idea; they were not measured. The structural point (G1) is that Normal never
        reaches the model. For a measured figure, see the hero above: 0 of 399 decisions needed a model.
      </p>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {data.map((d, i) => (
          <div key={d.tier} style={{ display: 'grid', gridTemplateColumns: '96px 1fr 44px', alignItems: 'center', gap: 10 }}>
            <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.8rem', fontWeight: 600, color: 'var(--color-ink)' }}>{d.tier}</span>
            <div style={{ background: 'rgba(20,16,13,0.05)', borderRadius: 6, height: 18, overflow: 'hidden' }} title={d.note}>
              <div className="docs-bar-fill" style={{
                width: visible ? `${(d.pct / max) * 100}%` : '0%', height: '100%', background: d.shade, borderRadius: 6, transitionDelay: `${i * 0.08}s`,
              }} />
            </div>
            <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-slate)', textAlign: 'right' }}>{d.pct}%<span className="docs-sr"> (example)</span></span>
          </div>
        ))}
      </div>
    </div>
  )
}

// Measured, not live: the benign scenario set from scripts/measure.py,
// copied from docs/measurements.md (run m1792244160, 2026-10-17 13:36 UTC,
// local server and FalkorDB 6.0.2). The verdict colours are the product's
// own (lib/verdict.ts); each bar also carries its label and count.
const BENIGN_RUN = [
  { reply: 'allow', count: 270, v: 'allowed' as const, note: 'ran without a prompt: autonomy earned from a clean history' },
  { reply: 'prompt', count: 120, v: 'allowed' as const, note: 'no objection; Claude Code asked as it normally does' },
  { reply: 'ask', count: 0, v: 'paused' as const, note: 'paused for a person' },
  { reply: 'rewrite', count: 0, v: 'rewritten' as const, note: 'an argument cut out' },
  { reply: 'deny', count: 0, v: 'blocked' as const, note: 'blocked' },
]

function OutcomeChart() {
  const total = BENIGN_RUN.reduce((a, r) => a + r.count, 0)
  const { ref, visible } = useInViewBars<HTMLDivElement>()
  return (
    <div className="docs-chart-card">
      <div className="docs-chart-head">
        <span className="docs-chart-title">Hook replies on {total} ordinary calls</span>
        <span className="docs-chart-src real">measured 2026-10-17, not live</span>
      </div>
      <p className="docs-chart-sub">
        30 sessions × 13 everyday calls (ls, git, reads, an edit, <code>go test</code>, two package installs) sent through the
        PreToolUse hook by <code>scripts/measure.py</code> against a local server. Every reply is recorded, not blocks alone (G5).
        Source: <code>docs/measurements.md</code>.
      </p>
      <div ref={ref} style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        {BENIGN_RUN.map((r, i) => (
          <div key={r.reply} className="docs-outcome-row">
            <span className="docs-outcome-label" style={{ color: VERDICT[r.v].ink }}>{r.reply}<span className="docs-outcome-v">{VERDICT[r.v].label}</span></span>
            <div style={{ background: 'rgba(20,16,13,0.05)', borderRadius: 6, height: 20 }} title={r.note}>
              <div className="docs-bar-fill" style={{ width: visible ? `${(r.count / total) * 100}%` : '0%', height: '100%', background: VERDICT[r.v].mark, borderRadius: 6, transitionDelay: `${i * 0.08}s` }} />
            </div>
            <span style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.8rem', fontWeight: 700, textAlign: 'right' }}>{r.count}</span>
          </div>
        ))}
      </div>
      <p className="docs-chart-sub" style={{ marginTop: 14, marginBottom: 0 }}>
        In the same run all eight attack beats got the verdict they were built for (deny, ask, rewrite, published to the shared threat graph, or flagged), so
        the zeros above are not a firewall that never says no.
      </p>
    </div>
  )
}

function CodeBlock({ children, label }: { children: string; label?: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle')
  const copy = async () => {
    try { await navigator.clipboard.writeText(children.trim()); setState('copied') } catch { setState('failed') }
    setTimeout(() => setState('idle'), 1500)
  }
  return (
    <div className="docs-code">
      {label && <div style={{ fontFamily: 'DM Sans, sans-serif', fontSize: '0.72rem', fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--color-ember)', marginBottom: 10 }}>{label}</div>}
      <button type="button" className="docs-code-copy" onClick={copy} aria-label={state === 'idle' ? `Copy ${label || 'this code'}` : undefined}>
        <span aria-live="polite">{state === 'copied' ? 'Copied' : state === 'failed' ? 'Copy failed' : 'Copy'}</span>
      </button>
      <pre>{children.trim()}</pre>
    </div>
  )
}

/* Reveals a section the moment it enters the viewport — .docs-reveal starts
   invisible/offset in CSS, this only ever adds the class that lifts it into
   place. Unobserving after the first hit keeps this to one pass per section
   rather than re-triggering on every scroll direction change. */
function useRevealOnScroll() {
  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) { e.target.classList.add('in'); obs.unobserve(e.target) }
        })
      },
      { threshold: 0.12, rootMargin: '0px 0px -8% 0px' }
    )
    document.querySelectorAll('.docs-reveal').forEach((el) => obs.observe(el))
    return () => obs.disconnect()
  }, [])
}

export default function DocsPage() {
  const [active, setActive] = useState('abstract')
  const [progress, setProgress] = useState(0)
  useRevealOnScroll()

  useEffect(() => {
    const obs = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => { if (e.isIntersecting) setActive(e.target.id) })
      },
      { rootMargin: '-100px 0px -70% 0px' }
    )
    SECTIONS.forEach((s) => {
      const el = document.getElementById(s.id)
      if (el) obs.observe(el)
    })

    const onScroll = () => {
      const h = document.documentElement
      const scrolled = h.scrollTop / (h.scrollHeight - h.clientHeight || 1)
      setProgress(Math.min(1, Math.max(0, scrolled)))
    }
    window.addEventListener('scroll', onScroll, { passive: true })
    onScroll()
    return () => { obs.disconnect(); window.removeEventListener('scroll', onScroll) }
  }, [])

  const jumpTo = (id: string) => (e: React.MouseEvent) => {
    e.preventDefault()
    const smooth = !matchMedia('(prefers-reduced-motion: reduce)').matches
    document.getElementById(id)?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' })
    history.replaceState(null, '', `#${id}`)
  }

  return (
    <div className="docs">
      <div className="docs-progress" style={{ transform: `scaleX(${progress})` }} />
      {/* ─── Top bar ─── */}
      <nav className="docs-nav">
        <Link href="/" className="docs-nav__brand">
          <span className="docs-nav__word">VIGIL</span>
          <span className="docs-nav__tag">docs</span>
        </Link>
        <div className="docs-nav__links">
          <a href="https://github.com/Aaditya1273/Vigil" target="_blank" rel="noopener noreferrer" className="docs-nav__link">GitHub</a>
          <Link href="/" className="docs-nav__link">Product</Link>
          <Link href="/login" className="docs-nav__cta">Sign in</Link>
        </div>
      </nav>

      {/* ─── Hero ─── */}
      <header className="docs-hero">
        <span className="docs-eyebrow"><span className="docs-eyebrow-dot" />Technical documentation</span>
        <h1>The runtime firewall for <em>autonomous</em> AI agents.</h1>
        <p>
          Vigil intercepts every MCP tool call an agent makes, evaluates it against declared intent, a
          predictive cost forecast, and a behavioral baseline — all deterministic and free — and consults a
          language model only when those checks are genuinely uncertain. This document is the full technical
          account: architecture, decision calculus, verified claims, and what remains unverified.
        </p>
        <div className="docs-hero__ctas">
          <a href="https://github.com/Aaditya1273/Vigil" target="_blank" rel="noopener noreferrer" className="docs-btn docs-btn--solid">View source</a>
          <Link href="/login" className="docs-btn docs-btn--ghost">Open the control plane</Link>
        </div>

        <div className="docs-stats" role="list" aria-label="Measured figures">
          <div className="docs-stat" role="listitem"><b>0.71 ms</b><span>median graph time per decision (398 decisions)</span></div>
          <div className="docs-stat" role="listitem"><b>0 of 390</b><span>ordinary calls blocked</span></div>
          <div className="docs-stat" role="listitem"><b>0 of 399</b><span>decisions that needed a model</span></div>
          <div className="docs-stat" role="listitem"><b>200 of 200</b><span>lookups of made-up names returned nothing</span></div>
        </div>
        <p className="docs-stats-src">
          Measured once, not live: <code>scripts/measure.py</code> on 2026-10-17 against a local server and FalkorDB 6.0.2, no model
          credentials (run m1792244160). Full results and method in <code>docs/measurements.md</code>; rerun the script to reproduce.
        </p>
      </header>

      {/* ─── Body ─── */}
      <div className="docs-body">
        <nav className="docs-toc" aria-label="On this page">
          <div className="docs-toc__label" aria-hidden="true">On this page</div>
          {SECTIONS.map((s) => (
            <a key={s.id} href={`#${s.id}`} onClick={jumpTo(s.id)} className={active === s.id ? 'active' : ''} aria-current={active === s.id ? 'location' : undefined}>{s.label}</a>
          ))}
        </nav>

        <article className="docs-article">
          {/* ── Abstract ── */}
          <section id="abstract" className="docs-reveal">
            <span className="docs-section-num">§0</span>
            <h2>Abstract</h2>
            <div className="docs-abstract">
              <h3>Summary</h3>
              <p>
                Every MCP-connected agent runtime today enforces tool access with a static allowlist: a tool is
                either callable or it is not, with no notion of <em>this</em> call, in <em>this</em> session, given
                what the agent has already done and what it is declared to be for. That is the wrong granularity —
                it cannot distinguish a legitimate <code>read_file</code> from one reading <code>.env</code>, and it
                cannot see a loop, a budget breach, or a call that drifted from the agent&apos;s stated purpose. We
                present Vigil, a runtime firewall that sits on the Model Context Protocol transport itself. Every
                tool call is checked against a declared intent policy, a rolling cost forecast, and a bounded
                behavioral history — deterministic, explainable, and free — before a language model is ever
                consulted, and the model, when it is, may only tighten a decision, never relax one. Decisions
                are recorded to a SHA-256 hash-chained ledger whether they allow or block, because a trail that
                only records refusals proves nothing about what got through. We describe the decision pipeline,
                the cost-forecast and policy-evaluation calculus, the multi-vendor inference failover chain with
                its live-verified and unverified paths stated separately, and the concrete trust assumptions the
                design accepts rather than hides.
              </p>
              <div className="docs-meta">
                <span><b>Protocol</b> Model Context Protocol 2024-11-05</span>
                <span><b>Auth</b> OAuth 2.1 + PKCE (S256), self-hosted AS</span>
                <span><b>Stack</b> Go 1.25 · Next.js 16 · React 19</span>
                <span><b>Status</b> Hackathon submission — Impact Forge Summer 2026</span>
              </div>
            </div>
          </section>

          {/* ── Goals ── */}
          <section id="goals" className="docs-reveal">
            <span className="docs-section-num">§1</span>
            <h2>Design goals and non-goals</h2>
            <p>
              Two commitments shape every stage of the pipeline below, and both are enforced structurally —
              not by convention, not by a comment asking the next contributor to be careful.
            </p>
            <div className="docs-grid">
              <div className="docs-tile"><h4>G1 — Deterministic first</h4><p>Intent, cost, and behavior checks run on every call and never invoke a model. <code>RolesFor(TierNormal)</code> returns an empty slice — the happy path cannot accidentally start calling out to inference.</p></div>
              <div className="docs-tile"><h4>G2 — Model tightens, never loosens</h4><p>The code path that would let a model verdict relax a deterministic BLOCK does not exist. A judge can escalate ALLOW toward PAUSE or BLOCK; it cannot do the reverse.</p></div>
              <div className="docs-tile"><h4>G3 — Fail closed</h4><p>Malformed model output, a validation failure, a timeout, or an unconfigured provider all resolve to the same deterministic fallback path, not a synthesized best guess.</p></div>
              <div className="docs-tile"><h4>G4 — Honest failure</h4><p>The deterministic provider returns <code>ErrNoModel</code> rather than fabricating a verdict. &quot;No credential configured&quot; and &quot;the provider timed out&quot; travel the identical code path.</p></div>
              <div className="docs-tile tinted"><h4>G5 — Audit everything, not just refusals</h4><p>Every decision — ALLOW included — is appended to the hash chain. A ledger that only records blocks cannot demonstrate what actually executed.</p></div>
              <div className="docs-tile"><h4>Non-goal — Execution privacy</h4><p>Vigil governs whether a call proceeds, not what a downstream tool does with the result. It is a decision layer, not a data-loss-prevention scanner.</p></div>
            </div>
            <TierBarChart />
          </section>

          {/* ── Architecture ── */}
          <section id="architecture" className="docs-reveal">
            <span className="docs-section-num">§2</span>
            <h2>System architecture</h2>
            <p>
              The firewall (<code>internal/firewall</code>) is the single choke point every MCP
              tool call passes through. Deterministic checks run first and always; the inference chain is
              consulted only past the escalation gate. Figure 1 shows the full path from agent to dashboard.
            </p>
            <div className="docs-diagram">
              <div className="docs-diagram__label">Figure 1 — request path</div>
              <div className="docs-diagram__row">
                <div className="docs-node">AI Agent<span>Claude, any MCP client</span></div>
                <div className="docs-arrow">→</div>
                <div className="docs-node dark">MCP Server<span>OAuth 2.1 + PKCE</span></div>
                <div className="docs-arrow">→</div>
                <div className="docs-node orange">Vigil Firewall<span>Check()</span></div>
                <div className="docs-arrow">→</div>
                <div className="docs-node">Tool Execution<span>only if allowed</span></div>
              </div>
              <div className="docs-diagram__row" style={{ marginTop: 14 }}>
                <div className="docs-node">Intent Policy</div>
                <div className="docs-node">Cost Forecast</div>
                <div className="docs-node">Behavior Engine</div>
                <div className="docs-arrow">⇢</div>
                <div className="docs-node dark">LLM Chain<span>uncertain only</span></div>
              </div>
              <div className="docs-diagram__row" style={{ marginTop: 14 }}>
                <div className="docs-node">OpenTelemetry<span>OTLP/HTTP</span></div>
                <div className="docs-node">Audit Ledger<span>SHA-256 chain</span></div>
                <div className="docs-node">Live Dashboard<span>WebSocket</span></div>
              </div>
              <p className="docs-diagram__caption">
                The three deterministic checks (Intent, Cost, Behavior) always run and are shown side by side
                because their order within that group does not matter — what matters is that all three complete,
                cheaply, before the escalation gate is even evaluated. The LLM Chain is reached only when the
                tier is Suspicious or higher.
              </p>
            </div>
          </section>

          {/* ── Pipeline ── */}
          <section id="pipeline" className="docs-reveal">
            <span className="docs-section-num">§3</span>
            <h2>Decision pipeline</h2>
            <p>
              <code>Firewall.Check(ctx, Call)</code> in <code>firewall/firewall.go</code> runs the following
              stages in order. A BLOCK at any stage is final — no later stage can lift it.
            </p>
            <div className="docs-pipeline">
              <div className="docs-step"><div className="docs-step__n">1</div><div className="docs-step__body"><b>Intent policy</b><span>Declared allowlist/denylist evaluated deny-wins. A call outside a declared allowlist returns UNCERTAIN, not silent ALLOW — see §4.</span></div></div>
              <div className="docs-step"><div className="docs-step__n">2</div><div className="docs-step__body"><b>Cost forecast</b><span>Projected cost against the session budget, using the rolling burn-rate window — not the lifetime average. Hard-limit breach blocks immediately.</span></div></div>
              <div className="docs-step"><div className="docs-step__n">3</div><div className="docs-step__body"><b>Behavioral engine</b><span>Six governance detectors evaluate the bounded 64-span history plus the pending call. CRITICAL blocks; HIGH escalates the tier.</span></div></div>
              <div className="docs-step orange"><div className="docs-step__n">4</div><div className="docs-step__body"><b>Escalation gate</b><span>Tier Normal + intent ALLOW returns ALLOW immediately with no model call — the structural enforcement of G1.</span></div></div>
              <div className="docs-step orange"><div className="docs-step__n">5</div><div className="docs-step__body"><b>Model judgement</b><span>Only for tier ≥ Suspicious. Walks the roles for that tier through the inference chain (§5), validates the response, retries once on a schema slip.</span></div></div>
              <div className="docs-step"><div className="docs-step__n">6</div><div className="docs-step__body"><b>Commit</b><span>Telemetry span, hash-chain audit append, and the decision pushed to the live dashboard — for every outcome, not just blocks.</span></div></div>
            </div>

            <h3>Sequence for an escalated call</h3>
            <div className="docs-sequence">
              <div className="docs-seq-row"><div className="docs-seq-actor">Agent</div><div className="docs-seq-msg">tools/call → MCP server</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">MCP handler</div><div className="docs-seq-msg">Firewall.Check(ctx, call)</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">policy.Evaluate() → UNCERTAIN</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">forecast.Compute() → within budget</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">gov.EvaluateContext() → no CRITICAL</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">router.RolesFor(Uncertain) → [Reasoner]</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Chain</div><div className="docs-seq-msg">Featherless.Complete(ctx, req) — 10s budget</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">parseJudgment() → validated verdict</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Firewall</div><div className="docs-seq-msg">audit.Append(decision) → hash-chained</div></div>
              <div className="docs-seq-row"><div className="docs-seq-actor">Dashboard</div><div className="docs-seq-msg">WebSocket push → Mission Control</div></div>
            </div>
            <OutcomeChart />
          </section>

          {/* ── Calculus ── */}
          <section id="calculus" className="docs-reveal">
            <span className="docs-section-num">§4</span>
            <h2>Decision calculus</h2>
            <p>
              Two pieces of the pipeline are worth stating precisely, because &quot;how does it actually decide&quot;
              is the question a firewall has to answer honestly. Both are implemented as pure functions
              (<code>firewall/forecast.go</code>, <code>firewall/judge.go</code>) and unit-tested directly against
              their boundary cases — no credential required.
            </p>

            <h3>4.1 Policy evaluation — deny-wins order</h3>
            <p>Evaluated in this fixed order; the first match decides:</p>
            <div className="docs-eq">
              <span className="docs-eq-name">policy.Evaluate(tool, args)</span>
              1. tool ∈ DeniedTools               → BLOCK{'\n'}
              2. category(tool,args) ∈ DeniedResources → BLOCK{'\n'}
              3. ¬NetworkAccess ∧ network-call     → BLOCK{'\n'}
              4. ¬SecretAccess ∧ secret-path       → BLOCK{'\n'}
              5. AllowedTools ≠ ∅ ∧ tool ∉ AllowedTools → UNCERTAIN{'\n'}
              6. else                              → ALLOW
            </div>
            <p>
              Step 5 is the important one: an allowlist miss is not a silent pass, it is an escalation. If no
              judge is configured to adjudicate it, it fails closed to BLOCK rather than defaulting open — an
              <code>allowed_tools</code> list that could be bypassed whenever no model happened to be reachable
              would be advisory, not enforcing.
            </p>

            <h3>4.2 Cost forecast — burn rate and time-to-breach</h3>
            <div className="docs-eq">
              <span className="docs-eq-name">forecast.Compute(now, cost, budget, samples)</span>
              rate = Σ(sample.cost) / (now − samples[0].at)      // rolling window, not lifetime avg{'\n'}
              TTB  = (budget − cost) / rate                       // time to breach, seconds{'\n'}
              projected = cost + rate · min(horizon, TTB · 2){'\n'}
              {'\n'}
              cost ≥ budget · 1.00        → hard_limit{'\n'}
              projected ≥ budget · 0.80   → soft_limit (recommend reroute){'\n'}
              rate ≤ 0                    → stable, TTB = 0{'\n'}
              samples {'<'} 2                 → insufficient_history, never divide
            </div>
            <p>
              The rolling window matters: an idle session that suddenly bursts must show the burst immediately,
              which a lifetime average would smooth away for the first several calls.
            </p>
            <CostForecastChart />

            <h3>4.3 Judge validation</h3>
            <div className="docs-eq">
              <span className="docs-eq-name">judge.parseJudgment(raw []byte)</span>
              DisallowUnknownFields(){'\n'}
              require: risk_score, severity, decision, reasons, intent_violation, confidence{'\n'}
              severity ∈ {'{'}LOW, MEDIUM, HIGH, CRITICAL{'}'}{'\n'}
              decision ∈ {'{'}ALLOW, PAUSE, BLOCK, FALLBACK{'}'}{'\n'}
              0 ≤ risk_score ≤ 100{'\n'}
              0 ≤ confidence ≤ 1{'\n'}
              on failure → retry once with the validation error appended, else ErrNoModel
            </div>
            <p>
              A missing field is not treated as an implicit ALLOW — every field is required, and an unparseable
              or out-of-range response degrades to the deterministic fallback exactly like a timeout would (G3).
            </p>
          </section>

          {/* ── Inference ── */}
          <section id="inference" className="docs-reveal">
            <span className="docs-section-num">§5</span>
            <h2>Inference vendors</h2>
            <p>
              Three vendors ship in the chain, tried in this order (<code>internal/llm/chain.go</code>): Featherless, the
              hackathon&apos;s compute partner, then NVIDIA and Gemini. Each is configured from its own key and skipped
              when it has none, so the chain runs with whichever keys are set. The client (<code>llm/openai_compatible.go</code>) speaks the OpenAI-compatible
              <code>/chat/completions</code> contract, which is a deliberate, load-bearing decision: it is what
              let this exact client be proven against a real endpoint before a Featherless credential existed
              (below), rather than shipping untested.
            </p>
            <table className="docs-table">
              <thead><tr><th>Role</th><th>Model</th><th>Used for</th></tr></thead>
              <tbody>
                <tr><td>FAST_RISK_CLASSIFIER</td><td>moonshotai/Kimi-K3</td><td>First-pass triage on a Suspicious-tier call</td></tr>
                <tr><td>POLICY_REASONER</td><td>moonshotai/Kimi-K3</td><td>Uncertain-tier adjudication, policy compilation</td></tr>
                <tr><td>DEEP_SECURITY_REVIEWER</td><td>zai-org/GLM-5.2</td><td>Final word on a call already judged HIGH/CRITICAL</td></tr>
              </tbody>
            </table>
            <p>
              These are recommended defaults, not hardcoded ones — <code>VIGIL_FEATHERLESS_MODEL_FAST</code> /
              <code>_REASONER</code> / <code>_REVIEWER</code> set them, and an unset role is simply inactive rather
              than falling back to a guessed ID. That restraint is not incidental: a Groq model configured for
              local testing in this exact repository was retired from Groq&apos;s catalogue within the same
              session it was set up, which is precisely the failure mode a hardcoded default invites.
            </p>

            <h3>5.1 How this was tested without a Featherless key</h3>
            <p>
              No Featherless credential is available in this environment — it requires a payment-card-backed
              account. Rather than ship the client untested, it was proven against Groq&apos;s free tier: same
              client code, same request/response handling, same retry and validation logic, a different
              OpenAI-compatible endpoint. Groq is <strong>not</strong> a product vendor — it does not appear in
              <code>llm/chain.go</code>&apos;s vendor table — it exists only in <code>llm/live_test.go</code>, run
              directly against the real Groq API:
            </p>
            <table className="docs-table">
              <thead><tr><th>Claim</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>The OpenAI-compatible client produces real completions</td><td><span className="docs-pill shipped">verified live</span> — real Groq completion, real token counts, real latency</td></tr>
                <tr><td>Retired-model handling</td><td><span className="docs-pill shipped">verified live</span> — this exact test caught a Groq model retiring mid-session and failed loudly rather than silently</td></tr>
                <tr><td>Vendor exhaustion (401/402/403 → retired)</td><td><span className="docs-pill shipped">verified live</span> — confirmed against the real Featherless API with a deliberately invalid key</td></tr>
                <tr><td>A Featherless completion specifically</td><td><span className="docs-pill partial">unverified</span> — no credential available; the code path is identical to the one proven above</td></tr>
              </tbody>
            </table>
            <p>
              Every configured vendor is probed once at startup with the cheapest configured role, so
              <code>live</code> in <code>GET /api/v1/vigil/models</code> is a verified fact rather than a
              restatement of configuration — a typo&apos;d key is caught before the first agent is blocked by it.
              The whole escalation stage is bounded by a 10-second budget
              (<code>VIGIL_JUDGE_BUDGET_SECONDS</code>), independent of the per-attempt timeout: a HighRisk tier
              walking two roles, each retrying once, has no outer bound otherwise — that bound is what keeps a
              slow model from turning into a dropped connection instead of a decision.
            </p>

            <h3>5.2 Getting the most out of one Featherless key</h3>
            <p>
              There is no batching, caching, or clever prompt-compression trick here — the efficiency comes from
              a simpler property: most calls never reach a model at all, and the ones that do reach the
              cheapest model that can answer them.
            </p>
            <div className="docs-grid">
              <div className="docs-tile tinted"><h4>Zero cost on the happy path</h4><p>The escalation gate (§3, step 4) is not a soft preference — <code>RolesFor(TierNormal)</code> returns an empty slice, so a Normal-tier call cannot reach the network layer at all. In the measured run (<code>docs/measurements.md</code>), 0 of 399 decisions would have gone to a model had one been configured.</p></div>
              <div className="docs-tile"><h4>Kimi-K3 does the triage</h4><p>Both FAST_RISK_CLASSIFIER and POLICY_REASONER use the same model — Kimi-K3 handles the Suspicious and Uncertain tiers, which is most of what actually escalates. GLM-5.2 is never called for these.</p></div>
              <div className="docs-tile"><h4>GLM-5.2 is reserved</h4><p>DEEP_SECURITY_REVIEWER only runs on a call the reasoner already flagged HIGH or CRITICAL — the strongest, most expensive model in the pair is spent only where the stakes justify it, not on every escalation.</p></div>
              <div className="docs-tile"><h4>Downward-only fallback</h4><p>If a role&apos;s model is transiently unavailable, <code>fallbackRole()</code> only ever steps to a <em>cheaper</em> role. A reviewer hiccup degrades to the reasoner; a cheap-model hiccup never silently invokes the expensive one.</p></div>
              <div className="docs-tile"><h4>One probe, not one per call</h4><p>The startup probe (above) pays the DNS/TLS handshake once per process, not once per judged call — so the first real judgement doesn&apos;t spend part of its 10s budget on a cold connection.</p></div>
              <div className="docs-tile"><h4>Bounded retries, bounded spend</h4><p>At most 2 retries per attempt, at most one re-prompt on a schema slip, inside a hard 10s ceiling on the whole stage — worst-case cost per call is a small, fixed multiple of one request, never unbounded.</p></div>
            </div>
          </section>

          {/* ── Verification ── */}
          <section id="verification" className="docs-reveal">
            <span className="docs-section-num">§6</span>
            <h2>On-call verification</h2>
            <p>Every check the firewall performs, and the failure mode it closes:</p>
            <table className="docs-table">
              <thead><tr><th>Check</th><th>Closes</th></tr></thead>
              <tbody>
                <tr><td>Intent BLOCK is final</td><td>A later ALLOW-leaning stage relaxing an already-denied call</td></tr>
                <tr><td>RolesFor(TierNormal) = []</td><td>Silent inference on the happy path, and its cost</td></tr>
                <tr><td>Fallback is downward-only</td><td>A cheap model&apos;s transient failure silently invoking the most expensive one</td></tr>
                <tr><td>DisallowUnknownFields + full schema</td><td>A model inventing fields or a partial response reading as an implicit allow</td></tr>
                <tr><td>Judge stage deadline (10s)</td><td>A slow vendor chain exceeding the HTTP write timeout and dropping the connection instead of deciding</td></tr>
                <tr><td>ErrExhausted vs. transient 429</td><td>A brief rate-limit burst permanently retiring a healthy vendor</td></tr>
                <tr><td>Audit append on every outcome</td><td>A ledger of refusals alone, which proves nothing about what got through</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Audit ── */}
          <section id="audit" className="docs-reveal">
            <span className="docs-section-num">§7</span>
            <h2>Tamper-evident audit trail</h2>
            <p>
              Every decision — ALLOW and BLOCK alike — is appended to a SHA-256 hash chain
              (<code>audit/ledger.go</code>), JSONL, append-only, fsynced per event. Each record hashes its
              fields in a fixed explicit order (never <code>json.Marshal</code>, whose field order is an
              implementation detail rather than a guarantee) and chains to the previous record&apos;s hash.
              Verification recomputes the chain from the first record; a reordered, edited, or deleted event
              breaks the chain at the exact index it was tampered.
            </p>
            <CodeBlock label="verify from the CLI (output format)">{`vigil-cli audit verify [session_id]
# PASS — <n> events verified
# FAIL — tampering detected at event <i> (<reason>)`}</CodeBlock>
            <p>
              Or from the dashboard/API: <code>GET /api/v1/vigil/audit/verify?session=...</code>. The report counts every
              event, ALLOW included, per G5. Tamper detection is covered by tests that edit a record and expect the
              chain to break at it (<code>TestTamperedEvent</code>, <code>TestVerifyEventsDetectsATamperedRecord</code> in
              <code>internal/audit/audit_test.go</code>).
            </p>
          </section>

          {/* ── Quickstart ── */}
          <section id="quickstart" className="docs-reveal">
            <span className="docs-section-num">§8</span>
            <h2>Quickstart</h2>
            <p>Everything below runs with zero credentials. Vigil deterministic-only is a supported configuration, not a degraded one.</p>
            <CodeBlock label="clone and build">{`git clone https://github.com/Aaditya1273/Vigil
cd Vigil
go build -o vigil-srv ./cmd/vigil-server
./vigil-srv`}</CodeBlock>
            <CodeBlock label="run the 7-scene live demo">{`./demo/run_demo.sh
# Scene 1 — normal ops:        3 ALLOW, no model consulted
# Scene 2 — suspicious loop:   Infinite Tool Loop detector fires
# Scene 3 — AI judgement:      real verdict if a vendor key is set
# Scene 4 — runtime block:     network + credential access denied
# Scene 5 — predictive cost:   burn rate, projected cost, time-to-breach
# Scene 6 — routing:           model route table, fallback count
# Scene 7 — audit chain:       hash-chain verify, tamper detection`}</CodeBlock>
            <CodeBlock label="enable AI judgement (optional)">{`# .env.local
VIGIL_FEATHERLESS_API_KEY=...
VIGIL_FEATHERLESS_MODEL_FAST=moonshotai/Kimi-K3
VIGIL_FEATHERLESS_MODEL_REASONER=moonshotai/Kimi-K3
VIGIL_FEATHERLESS_MODEL_REVIEWER=zai-org/GLM-5.2`}</CodeBlock>
          </section>

          {/* ── Connect ── */}
          <section id="connect" className="docs-reveal">
            <span className="docs-section-num">§9</span>
            <h2>Connecting an agent</h2>
            <p>
              Vigil is a self-hosted OAuth 2.1 Authorization Server with PKCE (S256) in front of an MCP
              <code>2024-11-05</code> server. Any MCP client — Claude Web, Claude Desktop, Claude Code, Cursor —
              connects the same way: dynamic client registration, an authorize/consent step, then a bearer
              token used on every <code>tools/call</code>.
            </p>
            <div className="docs-diagram">
              <div className="docs-diagram__label">Figure 2 — connection handshake</div>
              <div className="docs-diagram__row">
                <div className="docs-node">Agent<span>DCR + PKCE</span></div>
                <div className="docs-arrow">→</div>
                <div className="docs-node dark">/authorize</div>
                <div className="docs-arrow">→</div>
                <div className="docs-node">Consent</div>
                <div className="docs-arrow">→</div>
                <div className="docs-node dark">/token</div>
                <div className="docs-arrow">→</div>
                <div className="docs-node orange">Bearer token</div>
              </div>
            </div>
            <CodeBlock label="MCP connector URL">{`https://<your-deployment>/api/v1/mcp`}</CodeBlock>
          </section>

          {/* ── API ── */}
          <section id="api" className="docs-reveal">
            <span className="docs-section-num">§10</span>
            <h2>API reference</h2>
            <p>Selected control-plane endpoints, all under <code>/api/v1</code>:</p>
            <table className="docs-table">
              <thead><tr><th>Endpoint</th><th>Purpose</th></tr></thead>
              <tbody>
                <tr><td>GET /vigil/decisions</td><td>Recent firewall decisions for a session</td></tr>
                <tr><td>GET /vigil/models</td><td>Inference chain status — provider, live vendors, configured roles (never a key)</td></tr>
                <tr><td>GET /vigil/forecast</td><td>Current burn rate, projected cost, time-to-breach</td></tr>
                <tr><td>GET /vigil/audit/verify</td><td>Hash-chain verification report</td></tr>
                <tr><td>GET /vigil/governance/rules</td><td>Detectors actually registered — not a hardcoded claim</td></tr>
                <tr><td>POST /vigil/policy/draft</td><td>AI-generated policy draft — inert until confirmed by a human</td></tr>
                <tr><td>POST /vigil/policy/draft/{'{id}'}/confirm</td><td>The only path that activates a policy</td></tr>
                <tr><td>POST /mcp/sessions/{'{id}'}/approve</td><td>Releases a PAUSEd session (operator-token guarded)</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── Limitations ── */}
          <section id="limitations" className="docs-reveal">
            <span className="docs-section-num">§11</span>
            <h2>Trust assumptions and limitations</h2>
            <p>Stated plainly, in decreasing order of weight — the same discipline the rest of this document holds to.</p>
            <ol className="docs-numbered">
              <li><b className="n">1</b><p><strong>Featherless completions are unverified.</strong> The exact client code was proven live against Groq&apos;s free tier (§5.1), and Featherless&apos;s <em>failure</em> path (401 → retired) is verified against the real API — but no Featherless call has returned a completion in this environment. It requires a payment-card-backed key.</p></li>
              <li><b className="n">2</b><p><strong>Only 6 of 9 governance detectors can fire.</strong> TokenExplosion, RepeatedPrompt, and PromptRecursion read fields an MCP tool call does not carry (input/output tokens, prompt text) — Vigil intercepts tool calls, not the agent&apos;s LLM turns. <code>/vigil/governance/rules</code> reports exactly what is registered, not all nine.</p></li>
              <li><b className="n">3</b><p><strong>Agent DNA / replay need ClickHouse.</strong> The standalone binary runs with an in-memory fallback; behavioral baselines and trace replay are unreachable without a configured telemetry store.</p></li>
              <li><b className="n">4</b><p><strong>Control endpoints use one shared operator secret</strong>, not per-user auth — appropriate for &quot;the operator, not the internet&quot;, not for multi-tenant deployment without a real auth layer in front.</p></li>
              <li><b className="n">5</b><p><strong>The audit ledger is a local JSONL file</strong>, not a distributed or externally-anchored log. Tamper-evidence is real (any edit is detectable), but the file itself is only as durable as its disk.</p></li>
              <li><b className="n">6</b><p><strong>MCP has two outcomes: result or error.</strong> PAUSE maps to a blocked session releasable via the approve endpoint; FALLBACK cannot execute a model swap on the agent&apos;s behalf, so it degrades to ALLOW plus a surfaced recommendation rather than a fabricated auto-reroute.</p></li>
              <li><b className="n">7</b><p><strong>Hackathon submission.</strong> Built and verified for Impact Forge Summer 2026; not hardened for production multi-tenant load.</p></li>
            </ol>
          </section>

          {/* ── Evaluation ── */}
          <section id="evaluation" className="docs-reveal">
            <span className="docs-section-num">§12</span>
            <h2>Implementation and evaluation</h2>
            <p>
              <code>go test ./...</code> runs the unit tests without a database; with <code>VIGIL_FALKORDB_URL</code> set,
              the live graph tests run against FalkorDB too. The frontend type-checks with <code>tsc --noEmit</code>. This
              page does not quote a test count, because it would go stale; run the suite to see the current one.
            </p>
            <table className="docs-table">
              <thead><tr><th>Component</th><th>Status</th></tr></thead>
              <tbody>
                <tr><td>Decision pipeline</td><td>Seven demo scenes (<code>demo/run_demo.sh</code>); scene 3 needs a vendor key for a real model verdict</td></tr>
                <tr><td>OpenAI-compatible client</td><td><code>llm/live_test.go</code> runs it against real vendors; it needs keys and skips without them</td></tr>
                <tr><td>Vendor exhaustion handling</td><td>401/402/403 retire a vendor (<code>llm/chain.go</code>, <code>ErrExhausted</code>); a transient 429 does not</td></tr>
                <tr><td>Audit chain</td><td>Tamper tests in <code>internal/audit/audit_test.go</code> catch an edited record at its index</td></tr>
                <tr><td>Measured behaviour</td><td>Latency, model-free decisions, false blocks, abstention and attack beats: <code>docs/measurements.md</code> (2026-10-17)</td></tr>
                <tr><td>Backend verification script</td><td><code>demo/verify.py</code> exercises a running server&apos;s endpoints end to end</td></tr>
              </tbody>
            </table>
          </section>

          {/* ── References ── */}
          <section id="references" className="docs-reveal">
            <span className="docs-section-num">§13</span>
            <h2>References</h2>
            <ol className="docs-numbered">
              <li><b className="n">1</b><p>Model Context Protocol. <em>Specification 2024-11-05.</em> modelcontextprotocol.io</p></li>
              <li><b className="n">2</b><p>IETF. <em>OAuth 2.1 Authorization Framework</em> (draft) and RFC 7636, PKCE.</p></li>
              <li><b className="n">3</b><p>OpenTelemetry. <em>OTLP/HTTP Specification.</em> opentelemetry.io</p></li>
              <li><b className="n">4</b><p>NIST. <em>FIPS 180-4: Secure Hash Standard</em> (SHA-256), for the audit hash chain.</p></li>
              <li><b className="n">5</b><p>Project Vigil. <em>Source, verified claims, and full README.</em> github.com/Aaditya1273/Vigil</p></li>
            </ol>
            <p style={{ marginTop: 24, fontSize: '0.85rem' }}>
              Vigil is hackathon software built for Impact Forge Summer 2026. Measured figures on this page name the
              run they come from and its date; illustrative charts say so; everything else describes the code and
              points at the file it lives in. Nothing on this page is a live statistic.
            </p>
          </section>
        </article>
      </div>

      <footer className="docs-footer">
        © {new Date().getFullYear()} VIGIL — the runtime firewall for autonomous AI agents.
      </footer>
    </div>
  )
}
