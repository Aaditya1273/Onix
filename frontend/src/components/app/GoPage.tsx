'use client'

import { useEffect, useRef, useState } from 'react'
import { StatePanel } from './ui'
import { usePageTab } from '@/lib/usePageTab'

// A page the Go server renders itself (/web/*), shown inside the dashboard frame.
// ?embed=1 switches it to the dashboard's look and drops its own header. It fills
// the main area exactly, so the page scrolls inside it with one scrollbar.
export function GoPage({ src, title, tabsFor }: { src: string; title: string; tabsFor?: string }) {
  const [ready, setReady] = useState(false)
  const frame = useRef<HTMLIFrameElement>(null)
  const tab = usePageTab(tabsFor || '')
  // The frame is same-origin (/web is proxied), so the open sub-tab is set on its root directly.
  const show = (t: string) => {
    const doc = frame.current?.contentDocument
    if (!doc || !t) return
    doc.documentElement.dataset.view = t
    doc.scrollingElement?.scrollTo({ top: 0 })
  }
  useEffect(() => { if (ready) show(tab) }, [tab, ready])
  // The frame can finish loading before React attaches onLoad (it is in the server
  // HTML), so check once on mount as well.
  useEffect(() => {
    const doc = frame.current?.contentDocument
    if (doc && doc.readyState === 'complete' && doc.URL !== 'about:blank') setReady(true)
  }, [])
  return (
    <div className="relative h-full min-h-[600px]">
      <h1 className="sr-only">{title}</h1>
      {!ready && <div className="absolute inset-0 grid place-items-center p-8"><StatePanel kind="loading" title={`Loading ${title}…`} /></div>}
      <iframe ref={frame} src={`${src}${src.includes('?') ? '&' : '?'}embed=1`} title={title} onLoad={() => setReady(true)}
        className={`block w-full h-full border-0 transition-opacity duration-300 ${ready ? 'opacity-100' : 'opacity-0'}`} />
    </div>
  )
}
