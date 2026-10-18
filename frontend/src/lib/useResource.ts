'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchJSON } from './api'

// A polled, API-backed view with honest states:
//   loading  first request in flight, nothing to show yet
//   ready    data from the last successful request
//   error    the request failed and there is no earlier data
// When a refresh fails after an earlier success, the earlier data stays,
// marked stale, with the error alongside: never silently treated as current.
export interface Resource<T> {
  status: 'loading' | 'ready' | 'error'
  data: T | null
  error: ApiError | null
  stale: boolean
  loadedAt: number | null
  retry: () => void
}

export function useResource<T>(url: string | null, opts: { intervalMs?: number; init?: RequestInit } = {}): Resource<T> {
  const [state, setState] = useState<Omit<Resource<T>, 'retry'>>({ status: 'loading', data: null, error: null, stale: false, loadedAt: null })
  const gen = useRef(0)
  const { intervalMs, init } = opts
  const initKey = JSON.stringify(init ?? null)

  const load = useCallback(async () => {
    if (!url) return
    const g = ++gen.current
    try {
      const data = await fetchJSON<T>(url, init)
      if (g === gen.current) setState({ status: 'ready', data, error: null, stale: false, loadedAt: Date.now() })
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('network', '')
      if (g === gen.current) setState(s => s.data !== null ? { ...s, error: err, stale: true } : { status: 'error', data: null, error: err, stale: false, loadedAt: null })
    }
    // init is compared by value through initKey
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, initKey])

  useEffect(() => {
    if (!url) return
    const first = setTimeout(load, 0)
    const t = intervalMs ? setInterval(load, intervalMs) : null
    const g = gen // a bump makes any response still in flight land nowhere
    return () => { clearTimeout(first); if (t) clearInterval(t); g.current++ }
  }, [url, intervalMs, load])

  const retry = useCallback(() => {
    setState(s => (s.data === null ? { ...s, status: 'loading', error: null } : s))
    load()
  }, [load])

  return { ...state, retry }
}
