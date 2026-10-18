import { NextRequest } from 'next/server'
import { proxy } from '@/lib/proxy'

// The hash-chained decision ledger, downloaded through this server so the
// operator token stays server-side.
export async function GET(request: NextRequest) {
  const days = Math.min(365, Math.max(1, Number(request.nextUrl.searchParams.get('days')) || 7))
  return proxy(`/vigil/ledger/export?days=${days}`, { control: true, raw: true })
}
