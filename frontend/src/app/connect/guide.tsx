'use client'

import Link from 'next/link'
import { ArrowLeft, Plug, Terminal, ShieldCheck, Github } from 'lucide-react'
import '@/app/(dashboard)/app.css'
import { CopyButton } from '@/components/app/ui'

// The hosted MCP endpoint and the one Claude Code command, written out exactly
// as everywhere else in the product.
const MCP_URL = 'https://vigil-server.onrender.com/api/v1/mcp'
const CLAUDE_CODE_CMD = 'claude mcp add --transport sse vigil https://vigil-server.onrender.com/api/v1/mcp'

function CopyLine({ text, label }: { text: string; label: string }) {
  return (
    <div className="flex items-stretch gap-2 mt-3 min-w-0">
      <code className="app-mono flex-1 min-w-0 rounded-lg border border-[#E6DED2] bg-[#FAF7F2] px-3 py-2.5 text-[13px] text-[#14100D] overflow-x-auto whitespace-nowrap">{text}</code>
      <CopyButton text={text} label={label} className="self-center" />
    </div>
  )
}

function Way({ n, icon: Icon, title, best, children }: { n: number; icon: React.ElementType; title: string; best?: boolean; children: React.ReactNode }) {
  return (
    <section className={`app-card p-5 sm:p-6 ${best ? 'border-[#FF6B00]' : ''}`} aria-labelledby={`way-${n}`}>
      <div className="flex items-center gap-3 flex-wrap">
        <span className="grid place-items-center w-9 h-9 rounded-lg bg-[#14100D] text-white" aria-hidden="true"><Icon className="w-[18px] h-[18px]" /></span>
        <h2 id={`way-${n}`} className="app-h2">{n}. {title}</h2>
        {best && <span className="sm:ml-auto text-[12.5px] font-semibold text-[#14100D] bg-[#FF6B00] rounded-md px-2 py-0.5">Quickest</span>}
      </div>
      <div className="mt-3 text-[15px] leading-[23px] text-[#5E544B]">{children}</div>
    </section>
  )
}

export function ConnectGuide() {
  return (
    <main className="app-shell min-h-screen bg-[#F5F1EA] text-[#14100D]">
      <div className="mx-auto max-w-3xl px-4 sm:px-6 py-8 sm:py-10">
        <Link href="/decisions" className="inline-flex items-center gap-1.5 text-sm text-[#5E544B] hover:text-[#14100D]"><ArrowLeft className="w-4 h-4" aria-hidden="true" />Back to the dashboard</Link>

        <p className="mt-8 flex items-center gap-2 text-[#14100D] text-sm font-semibold"><Plug className="w-5 h-5 text-[#FF6B00]" aria-hidden="true" />Connect an agent</p>
        <h1 className="mt-2 font-[Epilogue,sans-serif] text-[28px] leading-[36px] sm:text-[34px] sm:leading-[40px] font-bold tracking-[-0.03em]">Put VIGIL in front of your agent</h1>
        <p className="mt-3 text-[15px] leading-[23px] text-[#5E544B] max-w-2xl">
          Once connected, every tool call your agent makes is decided by VIGIL against the graph before it runs, and the
          decisions appear in the dashboard.
        </p>

        <div className="mt-8 space-y-4">
          <Way n={1} icon={Plug} title="Claude (claude.ai or Claude Desktop)" best>
            In Claude, open <b className="text-[#14100D]">Settings → Connectors → Add custom connector</b> and paste this URL.
            Claude sends you to VIGIL to approve the connection and set a spending budget, then returns you to the chat.
            <CopyLine text={MCP_URL} label="Copy the MCP URL" />
          </Way>

          <Way n={2} icon={Terminal} title="Claude Code">
            Add VIGIL as an MCP server from your terminal, then run <code className="app-mono text-[#14100D]">/mcp</code> inside
            Claude Code to sign in.
            <CopyLine text={CLAUDE_CODE_CMD} label="Copy the Claude Code command" />
          </Way>

          <Way n={3} icon={ShieldCheck} title="Every Claude Code tool call, on your machine">
            VIGIL&apos;s <code className="app-mono text-[#14100D]">PreToolUse</code> hook judges each call before Claude Code runs it,
            against your own FalkorDB. It runs with Docker; the setup guide has the steps.
            <a href="https://github.com/Aaditya1273/Onix#11-setup-with-docker-compose"
              className="app-btn mt-4 w-fit bg-[#14100D] text-white hover:bg-black">
              <Github className="w-4 h-4" aria-hidden="true" />Setup guide on GitHub
            </a>
          </Way>
        </div>

        <p className="mt-8 text-sm leading-[21px] text-[#5E544B]">
          Just looking? You don&apos;t need to connect anything: the <Link href="/decisions" className="font-medium underline decoration-[#ff6b00] decoration-2 underline-offset-2 text-[#14100d]">dashboard</Link> shows
          the decisions VIGIL has recorded, and the <Link href="/playground" className="font-medium underline decoration-[#ff6b00] decoration-2 underline-offset-2 text-[#14100d]">playground</Link> lets you attack VIGIL directly.
        </p>
      </div>
    </main>
  )
}
