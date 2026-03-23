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

/**
 * Upsert a league row and return its id.
 * avg_draw_rate and draw_boost are seeded from the odds-api baseline data.
 */
async function upsertLeague(
  name: string,
  country: string,
  avgDrawRate: number
): Promise<number | null> {
  const { data, error } = await supabase
    .from('leagues')
    .upsert(
      { name, country, avg_draw_rate: avgDrawRate, draw_boost: 0 },
      { onConflict: 'name' }           // assumes name is unique
    )
    .select('id')
    .single()

  if (error) {
    console.error(`[upsertLeague] ${name}:`, error.message)
    return null
  }
  return data.id
}

/**
 * Upsert today's match rows sourced from The Odds API.
 * Uses external_id for idempotency so re-runs don't create duplicates.
 * Returns the inserted/updated match ids.
 */
async function upsertMatches(targetDate: string): Promise<void> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) throw new Error('ODDS_API_KEY env var is not set')

  const events    = await fetchMatchesForDate(apiKey, `${targetDate}T00:00:00Z`, `${targetDate}T23:59:59Z`)
  const mappedAll = events
    .map(mapEventToMatch)
    .filter((m): m is MappedMatch => m !== null)

  if (mappedAll.length === 0) {
    console.log(`[upsertMatches] No events with odds found for ${targetDate}.`)
    return
  }

  // Group by league so we can upsert leagues first
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
      first.home_draw_rate  // use team draw rate as proxy for league avg
    )
    if (!leagueId) continue

    const rows = matches.map((m: MappedMatch) => ({
      league_id:          leagueId,
      home_team_name:     m.home_team_name,
      away_team_name:     m.away_team_name,
      match_date:         m.match_date,
      draw_odds:          m.draw_odds,
      xg_home:            m.xg_home,
      xg_away:            m.xg_away,
      home_goals_avg:     m.home_goals_avg,
      away_goals_avg:     m.away_goals_avg,
      home_concede_avg:   m.home_concede_avg,
      away_concede_avg:   m.away_concede_avg,
      home_draw_rate:     m.home_draw_rate,
      away_draw_rate:     m.away_draw_rate,
      h2h_draw_rate:      m.h2h_draw_rate,
      draw_score:         0,
      draw_probability:   0,
      confidence:         0,
      status:             'scheduled',
      external_id:        m.external_id,
    }))

    const { error } = await supabase
      .from('matches')
      .upsert(rows, { onConflict: 'external_id' })   // idempotent re-runs

    if (error) {
    console.error(`[upsertMatches] league ${leagueName}:`, error.message)
  } else {
    console.log(`[upsertMatches] Upserted ${rows.length} matches for ${leagueName}`)
  }
  }
}

// ─── POST /api/trigger-predictions ───────────────────────────────────────────
// Called daily by Vercel Cron at 07:00 UTC (vercel.json).
// Flow:
//   1. Fetch today's matches + odds from The Odds API → upsert into matches table
//   2. Score every match with the draw algorithm
//   3. Insert top 10 as predictions for today

export async function POST(req: NextRequest) {
  // ── Auth ──────────────────────────────────────────────────────────────────
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const { searchParams } = new URL(req.url)
  const dateParam = searchParams.get('date')
  const targetDate = dateParam || new Date().toISOString().split('T')[0]

  try {
    // ── Step 1: Fetch & upsert today's matches from The Odds API ─────────
    console.log(`[trigger-predictions] Step 1: fetching matches for ${targetDate} from Odds API…`)
    await upsertMatches(targetDate)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[trigger-predictions] Odds API fetch failed:', message)
    // Don't abort — fall through to score whatever is already in the DB
  }

  // ── Step 2: Load today's scheduled matches ────────────────────────────
  const { data: matches, error: matchErr } = await supabase
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .gte('match_date', `${targetDate}T00:00:00`)
    .lte('match_date', `${targetDate}T23:59:59`)
    .eq('status', 'scheduled')

  if (matchErr || !matches || matches.length === 0) {
    return NextResponse.json(
      { error: matchErr?.message ?? `No matches found for ${targetDate}` },
      { status: 500 }
    )
  }

  // ── Step 3: Score every match ─────────────────────────────────────────
  const scored = matches.map((match) => {
    const drawScore       = calculateDrawScore(match as any)
    const drawProbability = calculateDrawProbability(match.xg_home, match.xg_away)
    const confidence      = scoreToConfidence(drawScore)
    return { ...match, draw_score: drawScore, draw_probability: drawProbability, confidence }
  })

  // ── Step 4: Persist scores back to matches ────────────────────────────
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

  // ── Step 5: Re-insert top 10 predictions ─────────────────────────────
  await supabase.from('predictions').delete().eq('prediction_date', targetDate)

  const top10 = [...scored]
    .sort((a, b) => b.draw_score - a.draw_score)
    .slice(0, 10)

  const { error: insertErr } = await supabase.from('predictions').insert(
    top10.map((m, i) => ({
      match_id:         m.id,
      prediction_date:  targetDate,
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
    date:        targetDate,
    fetched:     matches.length,
    predictions: top10.length,
    top_pick:    top10[0]
      ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].draw_score})`
      : null,
  })
}