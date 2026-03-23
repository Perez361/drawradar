import { NextRequest, NextResponse } from 'next/server'
import { supabase, calculateDrawScore, calculateDrawProbability, scoreToConfidence } from '@/lib/supabase'

// This endpoint is called daily by Vercel Cron (configured in vercel.json)
// It scores all today's matches and inserts the top 10 as predictions
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const today = new Date().toISOString().split('T')[0]

  // 1. Fetch today's matches with league info
  const { data: matches, error: matchErr } = await supabase
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)
    .eq('status', 'scheduled')

  if (matchErr || !matches) {
    return NextResponse.json({ error: matchErr?.message ?? 'No matches' }, { status: 500 })
  }

  // 2. Score every match
  const scored = matches.map((match) => {
    const drawScore = calculateDrawScore(match as any)
    const drawProbability = calculateDrawProbability(match.xg_home, match.xg_away)
    const confidence = scoreToConfidence(drawScore)
    return { ...match, draw_score: drawScore, draw_probability: drawProbability, confidence }
  })

  // 3. Update draw_score and draw_probability in matches table
  await Promise.all(
    scored.map((m) =>
      supabase
        .from('matches')
        .update({ draw_score: m.draw_score, draw_probability: m.draw_probability, confidence: m.confidence })
        .eq('id', m.id)
    )
  )

  // 4. Delete existing predictions for today then re-insert top 10
  await supabase.from('predictions').delete().eq('prediction_date', today)

  const top10 = scored
    .sort((a, b) => b.draw_score - a.draw_score)
    .slice(0, 10)

  const { error: insertErr } = await supabase.from('predictions').insert(
    top10.map((m, i) => ({
      match_id: m.id,
      prediction_date: today,
      rank: i + 1,
      draw_score: m.draw_score,
      draw_probability: m.draw_probability,
      confidence: m.confidence,
      draw_odds: m.draw_odds,
    }))
  )

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({ success: true, processed: matches.length, predictions: top10.length })
}
