import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { predictDraw } from '@/lib/drawEngine'

export async function GET() {
  const today = new Date().toISOString().split('T')[0]

  // 1. Clear old predictions
  await supabase
    .from('predictions')
    .delete()
    .eq('prediction_date', today)

  // 2. Fetch matches
  const { data: matches, error } = await supabase
    .from('matches')
    .select(`
      *,
      leagues(avg_draw_rate)
    `)
    .eq('match_date', today)

  if (error) {
    return NextResponse.json({ error: error.message })
  }

  let saved = 0

  // 3. Loop through matches
  for (const match of matches || []) {
    if (!match.home_xg || !match.away_xg || !match.draw_odds) continue

    const result = predictDraw({
      home_xg: match.home_xg,
      away_xg: match.away_xg,
      home_odds: match.home_odds,
      draw_odds: match.draw_odds,
      away_odds: match.away_odds,
      league_avg_draw_rate: match.leagues?.avg_draw_rate
    })

    // 4. FILTER (CRITICAL)
    if (
      result.probability >= 0.30 &&
      result.edge > 0.03 &&
      match.draw_odds >= 2.6 &&
      match.draw_odds <= 3.8
    ) {
      await supabase.from('predictions').insert({
        match_id: match.id,
        confidence: result.confidence,
        draw_score: result.score,
        edge: result.edge,
        probability: result.probability,
        prediction_date: today
      })

      saved++
    }
  }

  return NextResponse.json({
    message: 'Predictions generated',
    saved
  })
}