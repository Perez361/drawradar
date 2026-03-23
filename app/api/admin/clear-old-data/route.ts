import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const today = new Date().toISOString().split('T')[0]

  const { error: predErr } = await supabaseAdmin
    .from('predictions')
    .delete()
    .neq('id', 0)

  if (predErr) {
    return NextResponse.json({ error: `predictions: ${predErr.message}` }, { status: 500 })
  }

  const { error: matchErr } = await supabaseAdmin
    .from('matches')
    .delete()
    .not('match_date', 'gte', `${today}T00:00:00`)

  if (matchErr) {
    return NextResponse.json({ error: `matches: ${matchErr.message}` }, { status: 500 })
  }

  return NextResponse.json({ success: true })
}