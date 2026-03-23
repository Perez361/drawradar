import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data, error } = await supabase
    .from('predictions')
    .select(`
      *,
      matches(*, leagues(*))
    `)
    .order('rank', { ascending: true })

  if (error) return NextResponse.json({ error: error.message })

  return NextResponse.json(data)
}