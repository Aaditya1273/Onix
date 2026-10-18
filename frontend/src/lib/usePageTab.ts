'use client'

import { useEffect, useSyncExternalStore } from 'react'
import { pageTabs } from '@/components/nav'

// The current sub-tab of a page, kept in the URL hash (#view=<id>) so a tab can be
// linked and the back button works. The hash, unlike a query string, needs no
// Suspense boundary around statically rendered pages.
const subscribe = (cb: () => void) => {
  window.addEventListener('hashchange', cb)
  return () => window.removeEventListener('hashchange', cb)
}
const getHash = () => window.location.hash
const getServerHash = () => ''

export function usePageTab(pathname: string): string {
  const ids = (pageTabs[pathname] || []).map(t => t.id)
  const hash = useSyncExternalStore(subscribe, getHash, getServerHash)
  const m = hash.match(/view=([\w-]+)/)
  const tab = m && ids.includes(m[1]) ? m[1] : ids[0] || ''
  // A new tab starts at the top of the page.
  useEffect(() => { document.querySelector('main.dashboard-shell')?.scrollTo({ top: 0 }) }, [tab])
  return tab
}
