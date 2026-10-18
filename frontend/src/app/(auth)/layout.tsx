import React from 'react'
import '../styles/landing.css'

// Auth pages lay themselves out full-bleed; the landing stylesheet brings the
// brand fonts.
export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}
