import { NextRequest } from 'next/server'
import { proxy } from '@/lib/proxy'

export const GET = () => proxy('/vigil/governance/rules')
export async function POST(request: NextRequest) {
  return proxy('/vigil/governance/rules', { method: 'POST', body: await request.text() })
}
