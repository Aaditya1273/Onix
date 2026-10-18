'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import {
  LayoutDashboard, Activity, BarChart3, AlertTriangle, Shield, FileCheck, Zap, Cpu, Settings, HelpCircle,
  Network, GitBranch, History, ShieldCheck, Scissors, Gauge, Sparkles, Clock, FlaskConical, LogOut,
  ChevronDown, ArrowUpRight, Plug, Brain, Radio, Landmark, Sigma,
} from 'lucide-react'

type Item = { label: string; href: string; icon: React.ElementType; external?: boolean }

// What VIGIL decides and why: always in view.
const primary: Item[] = [
  { label: 'Evidence',    href: '/evidence',           icon: Sigma },
  { label: 'Decisions',   href: '/decisions',          icon: Scissors },
  { label: 'Playground',  href: '/playground',         icon: FlaskConical },
  { label: 'Autonomy',    href: '/autonomy',           icon: ShieldCheck },
  { label: 'Risk',        href: '/risk',               icon: Gauge },
  // Served by the Go server itself (internal/web), proxied through /web/*.
  { label: 'Time Travel', href: '/web/timeline.html',  icon: Clock, external: true },
  { label: 'Reveal',      href: '/web/reveal.html',    icon: Sparkles, external: true },
]

// Everything else, grouped and folded.
const groups: { id: string; label: string; icon: React.ElementType; items: Item[] }[] = [
  { id: 'graph', label: 'Graph memory', icon: Brain, items: [
    { label: 'Ontology',        href: '/ontology',        icon: Network },
    { label: 'Blast Radius',    href: '/blast-radius',    icon: GitBranch },
    { label: 'Memory Timeline', href: '/memory-timeline', icon: History },
  ] },
  { id: 'runtime', label: 'Runtime', icon: Radio, items: [
    { label: 'Mission Control', href: '/mission-control', icon: Activity },
    { label: 'Cost Firewall',   href: '/cost-firewall',   icon: LayoutDashboard },
    { label: 'Agent DNA',       href: '/agent-dna',       icon: BarChart3 },
    { label: 'Incidents',       href: '/incidents',       icon: AlertTriangle },
  ] },
  { id: 'govern', label: 'Governance', icon: Landmark, items: [
    { label: 'Policies',     href: '/policies',   icon: Shield },
    { label: 'Governance',   href: '/governance', icon: FileCheck },
    { label: 'Model Router', href: '/models',     icon: Cpu },
    { label: 'Plugins',      href: '/plugins',    icon: Zap },
  ] },
]

const footer: Item[] = [
  { label: 'Connect an agent', href: '/connect',  icon: Plug },
  { label: 'Settings',         href: '/settings', icon: Settings },
  { label: 'Help',             href: 'https://github.com/Aaditya1273/Onix', icon: HelpCircle, external: true },
]

const OPEN_KEY = 'vigil-sidebar-open'

function NavItem({ item, active, nested }: { item: Item; active: boolean; nested?: boolean }) {
  const { label, href, icon: Icon, external } = item
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-current={active ? 'page' : undefined}
      className={`group relative flex items-center gap-3 rounded-lg text-[13.5px] font-medium transition-colors duration-150
        ${nested ? 'pl-9 pr-3 py-1.5' : 'px-3 py-2'}
        ${active ? 'bg-white text-gray-900 shadow-[0_1px_2px_rgba(20,16,13,0.06)] ring-1 ring-gray-200' : 'text-gray-600 hover:text-gray-900 hover:bg-black/[0.04]'}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500`}
    >
      {active && <span className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full bg-orange-600" aria-hidden="true" />}
      <Icon className={`w-[17px] h-[17px] shrink-0 ${active ? 'text-orange-600' : 'text-gray-400 group-hover:text-gray-600'}`} strokeWidth={active ? 2.4 : 2} />
      <span className="truncate">{label}</span>
      {external && <ArrowUpRight className="ml-auto w-3.5 h-3.5 text-gray-300 group-hover:text-gray-500" aria-label="opens in a new tab" />}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isActive = (i: Item) => !i.external && pathname === i.href
  const [open, setOpen] = useState<Record<string, boolean>>({})

  // A group opens on its own when you are on one of its pages; otherwise it
  // stays as you left it.
  useEffect(() => {
    let saved: Record<string, boolean> = {}
    try { saved = JSON.parse(localStorage.getItem(OPEN_KEY) || '{}') } catch { /* private mode */ }
    groups.forEach(g => { if (g.items.some(isActive)) saved[g.id] = true })
    setOpen(saved)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname])

  const toggle = (id: string) => setOpen(o => {
    const n = { ...o, [id]: !o[id] }
    try { localStorage.setItem(OPEN_KEY, JSON.stringify(n)) } catch { /* private mode */ }
    return n
  })

  return (
    <aside className="w-60 border-r border-gray-200/80 flex flex-col h-full shrink-0 select-none" style={{ background: 'var(--paper)' }}>
      <Link href="/" className="h-16 flex items-center gap-2.5 px-5 shrink-0">
        <span className="font-display text-[19px] font-black text-gray-900" style={{ letterSpacing: '-0.04em' }}>VIGIL</span>
      </Link>

      <nav className="flex-1 overflow-y-auto px-3 pb-3" aria-label="Dashboard">
        <div className="space-y-0.5">
          {primary.map(i => <NavItem key={i.href} item={i} active={isActive(i)} />)}
        </div>

        <div className="mt-5 pt-4 border-t border-gray-200/80 space-y-1">
          {groups.map(g => {
            const isOpen = !!open[g.id]
            const hasActive = g.items.some(isActive)
            const Icon = g.icon
            return (
              <div key={g.id}>
                <button
                  type="button"
                  onClick={() => toggle(g.id)}
                  aria-expanded={isOpen}
                  aria-controls={`nav-${g.id}`}
                  className={`w-full flex items-center gap-3 px-3 py-2 rounded-lg text-[13.5px] font-medium transition-colors
                    ${hasActive ? 'text-gray-900' : 'text-gray-600 hover:text-gray-900 hover:bg-black/[0.04]'}
                    focus-visible:outline focus-visible:outline-2 focus-visible:outline-orange-500`}
                >
                  <Icon className={`w-[17px] h-[17px] shrink-0 ${hasActive ? 'text-orange-600' : 'text-gray-400'}`} strokeWidth={2} />
                  <span>{g.label}</span>
                  {!isOpen && hasActive && <span className="w-1.5 h-1.5 rounded-full bg-orange-600" aria-hidden="true" />}
                  <ChevronDown className={`ml-auto w-4 h-4 text-gray-400 transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} />
                </button>
                <div
                  id={`nav-${g.id}`}
                  className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}
                >
                  <div className="overflow-hidden">
                    <div className="space-y-0.5 py-0.5">
                      {g.items.map(i => <NavItem key={i.href} item={i} active={isActive(i)} nested />)}
                    </div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </nav>

      <div className="px-3 py-3 border-t border-gray-200/80 space-y-0.5 shrink-0">
        {footer.map(i => <NavItem key={i.href} item={i} active={isActive(i)} />)}
      </div>

      {session?.user && (
        <div className="px-4 py-3 border-t border-gray-200/80 shrink-0">
          <div className="flex items-center gap-3">
            {session.user.image ? (
              <img src={session.user.image} alt="" className="w-8 h-8 rounded-full shrink-0 ring-1 ring-gray-200" />
            ) : (
              <div className="w-8 h-8 rounded-full bg-gray-900 text-white flex items-center justify-center shrink-0 text-sm font-semibold">
                {session.user.name?.charAt(0) || 'U'}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-[13px] font-semibold text-gray-900 truncate">{session.user.name}</p>
              <p className="text-[11.5px] text-gray-500 truncate">{session.user.email}</p>
            </div>
            <button
              onClick={() => signOut({ callbackUrl: '/login' })}
              className="p-1.5 text-gray-400 hover:text-gray-900 hover:bg-black/[0.05] rounded-md transition-colors shrink-0"
              title="Sign out"
              aria-label="Sign out"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </aside>
  )
}
