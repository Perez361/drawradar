import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  const { data: evaluated, error: err1 } = await supabase
    .from('predictions')
    .select('id, was_correct')
    .not('was_correct', 'is', null)

  const { count: totalEvaluated, error: err2 } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true })
    .not('was_correct', 'is', null)

  const { count: unevaluated } = await supabase
    .from('predictions')
    .select('*', { count: 'exact', head: true })
    .is('was_correct', null)

  if (err1 || err2) {
    return NextResponse.json({ error: 'Query failed' }, { status: 500 })
  }

  const correct = evaluated?.filter(p => p.was_correct).length || 0
  const hitRate = totalEvaluated ? (correct / totalEvaluated * 100) : 0

  const highConf = evaluated?.filter(p => p.confidence >= 70 && p.was_correct)?.length || 0
  const highConfRate = totalEvaluated ? (highConf / totalEvaluated * 100) : 0

  return NextResponse.json({
    hitRate: Math.round(hitRate * 100) / 100,
    highConfHitRate: Math.round(highConfRate * 100) / 100,
    totalEvaluated: totalEvaluated || 0,
    correct,
    unevaluated: unevaluated || 0
  })
}
