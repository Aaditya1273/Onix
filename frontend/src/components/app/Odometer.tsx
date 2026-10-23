'use client'

import { useEffect, useState } from 'react'

// Digits that roll into place (each digit a 0-9 strip that slides to its value), so a
// number arrives the way it does in the brand film. Anything that is not a digit
// (units, $, %, separators) stays still. Later changes roll from the old value.
export function Odometer({ value, className = '' }: { value: string | number; className?: string }) {
  const text = String(value)
  const [shown, setShown] = useState(() => text.replace(/\d/g, '0'))
  useEffect(() => {
    // one frame at zero first, so the first value also rolls in
    const raf = requestAnimationFrame(() => setShown(text))
    return () => cancelAnimationFrame(raf)
  }, [text])
  const target = shown.length === text.length ? shown : text
  return (
    <span className={`odo ${className}`} aria-label={text}>
      {[...target].map((ch, i) =>
        /\d/.test(ch)
          ? <span key={i} className="odo-col" aria-hidden="true"><span className="odo-strip" style={{ transform: `translateY(-${Number(ch) * 10}%)`, transitionDelay: `${i * 45}ms` }}>{'0123456789'.split('').map(d => <span key={d}>{d}</span>)}</span></span>
          : <span key={i} aria-hidden="true">{ch}</span>)}
    </span>
  )
}
