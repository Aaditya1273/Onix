'use client'

import { useEffect, useLayoutEffect, useRef, useState } from 'react'

/**
 * Live connection to the control plane's event stream.
 *
 * This block was previously copy-pasted into three pages with slightly
 * different reconnect behavior. One copy now, so a fix to the backoff is a fix
 * everywhere.
 *
 * The URL must come from an env var rather than the rewrite in next.config.ts:
 * Next rewrites do not proxy WebSocket upgrades, so there is no server-side
 * path to fall back on.
 */
const WS_URL =
  process.env.NEXT_PUBLIC_VIGIL_WS_URL ||
  'ws://localhost:8080/api/v1/vigil/ws'

export interface VigilEvent {
  type?: string
  event?: string
  [key: string]: unknown
}

/**
 * The socket's real state: `connecting` while an attempt is open, `connected`
 * once the server accepted it, `disconnected` after it closed or failed (a new
 * attempt is scheduled `retryInMs` later; backoff doubles up to 30 s).
 */
export type SocketState =
  | { state: 'connecting' }
  | { state: 'connected'; since: number }
  | { state: 'disconnected'; retryInMs: number; attempts: number }

export function useVigilSocket(onMessage: (msg: VigilEvent) => void): SocketState {
  const [status, setStatus] = useState<SocketState>({ state: 'connecting' })

  // Held in a ref so callers do not have to memoize their handler; a new
  // closure each render would otherwise tear down and rebuild the socket.
  // Updated after commit (refs must not be written during render).
  const handler = useRef(onMessage)
  useLayoutEffect(() => { handler.current = onMessage })

  useEffect(() => {
    let ws: WebSocket | null = null
    let retry = 1000
    let timer: ReturnType<typeof setTimeout> | null = null
    let closed = false
    let attempts = 0

    const scheduleRetry = () => {
      attempts++
      setStatus({ state: 'disconnected', retryInMs: retry, attempts })
      timer = setTimeout(() => { if (!closed) setStatus({ state: 'connecting' }); connect() }, retry)
      retry = Math.min(retry * 2, 30000)
    }

    const connect = () => {
      if (closed) return
      try {
        ws = new WebSocket(WS_URL)
      } catch {
        // Constructor throws on a malformed URL; retry rather than crash the page.
        scheduleRetry()
        return
      }

      ws.onopen = () => {
        setStatus({ state: 'connected', since: Date.now() })
        retry = 1000
        attempts = 0
      }

      ws.onmessage = (e) => {
        try {
          handler.current(JSON.parse(e.data))
        } catch {
          // A malformed frame is not worth breaking the stream over.
        }
      }

      ws.onclose = () => {
        if (closed) return
        scheduleRetry()
      }

      ws.onerror = () => ws?.close()
    }

    connect()
    return () => {
      closed = true
      if (timer) clearTimeout(timer)
      ws?.close()
    }
  }, [])

  return status
}
