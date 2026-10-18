import { NextResponse } from 'next/server'
import { auth } from '@/auth'
import { api } from './backend'

// Server-side proxying to the control plane, in one place.
//
// Control actions (kill, pause, resume, ledger export) need the backend's
// operator token. That token lives only in this server's environment
// (VIGIL_CONTROL_TOKEN) and is added here, after the signed-in user is checked
// against VIGIL_OPERATOR_EMAILS. The browser never sees it. Without a token
// configured the request is forwarded as is, so it gets exactly the access an
// anonymous caller of the backend would get, no more.
//
// A backend that cannot be reached is reported as such (502), never turned
// into an empty result that would read as "nothing happened".

const fail = (status: number, kind: string, error: string) => NextResponse.json({ error, kind }, { status })

async function operatorAuth(): Promise<{ header?: string; denied?: NextResponse }> {
  const token = process.env.VIGIL_CONTROL_TOKEN
  if (!token) return {}
  const session = await auth()
  const email = session?.user?.email?.toLowerCase()
  if (!email) return { denied: fail(401, 'unauthorized', 'Sign in with an operator account to do this.') }
  const allowed = (process.env.VIGIL_OPERATOR_EMAILS || '').split(',').map(s => s.trim().toLowerCase()).filter(Boolean)
  if (!allowed.includes(email)) return { denied: fail(403, 'forbidden', 'Your account is not an operator on this dashboard.') }
  return { header: `Bearer ${token}` }
}

export async function proxy(path: string, init: { method?: string; body?: string; control?: boolean; raw?: boolean } = {}) {
  const headers: Record<string, string> = {}
  if (init.control) {
    const a = await operatorAuth()
    if (a.denied) return a.denied
    if (a.header) headers.Authorization = a.header
  }
  if (init.body !== undefined) headers['Content-Type'] = 'application/json'
  let res: Response
  try {
    res = await fetch(api(path), { method: init.method || 'GET', headers, body: init.body, cache: 'no-store', signal: AbortSignal.timeout(25000) })
  } catch {
    return fail(502, 'network', 'The control plane could not be reached.')
  }
  if (init.raw && res.ok) {
    // Pass the body through untouched (file downloads).
    const out = new Headers()
    for (const h of ['content-type', 'content-disposition']) { const v = res.headers.get(h); if (v) out.set(h, v) }
    return new NextResponse(res.body, { status: res.status, headers: out })
  }
  const text = await res.text()
  try {
    return NextResponse.json(text ? JSON.parse(text) : {}, { status: res.status })
  } catch {
    // A non-JSON body. From the host in front of the backend (502-504, or a
    // 200 HTML page) it means asleep or restarting; anything else is the
    // backend's own status with a plain-text body.
    if (res.ok || [502, 503, 504].includes(res.status)) return fail(res.ok ? 502 : res.status, 'sleeping', 'The control plane is waking up or restarting. Try again in a minute.')
    const kind = res.status === 401 ? 'unauthorized' : res.status === 403 ? 'forbidden' : res.status === 404 ? 'not_found' : 'http'
    return fail(res.status, kind, kind === 'http' ? `The control plane returned an error (${res.status}).` : '')
  }
}
