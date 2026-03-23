import { NextRequest, NextResponse } from 'next/server'
import {
  supabase,
  supabaseAdmin,
  calculateDrawScore,
  calculateDrawProbability,
  scoreToConfidence,
} from '@/lib/supabase'
import {
  fetchFixturesForDate,
  fetchOddsForFixture,
  mapFixture,
  LEAGUE_ID_TO_INFO,
  type MappedFixture,
} from '@/lib/api-football'

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function upsertLeague(
  name: string,
  country: string,
  avgDrawRate: number
): Promise<number | null> {
  const { data, error } = await supabaseAdmin
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

async function upsertTodayMatches(today: string): Promise<number> {
  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) throw new Error('API_FOOTBALL_KEY env var is not set')

  console.log(`[pipeline] Fetching fixtures for ${today} from API-Football…`)

  // Single request fetches ALL leagues for the date
  const fixtures = await fetchFixturesForDate(apiKey, today)
  console.log(`[pipeline] Got ${fixtures.length} total fixtures from API-Football`)

  // Filter to only our tracked leagues
  const tracked = fixtures.filter(f => LEAGUE_ID_TO_INFO[f.league.id])
  console.log(`[pipeline] ${tracked.length} fixtures in tracked leagues`)

  if (tracked.length === 0) return 0

  // Fetch odds for each fixture (batched, respects rate limits)
  // On free tier: 100 req/day. We use 1 for fixtures + up to 99 for odds.
  // Limit to 50 fixtures for odds to be safe, rest get fallback odds.
  const withOdds = await Promise.all(
    tracked.slice(0, 50).map(async (fixture) => {
      const drawOdds = await fetchOddsForFixture(apiKey, fixture.fixture.id)
      return { fixture, drawOdds }
    })
  )

  // Map remaining fixtures with fallback odds
  const remaining = tracked.slice(50).map(fixture => ({ fixture, drawOdds: 3.2 }))
  const all = [...withOdds, ...remaining]

  // Map and filter
  const mapped = all
    .map(({ fixture, drawOdds }) => mapFixture(fixture, drawOdds))
    .filter((m): m is MappedFixture => m !== null)

  console.log(`[pipeline] ${mapped.length} valid mapped fixtures`)

  // Group by league and upsert
  const byLeague = new Map<string, MappedFixture[]>()
  for (const m of mapped) {
    const key = `${m.league_name}:${m.league_country}`
    if (!byLeague.has(key)) byLeague.set(key, [])
    byLeague.get(key)!.push(m)
  }

  let totalUpserted = 0

  for (const [, matches] of Array.from(byLeague)) {
    const first = matches[0]
    if (!first) continue

    const leagueInfo = LEAGUE_ID_TO_INFO[first.league_id_ext]
    if (!leagueInfo) continue

    const leagueId = await upsertLeague(
      first.league_name,
      first.league_country,
      leagueInfo.avgDrawRate
    )
    if (!leagueId) continue

    const rows = matches.map((m) => ({
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

    const { error } = await supabaseAdmin
      .from('matches')
      .upsert(rows, { onConflict: 'external_id' })

    if (error) {
      console.error(`[pipeline] upsert error for ${first.league_name}:`, error.message)
    } else {
      console.log(`[pipeline] Upserted ${rows.length} matches for ${first.league_name}`)
      totalUpserted += rows.length
    }
  }

  return totalUpserted
}

// ─── Shared pipeline logic ────────────────────────────────────────────────────

async function runPipeline(): Promise<NextResponse> {
  const now = new Date()
  const today = `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`

  let fetched = 0

  try {
    fetched = await upsertTodayMatches(today)
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] fetch failed:', message)
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
      supabaseAdmin
        .from('matches')
        .update({
          draw_score:       m.draw_score,
          draw_probability: m.draw_probability,
          confidence:       m.confidence,
        })
        .eq('id', m.id)
    )
  )

  await supabaseAdmin
    .from('predictions')
    .delete()
    .eq('prediction_date', today)

  const top10 = [...scored]
    .sort((a, b) => b.draw_score - a.draw_score)
    .slice(0, 10)

  const { error: insertErr } = await supabaseAdmin
    .from('predictions')
    .insert(
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
    fetched:     fetched,
    predictions: top10.length,
    top_pick:    top10[0]
      ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].draw_score})`
      : null,
  })
}

// ─── GET — dev only ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runPipeline()
}

// ─── POST — Vercel Cron ───────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPipeline()
}