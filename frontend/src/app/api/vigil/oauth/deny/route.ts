import { NextRequest } from 'next/server'
import { proxy } from '@/lib/proxy'

export async function POST(req: NextRequest) {
  return proxy('/vigil/oauth/deny', { method: 'POST', body: await req.text() })
}
