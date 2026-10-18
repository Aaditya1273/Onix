'use client'

import { useEffect, useState } from 'react'

// Chart intro animations play once per page load: a refresh of the data or a
// switch between tabs re-mounts the chart, but it is drawn still the second time.
const done: Record<string, boolean> = {}

export function useIntro(key: string): boolean {
  const [play] = useState(() => !done[key])
  useEffect(() => { done[key] = true }, [key])
  return play
}

/** A number that counts up from 0 to its value during the intro, then follows the value. */
export function useCountUp(value: number, play: boolean, ms = 1100): number {
  const [k, setK] = useState(play ? 0 : 1) // intro progress, 0 to 1
  useEffect(() => {
    if (!play) return
    let raf = 0
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { raf = requestAnimationFrame(() => setK(1)); return () => cancelAnimationFrame(raf) }
    const t0 = performance.now()
    const tick = (t: number) => { const p = Math.min(1, (t - t0) / ms); setK(p); if (p < 1) raf = requestAnimationFrame(tick) }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [play, ms])
  return Math.round(value * (1 - Math.pow(1 - k, 3)))
}
