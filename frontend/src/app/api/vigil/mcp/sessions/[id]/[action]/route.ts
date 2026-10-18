import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/lib/proxy'

const ACTIONS = new Set(['approve', 'block', 'budget'])

// MCP session controls live under /api/v1/mcp on the backend (not /vigil).
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 404 })
  return proxy(`/mcp/sessions/${encodeURIComponent(id)}/${action}`, { method: 'POST', body: (await request.text()) || '{}', control: true })
}
