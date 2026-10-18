import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/lib/proxy'

const ACTIONS = new Set(['kill', 'pause', 'resume'])

export async function POST(_request: NextRequest, { params }: { params: Promise<{ id: string; action: string }> }) {
  const { id, action } = await params
  if (!ACTIONS.has(action)) return NextResponse.json({ error: 'Unknown action.' }, { status: 404 })
  return proxy(`/vigil/agents/${encodeURIComponent(id)}/${action}`, { method: 'POST', control: true })
}
