import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  // Use supabaseAdmin to bypass RLS on the predictions table.
  // This is a server route so the service key is safe to use here.
  const { data, error } = await supabaseAdmin
    .from('predictions')
    .select(`
      *,
      matches(*, leagues(*))
    `)
    .order('rank', { ascending: true })

  if (error) {
    console.error('[predictions] query error:', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json(data)
}