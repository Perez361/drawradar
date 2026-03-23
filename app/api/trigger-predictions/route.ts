import { NextRequest, NextResponse } from 'next/server'
import {
  supabase,
  calculateDrawScore,
  calculateDrawProbability,
  scoreToConfidence,
} from '@/lib/supabase'
import {
  fetchMatchesForDate,
  mapEventToMatch,
  type MappedMatch,
} from '@/lib/odds-api'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertLeague(
  name: string,
  country: string,
  avgDrawRate: number
): Promise<number | null> {
  const { data, error } = await supabase
    .from('leagues')
    .upsert(
      { name, country, avg_draw_rate: avgDrawRate, draw_boost: 0 },
      { onConflict: 'name' }
    )
    .select('id')
    .single()

  if (error) {
    console.error(`[upsertLeague] ${name}:`, error.message)
    return null
  }
  return data.id
}

async function upsertTodayMatches(today: string): Promise<void> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY env var is not set')

  // fetchMatchesForDate takes (apiKey, dateFrom, dateTo)
  const events = await fetchMatchesForDate(apiKey, today, today)
  const mappedAll = events
    .map(mapEventToMatch)
    .filter((m): m is MappedMatch => m !== null)

  if (mappedAll.length === 0) {
    console.log('[upsertTodayMatches] No events with odds found for today.')
    return
  }

  const byLeague = new Map<string, MappedMatch[]>()
  for (const m of mappedAll) {
    const key = m.league_name
    if (!byLeague.has(key)) byLeague.set(key, [])
    byLeague.get(key)!.push(m)
  }

  for (const [leagueName, matches] of Array.from(byLeague)) {
    const first = matches[0]
    if (!first) continue

    const leagueId = await upsertLeague(
      leagueName,
      first.league_country,
      first.home_draw_rate
    )
    if (!leagueId) continue

    const rows = matches.map((m: MappedMatch) => ({
      league_id:        leagueId,
      home_team_name:   m.home_team_name,
      away_team_name:   m.away_team_name,
      match_date:       m.match_date,
      draw_odds:        m.draw_odds,
      xg_home:          m.xg_home,
      xg_away:          m.xg_away,
      home_goals_avg:   m.home_goals_avg,
      away_goals_avg:   m.away_goals_avg,
      home_concede_avg: m.home_concede_avg,
      away_concede_avg: m.away_concede_avg,
      home_draw_rate:   m.home_draw_rate,
      away_draw_rate:   m.away_draw_rate,
      h2h_draw_rate:    m.h2h_draw_rate,
      draw_score:       0,
      draw_probability: 0,
      confidence:       0,
      status:           'scheduled',
      external_id:      m.external_id,
    }))

    const { error } = await supabase
      .from('matches')
      .upsert(rows, { onConflict: 'external_id' })

    if (error) {
      console.error(`[upsertTodayMatches] league ${leagueName}:`, error.message)
    } else {
      console.log(`[upsertTodayMatches] Upserted ${rows.length} matches for ${leagueName}`)
    }
  }
}

// ─── Shared pipeline logic ────────────────────────────────────────────────────

async function runPipeline(): Promise<NextResponse> {
  const today = new Date().toISOString().split('T')[0]

  try {
    console.log('[trigger-predictions] Step 1: fetching matches from Odds API…')
    await upsertTodayMatches(today)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[trigger-predictions] Odds API fetch failed:', message)
    // Continue — fall back to any matches already in DB for today
  }

  const { data: matches, error: matchErr } = await supabase
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)
    .eq('status', 'scheduled')

  if (matchErr || !matches || matches.length === 0) {
    return NextResponse.json(
      { error: matchErr?.message ?? 'No matches found for today' },
      { status: 500 }
    )
  }

  const scored = matches.map((match) => {
    const drawScore       = calculateDrawScore(match as any)
    const drawProbability = calculateDrawProbability(match.xg_home, match.xg_away)
    const confidence      = scoreToConfidence(drawScore)
    return { ...match, draw_score: drawScore, draw_probability: drawProbability, confidence }
  })

  await Promise.all(
    scored.map((m) =>
      supabase
        .from('matches')
        .update({
          draw_score:       m.draw_score,
          draw_probability: m.draw_probability,
          confidence:       m.confidence,
        })
        .eq('id', m.id)
    )
  )

  await supabase.from('predictions').delete().eq('prediction_date', today)

  const top10 = [...scored]
    .sort((a, b) => b.draw_score - a.draw_score)
    .slice(0, 10)

  const { error: insertErr } = await supabase.from('predictions').insert(
    top10.map((m, i) => ({
      match_id:         m.id,
      prediction_date:  today,
      rank:             i + 1,
      draw_score:       m.draw_score,
      draw_probability: m.draw_probability,
      confidence:       m.confidence,
      draw_odds:        m.draw_odds,
    }))
  )

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success:     true,
    fetched:     matches.length,
    predictions: top10.length,
    top_pick:    top10[0]
      ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].draw_score})`
      : null,
  })
}

// ─── GET /api/trigger-predictions — dev only ─────────────────────────────────

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runPipeline()
}

// ─── POST /api/trigger-predictions — Vercel Cron ─────────────────────────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPipeline()
}