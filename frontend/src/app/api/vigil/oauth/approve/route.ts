import { NextRequest } from 'next/server'
import { proxy } from '@/lib/proxy'

export async function POST(req: NextRequest) {
  return proxy('/vigil/oauth/approve', { method: 'POST', body: await req.text() })
}
