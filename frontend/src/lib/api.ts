// One way to call the control plane from the application pages: the status is
// checked before the body is parsed, a gateway's HTML error page is not mistaken
// for data, and every failure says what kind it was so the page can tell the
// user the truth (unreachable, waking up, not allowed, or a real error).

export type ApiErrorKind = 'network' | 'sleeping' | 'unauthorized' | 'forbidden' | 'not_found' | 'unavailable' | 'http' | 'parse' | 'timeout' | 'rate_limited'

export class ApiError extends Error {
  constructor(public kind: ApiErrorKind, message: string, public status = 0) { super(message) }
}

const MESSAGES: Record<ApiErrorKind, string> = {
  network: 'The control plane could not be reached.',
  sleeping: 'The control plane is waking up (free hosting sleeps when idle). This usually takes under a minute.',
  unauthorized: 'This action needs an operator. Sign in with an operator account.',
  forbidden: 'Your account is not allowed to do this.',
  not_found: 'This feature is not available on this server.',
  unavailable: 'The server is up, but the graph database behind this view is not configured or not reachable.',
  http: 'The control plane returned an error.',
  parse: 'The control plane returned a response this page could not read.',
  timeout: 'The control plane took too long to answer.',
  rate_limited: 'Too many attempts from your address. Wait a minute and try again.',
}

export function describe(e: unknown): string {
  if (e instanceof ApiError) return e.message || MESSAGES[e.kind]
  return MESSAGES.network
}

export async function fetchJSON<T>(url: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), init?.timeoutMs ?? 20000)
  let r: Response
  try {
    r = await fetch(url, { cache: 'no-store', ...init, signal: init?.signal ?? ctl.signal })
  } catch (e) {
    throw new ApiError((e as Error).name === 'AbortError' ? 'timeout' : 'network', '')
  } finally { clearTimeout(timer) }
  const text = await r.text()
  let body: unknown = null
  if (text) { try { body = JSON.parse(text) } catch { body = undefined } }
  if (!r.ok) {
    const b = body && typeof body === 'object' ? body as { error?: unknown; kind?: string } : {}
    const msg = b.error ? String(b.error) : ''
    // Our own proxy routes say what kind of failure it was; trust that first.
    if (b.kind && b.kind in MESSAGES) throw new ApiError(b.kind as ApiErrorKind, msg || MESSAGES[b.kind as ApiErrorKind], r.status)
    const kind: ApiErrorKind =
      r.status === 401 ? 'unauthorized' : r.status === 403 ? 'forbidden' : r.status === 404 ? 'not_found' : r.status === 429 ? 'rate_limited' :
      // A gateway answering with its own HTML page means the host is asleep or restarting.
      [502, 503, 504].includes(r.status) && body === undefined ? 'sleeping' : r.status === 503 ? 'unavailable' : 'http'
    throw new ApiError(kind, msg && kind === 'http' ? `${MESSAGES.http} (${r.status}: ${msg})` : MESSAGES[kind], r.status)
  }
  if (body === undefined) throw new ApiError('parse', '', r.status)
  return body as T
}
