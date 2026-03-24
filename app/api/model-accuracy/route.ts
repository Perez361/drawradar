import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  // Fetch all evaluated predictions with confidence included
  const { data: evaluated, error: err1 } = await supabase
    .from('predictions')
    .select('id, was_correct, confidence')
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

  const total   = totalEvaluated ?? 0
  const correct = evaluated?.filter(p => p.was_correct).length ?? 0
  const hitRate = total > 0 ? (correct / total) * 100 : 0

  // High-confidence predictions (≥70%) — hit rate among those specifically
  const highConfPreds    = evaluated?.filter(p => p.confidence >= 70) ?? []
  const highConfCorrect  = highConfPreds.filter(p => p.was_correct).length
  const highConfTotal    = highConfPreds.length
  const highConfHitRate  = highConfTotal > 0 ? (highConfCorrect / highConfTotal) * 100 : 0

  return NextResponse.json({
    hitRate:         Math.round(hitRate        * 100) / 100,
    highConfHitRate: Math.round(highConfHitRate * 100) / 100,
    totalEvaluated:  total,
    correct,
    highConfTotal,
    highConfCorrect,
    unevaluated:     unevaluated ?? 0,
  })
}