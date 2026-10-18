import { NextRequest, NextResponse } from 'next/server'
import { proxy } from '@/lib/proxy'

export async function GET(req: NextRequest) {
  const id = req.nextUrl.searchParams.get('id')
  if (!id) return NextResponse.json({ error: 'id required' }, { status: 400 })
  return proxy(`/vigil/oauth/request?id=${encodeURIComponent(id)}`)
}
