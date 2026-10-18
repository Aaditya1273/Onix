'use client'

import Link from 'next/link'
import { useState } from 'react'
import { ArrowLeft, Check, Copy, Plug, Terminal, ShieldCheck, Github } from 'lucide-react'

const BACKEND = (process.env.NEXT_PUBLIC_VIGIL_BACKEND_URL || 'https://vigil-server.onrender.com').replace(/\/$/, '')
const MCP_URL = `${BACKEND}/api/v1/mcp`

function CopyLine({ text, label }: { text: string; label: string }) {
  const [done, setDone] = useState(false)
  const copy = async () => {
    try { await navigator.clipboard.writeText(text); setDone(true); setTimeout(() => setDone(false), 1500) } catch { /* clipboard blocked */ }
  }
  return (
    <div className="flex items-stretch gap-2 mt-3">
      <code className="flex-1 min-w-0 rounded-lg border border-gray-200 bg-[#faf8f5] px-3 py-2.5 font-mono text-[13px] text-gray-900 overflow-x-auto whitespace-nowrap">{text}</code>
      <button type="button" onClick={copy} aria-label={`Copy ${label}`}
        className="shrink-0 inline-flex items-center gap-1.5 rounded-lg border border-gray-200 bg-white px-3 text-sm font-medium text-gray-700 hover:border-gray-900 hover:text-gray-900 transition-colors">
        {done ? <Check className="w-4 h-4 text-green-600" /> : <Copy className="w-4 h-4" />}{done ? 'Copied' : 'Copy'}
      </button>
    </div>
  )
}

function Way({ n, icon: Icon, title, best, children }: { n: number; icon: React.ElementType; title: string; best?: boolean; children: React.ReactNode }) {
  return (
    <section className={`rounded-2xl border bg-white p-6 ${best ? 'border-orange-300 ring-1 ring-orange-200' : 'border-gray-200'}`}>
      <div className="flex items-center gap-3">
        <span className="grid place-items-center w-9 h-9 rounded-xl bg-gray-900 text-white"><Icon className="w-[18px] h-[18px]" /></span>
        <h2 className="font-display text-lg font-bold text-gray-900" style={{ letterSpacing: '-0.02em' }}>{n}. {title}</h2>
        {best && <span className="ml-auto text-xs font-semibold text-orange-700 bg-orange-50 border border-orange-200 rounded-full px-2.5 py-1">Quickest</span>}
      </div>
      <div className="mt-3 text-[15px] leading-relaxed text-gray-600">{children}</div>
    </section>
  )
}

export function ConnectGuide() {
  return (
    <main className="min-h-screen" style={{ background: 'var(--paper, #f5f1ea)' }}>
      <div className="mx-auto max-w-3xl px-6 py-10">
        <Link href="/decisions" className="inline-flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-900"><ArrowLeft className="w-4 h-4" />Back to the dashboard</Link>

        <div className="mt-8 flex items-center gap-2 text-orange-600"><Plug className="w-5 h-5" /><span className="text-sm font-semibold">Connect an agent</span></div>
        <h1 className="mt-2 font-display text-4xl font-bold text-gray-900" style={{ letterSpacing: '-0.03em' }}>Put VIGIL in front of your agent</h1>
        <p className="mt-3 text-lg text-gray-600 max-w-2xl">
          Once connected, every tool call your agent makes is decided by VIGIL against the graph before it runs.
          Mission Control, Agent DNA and Incidents fill with your agent&apos;s live traffic.
        </p>

        <div className="mt-8 space-y-4">
          <Way n={1} icon={Plug} title="Claude (claude.ai or Claude Desktop)" best>
            In Claude, open <b className="text-gray-900">Settings → Connectors → Add custom connector</b> and paste this URL.
            Claude sends you to VIGIL to approve the connection and choose a spending budget, then returns you to the chat.
            <CopyLine text={MCP_URL} label="the MCP URL" />
          </Way>

          <Way n={2} icon={Terminal} title="Claude Code">
            Add VIGIL as an MCP server from your terminal, then run <code className="font-mono text-[13px] text-gray-900">/mcp</code> inside
            Claude Code to sign in.
            <CopyLine text={`claude mcp add --transport sse vigil ${MCP_URL}`} label="the Claude Code command" />
          </Way>

          <Way n={3} icon={ShieldCheck} title="Every Claude Code tool call, on your machine">
            The strongest setup: VIGIL&apos;s <code className="font-mono text-[13px] text-gray-900">PreToolUse</code> hook judges each call
            before Claude Code runs it, with your own FalkorDB. It takes about five minutes with Docker.
            <a href="https://github.com/Aaditya1273/Onix#11-setup-with-docker-compose"
              className="mt-4 flex w-fit items-center gap-2 rounded-lg bg-gray-900 px-4 py-2.5 text-sm font-semibold text-white hover:bg-black transition-colors">
              <Github className="w-4 h-4" />Setup guide on GitHub
            </a>
          </Way>
        </div>

        <p className="mt-8 text-sm text-gray-500">
          Just looking? You don&apos;t need to connect anything: the <Link href="/decisions" className="font-medium text-orange-700 hover:underline">dashboard</Link> already
          shows real decisions, and the <Link href="/playground" className="font-medium text-orange-700 hover:underline">playground</Link> lets you attack VIGIL directly.
        </p>
      </div>
    </main>
  )
}
