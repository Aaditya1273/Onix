import { NextResponse } from 'next/server'
import { proxy } from '@/lib/proxy'

export const GET = () => proxy('/mcp/sessions')

// Older callers post {session_id, action}; the per-session route is the same call.
export async function POST(request: Request) {
  const body = await request.json().catch(() => ({}))
  const { session_id, action } = body as { session_id?: string; action?: string; budget?: number }
  if (!session_id || !['approve', 'block', 'budget'].includes(action || '')) {
    return NextResponse.json({ error: 'session_id and a valid action are required' }, { status: 400 })
  }
  const payload = action === 'budget' ? JSON.stringify({ budget: (body as { budget?: number }).budget }) : '{}'
  return proxy(`/mcp/sessions/${encodeURIComponent(session_id)}/${action}`, { method: 'POST', body: payload, control: true })
}
