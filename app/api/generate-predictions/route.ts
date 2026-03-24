import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { predictDraw, type DrawFeatures } from '@/lib/drawEngine'

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
    if (!match.xg_home || !match.xg_away || !match.draw_odds) continue

    const features: DrawFeatures = {
      xgHome:           match.xg_home,
      xgAway:           match.xg_away,
      homeGoalsAvg:     match.home_goals_avg,
      awayGoalsAvg:     match.away_goals_avg,
      homeConcedeAvg:   match.home_concede_avg,
      awayConcedeAvg:   match.away_concede_avg,
      homeDrawRate:     match.home_draw_rate,
      awayDrawRate:     match.away_draw_rate,
      h2hDrawRate:      match.h2h_draw_rate,
      h2hIsReal:        match.h2h_is_real ?? false,
      drawOdds:         match.draw_odds,
      homeOdds:         0,
      awayOdds:         0,
      leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
    }

    const result = predictDraw(features)

    // 4. FILTER (CRITICAL)
    if (
      result.probability >= 0.30 &&
      result.edge > 0.03 &&
      match.draw_odds >= 2.6 &&
      match.draw_odds <= 3.8
    ) {
      await supabase.from('predictions').insert({
        match_id:        match.id,
        confidence:      result.confidence,
        draw_score:      result.drawScore,   // was result.score ❌
        edge:            result.edge,
        probability:     result.probability,
        prediction_date: today,
      })

      saved++
    }
  }

  return NextResponse.json({
    message: 'Predictions generated',
    saved,
  })
}