'use client'

import { usePathname } from 'next/navigation'
import { useSession } from 'next-auth/react'
import { ChevronRight } from 'lucide-react'
import { crumbs, pageTabs } from './nav'
import { usePageTab } from '@/lib/usePageTab'

// The frame's top bar. The sidebar already navigates between pages, so this bar
// works inside the page: a long page's sub-tabs, or, on a short page, where you are.
export function TopBar() {
  const pathname = usePathname()
  const { data: session } = useSession()
  const tabs = pageTabs[pathname]
  const tab = usePageTab(pathname)
  const user = session?.user
  return (
    <header className={`${tabs ? 'flex' : 'hidden lg:flex'} h-[48px] lg:h-[64px] shrink-0 items-center gap-6 px-4 lg:px-7 border-b border-[#ebe4d9]`}>
      {tabs ? (
        <nav aria-label="Sections of this page" className="flex items-stretch gap-5 lg:gap-7 h-full min-w-0 overflow-x-auto [scrollbar-width:none]">
          {tabs.map(t => {
            const on = tab === t.id
            return (
              <a key={t.id} href={`#view=${t.id}`} aria-current={on ? 'page' : undefined}
                className={`relative flex items-center whitespace-nowrap text-[14px] font-semibold transition-colors
                  ${on ? 'text-[#14100d]' : 'text-[#6b6158] hover:text-[#14100d]'}
                  focus-visible:outline focus-visible:outline-2 focus-visible:outline-[#14100d] rounded-sm`}>
                {t.label}
                {on && <span className="absolute left-0 right-0 -bottom-px h-[2.5px] rounded-full bg-[#ff6b00]" aria-hidden="true" />}
              </a>
            )
          })}
        </nav>
      ) : (
        <nav aria-label="Breadcrumb">
          <ol className="flex items-center gap-1.5 text-[14px]">
            {crumbs(pathname).map((c, i, all) => (
              <li key={i} className="flex items-center gap-1.5">
                {i > 0 && <ChevronRight className="w-4 h-4 text-[#b9ada0]" aria-hidden="true" />}
                <span className={i === all.length - 1 ? 'font-semibold text-[#14100d]' : 'text-[#6b6158]'} aria-current={i === all.length - 1 ? 'page' : undefined}>{c}</span>
              </li>
            ))}
          </ol>
        </nav>
      )}
      <div className="ml-auto hidden lg:flex items-center gap-3 shrink-0">
        {user && (
          <>
            {user.image
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={user.image} alt="" className="w-9 h-9 rounded-full ring-2 ring-white" />
              : <span className="grid place-items-center w-9 h-9 rounded-full bg-[#14100d] text-white text-sm font-semibold" aria-hidden="true">{user.name?.charAt(0) || 'U'}</span>}
            <div className="leading-tight">
              <p className="text-[13.5px] font-semibold text-[#14100d]">{user.name}</p>
              <p className="text-[12px] text-[#6b6158]">{user.email}</p>
            </div>
          </>
        )}
      </div>
    </header>
  )
}
