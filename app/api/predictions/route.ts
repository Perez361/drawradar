import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const today = new Date().toISOString().split('T')[0]

  const { data, error } = await supabase
    .from('predictions')
    .select(`
      *,
      matches (
        *,
        leagues (name, country, avg_draw_rate, draw_boost)
      )
    `)
    .eq('prediction_date', today)
    .order('rank', { ascending: true })
    .limit(10)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  return NextResponse.json({ predictions: data, date: today })
}
