'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useRef, useState } from 'react'
import { useSession, signOut } from 'next-auth/react'
import { ChevronDown, ArrowUpRight, Menu, X, Search, LogOut } from 'lucide-react'
import { allPages, footer, groups, primary, type NavItem } from './nav'

const OPEN_KEY = 'vigil-sidebar-open'

// A dark panel inset in the app frame. Text on #1d1916: #f2ede7 (15:1), #b9ada0 (8:1);
// the active item is the brand orange with dark text (6.7:1).
function NavLink({ item, active, nested }: { item: NavItem; active: boolean; nested?: boolean }) {
  const { label, href, icon: Icon, external } = item
  return (
    <Link
      href={href}
      target={external ? '_blank' : undefined}
      rel={external ? 'noopener noreferrer' : undefined}
      aria-current={active ? 'page' : undefined}
      className={`group flex items-center gap-3 rounded-xl text-[13.5px] font-medium transition-colors duration-150
        ${nested ? 'pl-10 pr-3 py-1.5' : 'px-3 py-2'}
        ${active ? 'bg-[#ff6b00] text-[#14100d]' : 'text-[#d6ccc0] hover:text-white hover:bg-white/[0.07]'}
        focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb98a]`}
    >
      <Icon className={`w-[18px] h-[18px] shrink-0 ${active ? 'text-[#14100d]' : 'text-[#b9ada0] group-hover:text-white'}`} strokeWidth={active ? 2.3 : 1.9} aria-hidden="true" />
      <span className="truncate">{label}</span>
      {external && <ArrowUpRight className={`ml-auto w-3.5 h-3.5 ${active ? '' : 'text-[#b9ada0]'}`} aria-label="opens in a new tab" />}
    </Link>
  )
}

export function Sidebar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const isActive = (i: NavItem) => !i.external && pathname === i.href
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [drawer, setDrawer] = useState(false)
  const [q, setQ] = useState('')

  // The phone drawer closes on navigation and on Escape.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { setDrawer(false); setQ('') }, [pathname])
  const menuBtn = useRef<HTMLButtonElement>(null)
  const closeBtn = useRef<HTMLButtonElement>(null)
  const wasOpen = useRef(false)
  useEffect(() => {
    // Focus moves into the drawer when it opens and back to the menu button when it closes.
    if (drawer) closeBtn.current?.focus()
    else if (wasOpen.current) menuBtn.current?.focus()
    wasOpen.current = drawer
    if (!drawer) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setDrawer(false) }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [drawer])

  // A group opens on its own when you are on one of its pages; otherwise it stays as you left it.
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

  const query = q.trim().toLowerCase()
  const found = query ? allPages.filter(p => p.label.toLowerCase().includes(query)) : []

  return (
    <>
      {/* Below lg the sidebar becomes a drawer opened from this bar. */}
      <div className="lg:hidden h-14 shrink-0 flex items-center gap-2 px-3 border-b border-[#e6ded2] bg-[#f7f3ec]">
        <button ref={menuBtn} type="button" onClick={() => setDrawer(true)} aria-label="Open navigation" aria-expanded={drawer} aria-controls="app-nav"
          className="grid place-items-center w-10 h-10 rounded-lg text-[#14100d] hover:bg-black/[0.05]">
          <Menu className="w-5 h-5" aria-hidden="true" />
        </button>
        <Link href="/" className="font-display text-[18px] font-black text-[#14100d]" style={{ letterSpacing: '-0.04em' }}>VIGIL</Link>
      </div>
      {drawer && <div className="lg:hidden fixed inset-0 z-40 bg-black/40" onClick={() => setDrawer(false)} aria-hidden="true" />}

      <aside id="app-nav"
        className={`w-[248px] shrink-0 flex flex-col select-none bg-[#1d1916] text-[#f2ede7]
          lg:m-2.5 lg:mr-0 lg:rounded-[20px] lg:h-[calc(100%-20px)]
          max-lg:fixed max-lg:inset-y-0 max-lg:left-0 max-lg:z-50 max-lg:w-[min(280px,85vw)] max-lg:transition-transform max-lg:duration-200
          ${drawer ? 'max-lg:translate-x-0 max-lg:shadow-2xl' : 'max-lg:-translate-x-full max-lg:invisible'}`}
        {...(drawer ? { role: 'dialog', 'aria-modal': true, 'aria-label': 'Navigation' } : {})}>
        <div className="h-[60px] flex items-center gap-3 px-5 shrink-0">
          <Link href="/" className="font-display text-[20px] font-black text-white" style={{ letterSpacing: '-0.03em' }}>VIGIL</Link>
          <button ref={closeBtn} type="button" onClick={() => setDrawer(false)} aria-label="Close navigation"
            className="lg:hidden ml-auto grid place-items-center w-9 h-9 rounded-lg text-[#d6ccc0] hover:bg-white/[0.08]">
            <X className="w-5 h-5" aria-hidden="true" />
          </button>
        </div>

        <div className="px-4 pb-3 shrink-0">
          <label className="relative block">
            <span className="sr-only">Find a page</span>
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[#b9ada0]" aria-hidden="true" />
            <input value={q} onChange={e => setQ(e.target.value)} placeholder="Find a page" type="search"
              className="w-full h-10 rounded-xl bg-white/[0.06] border border-white/[0.14] pl-9 pr-3 text-[13.5px] text-white placeholder:text-[#b9ada0]
                focus:outline-none focus:border-[#ff6b00] focus:bg-white/[0.09]" />
          </label>
        </div>

        <nav className="flex-1 overflow-y-auto px-3 pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden" aria-label="Application">
          {query ? (
            <div className="space-y-1">
              {found.map(i => <NavLink key={i.href} item={i} active={isActive(i)} />)}
              {found.length === 0 && <p className="px-3 py-2 text-[13px] text-[#b9ada0]">No page matches “{q}”.</p>}
            </div>
          ) : (
            <>
              <div className="space-y-0.5">
                {primary.map(i => <NavLink key={i.href} item={i} active={isActive(i)} />)}
              </div>
              <div className="mt-3 pt-3 border-t border-white/[0.09] space-y-0.5">
                {groups.map(g => {
                  const isOpen = !!open[g.id]
                  const hasActive = g.items.some(isActive)
                  const Icon = g.icon
                  return (
                    <div key={g.id}>
                      <button type="button" onClick={() => toggle(g.id)} aria-expanded={isOpen} aria-controls={`nav-${g.id}`}
                        className={`w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium transition-colors
                          ${hasActive ? 'text-white' : 'text-[#d6ccc0] hover:text-white hover:bg-white/[0.07]'}
                          focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb98a]`}>
                        <Icon className={`w-[18px] h-[18px] shrink-0 ${hasActive ? 'text-[#ff6b00]' : 'text-[#b9ada0]'}`} strokeWidth={1.9} aria-hidden="true" />
                        <span>{g.label}</span>
                        {!isOpen && hasActive && <span className="w-1.5 h-1.5 rounded-full bg-[#ff6b00]" aria-hidden="true" />}
                        <ChevronDown className={`ml-auto w-4 h-4 text-[#b9ada0] transition-transform duration-200 ${isOpen ? 'rotate-180' : ''}`} aria-hidden="true" />
                      </button>
                      <div id={`nav-${g.id}`} inert={!isOpen}
                        className={`grid transition-[grid-template-rows] duration-200 ease-out ${isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'}`}>
                        <div className="overflow-hidden">
                          <div className="space-y-0.5 py-0.5">
                            {g.items.map(i => <NavLink key={i.href} item={i} active={isActive(i)} nested />)}
                          </div>
                        </div>
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </nav>

        <div className="px-3 py-2.5 border-t border-white/[0.09] space-y-0.5 shrink-0">
          {footer.map(i => <NavLink key={i.href} item={i} active={isActive(i)} />)}
          {session?.user && (
            <button type="button" onClick={() => signOut({ callbackUrl: '/login' })}
              className="w-full flex items-center gap-3 px-3 py-2 rounded-xl text-[13.5px] font-medium text-[#d6ccc0] hover:text-white hover:bg-white/[0.07]
                focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#ffb98a]">
              <LogOut className="w-[18px] h-[18px] text-[#b9ada0]" strokeWidth={1.9} aria-hidden="true" />Log out
            </button>
          )}
        </div>
      </aside>
    </>
  )
}
