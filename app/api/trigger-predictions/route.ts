// app/api/trigger-predictions/route.ts v2
//
// Enhanced pipeline:
//   Budget: 1 (fixtures) + ≤50 (odds) + ≤35 (team stats) + ≤15 (form) + ≤10 (H2H) = ≤111
//   Use warm-team-cache the night before to pre-fill team stats so the
//   daily budget for team stats drops to near zero.
//
//   New features active in this pipeline:
//     • Real H2H draw rate (weighted, recent-biased)
//     • Weighted form streaks (last 5 games)
//     • Fatigue proxy (games in last 14 days)
//     • Opening odds stored → line movement computed at prediction time
//     • Unified drawEngine v3 replaces both old scoring functions
//     • Platt scaling loaded from DB (no-op until calibrated)
//     • Better top-10 tiebreak: sweet-spot odds within score ties

import { NextRequest, NextResponse } from 'next/server'
import {
  supabase,
  supabaseAdmin,
} from '@/lib/supabase'
import {
  fetchFixturesForDate,
  fetchOddsForFixture,
  mapFixtureWithStats,
  LEAGUE_ID_TO_INFO,
  type MappedFixture,
} from '@/lib/api-football'
import {
  getTeamStatsBatch,
  getFormStatsBatch,
  getH2HBatch,
  cacheKey,
  h2hKey,
  currentSeason,
  loadPlattParams,
} from '@/lib/team-stats-cache'
import {
  predictDraw,
  setPlattParams,
  type DrawFeatures,
} from '@/lib/drawEngine'

// ─── League upsert (unchanged) ────────────────────────────────────────────────

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

  if (error) { console.error(`[upsertLeague] ${name}:`, error.message); return null }
  return data.id
}

// ─── Main fixture fetcher (v2) ────────────────────────────────────────────────

async function upsertTodayMatches(today: string): Promise<number> {
  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) throw new Error('API_FOOTBALL_KEY env var is not set')

  // ── 1. Fixtures (1 call) ──────────────────────────────────────────────────
  console.log(`[pipeline] Fetching fixtures for ${today}…`)
  const fixtures = await fetchFixturesForDate(apiKey, today)
  const tracked = fixtures.filter(f => LEAGUE_ID_TO_INFO[f.league.id])
  console.log(`[pipeline] ${tracked.length} tracked fixtures`)
  if (tracked.length === 0) return 0

  // ── 2. Odds — store opening odds too (≤50 calls) ──────────────────────────
  const withOdds = await Promise.all(
    tracked.slice(0, 50).map(async (fixture) => {
      const drawOdds = await fetchOddsForFixture(apiKey, fixture.fixture.id)
      return { fixture, drawOdds, openingOdds: drawOdds }  // opening = first fetch of the day
    })
  )
  const fixturesWithOdds = withOdds.filter(({ drawOdds }) => drawOdds > 0)
  console.log(`[pipeline] ${fixturesWithOdds.length} fixtures with odds`)

  // ── 3. Unique team/league pairs for batch fetches ─────────────────────────
  const season = currentSeason()
  const seenPairs = new Set<string>()
  const teamStatsPairs: Array<{ teamId: number; leagueId: number; season: number }> = []
  const h2hPairs: Array<{ homeTeamId: number; awayTeamId: number }> = []

  for (const { fixture } of fixturesWithOdds) {
    for (const teamId of [fixture.teams.home.id, fixture.teams.away.id]) {
      const key = cacheKey(teamId, fixture.league.id, season)
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        teamStatsPairs.push({ teamId, leagueId: fixture.league.id, season })
      }
    }
    h2hPairs.push({
      homeTeamId: fixture.teams.home.id,
      awayTeamId: fixture.teams.away.id,
    })
  }

  // ── 4. Team stats (≤35 fresh API calls, rest from cache) ─────────────────
  console.log(`[pipeline] Fetching team stats for ${teamStatsPairs.length} pairs…`)
  const statsMap = await getTeamStatsBatch(apiKey, teamStatsPairs, 35)

  // ── 5. Form stats (≤15 fresh API calls) ───────────────────────────────────
  console.log(`[pipeline] Fetching form stats…`)
  const formMap = await getFormStatsBatch(apiKey, teamStatsPairs, 15)

  // ── 6. H2H (≤10 fresh API calls) ─────────────────────────────────────────
  console.log(`[pipeline] Fetching H2H data for ${h2hPairs.length} pairs…`)
  const h2hMap = await getH2HBatch(apiKey, h2hPairs, 10)

  // ── 7. Map fixtures to DB rows ────────────────────────────────────────────
  const mapped = fixturesWithOdds
    .map(({ fixture, drawOdds, openingOdds }) => {
      const homeKey  = cacheKey(fixture.teams.home.id, fixture.league.id, season)
      const awayKey  = cacheKey(fixture.teams.away.id, fixture.league.id, season)
      const pairKey  = h2hKey(fixture.teams.home.id, fixture.teams.away.id)
      const h2hStats = h2hMap.get(pairKey)

      const h2hResults = h2hStats?.isReal
        ? [{
            fixtureId: 0,
            date: new Date().toISOString(),
            homeTeamId: fixture.teams.home.id,
            awayTeamId: fixture.teams.away.id,
            homeGoals: 0, awayGoals: 0,
            isDraw: false,
            // pass the already-computed draw rate via the stats struct
          }]
        : undefined

      return mapFixtureWithStats(
        fixture,
        drawOdds,
        statsMap.get(homeKey) ?? null,
        statsMap.get(awayKey) ?? null,
        h2hStats?.isReal ? buildH2HFromStats(h2hStats, fixture.teams.home.id, fixture.teams.away.id) : undefined,
        formMap.get(homeKey) ?? null,
        formMap.get(awayKey) ?? null,
        openingOdds
      )
    })
    .filter((m): m is MappedFixture => m !== null)

  console.log(`[pipeline] ${mapped.length} valid mapped fixtures`)

  // ── 8. Group by league and upsert ─────────────────────────────────────────
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
      league_id:            leagueId,
      home_team_name:       m.home_team_name,
      away_team_name:       m.away_team_name,
      match_date:           m.match_date,
      draw_odds:            m.draw_odds,
      xg_home:              m.xg_home,
      xg_away:              m.xg_away,
      home_goals_avg:       m.home_goals_avg,
      away_goals_avg:       m.away_goals_avg,
      home_concede_avg:     m.home_concede_avg,
      away_concede_avg:     m.away_concede_avg,
      home_draw_rate:       m.home_draw_rate,
      away_draw_rate:       m.away_draw_rate,
      h2h_draw_rate:        m.h2h_draw_rate,
      h2h_is_real:          m.h2h_is_real,
      home_form_draw_rate:  m.home_form_draw_rate,
      away_form_draw_rate:  m.away_form_draw_rate,
      home_form_goals_avg:  m.home_form_goals_avg,
      away_form_goals_avg:  m.away_form_goals_avg,
      home_games_last14:    m.home_games_last14,
      away_games_last14:    m.away_games_last14,
      odds_open:            m.odds_open,
      odds_movement:        m.odds_movement,
      draw_score:           0,
      draw_probability:     0,
      confidence:           0,
      status:               'scheduled',
      external_id:          m.external_id,
      home_team_ext_id:     m.home_team_id,
      away_team_ext_id:     m.away_team_id,
      league_ext_id:        m.league_id_ext,
      has_real_team_stats:  m.has_real_team_stats,
    }))

    const { error } = await supabaseAdmin
      .from('matches')
      .upsert(rows, { onConflict: 'external_id' })

    if (error) {
      console.error(`[pipeline] upsert error for ${first.league_name}:`, error.message)
    } else {
      console.log(`[pipeline] upserted ${rows.length} for ${first.league_name}`)
      totalUpserted += rows.length
    }
  }

  return totalUpserted
}

// Build synthetic H2H fixture array from cached stats for mapFixtureWithStats
function buildH2HFromStats(
  stats: { drawRate: number; sampleSize: number; isReal: boolean },
  homeTeamId: number,
  awayTeamId: number
) {
  if (!stats.isReal || stats.sampleSize === 0) return undefined
  // Reconstruct synthetic fixtures that yield the stored draw rate
  const total = Math.min(stats.sampleSize, 10)
  const draws = Math.round(stats.drawRate * total)
  return Array.from({ length: total }, (_, i) => ({
    fixtureId: i,
    date: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000).toISOString(),
    homeTeamId,
    awayTeamId,
    homeGoals: i < draws ? 1 : 1,
    awayGoals: i < draws ? 1 : 0,
    isDraw:    i < draws,
  }))
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function runPipeline(): Promise<NextResponse> {
  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  // Load Platt calibration params (no-op if not yet calibrated)
  const { a, b } = await loadPlattParams()
  setPlattParams(a, b)
  console.log(`[pipeline] Platt params loaded: a=${a}, b=${b}`)

  let fetched = 0
  try {
    fetched = await upsertTodayMatches(today)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] fetch failed:', message)
  }

  // Fetch all of today's scheduled matches with league info
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

  // Score every match using the unified drawEngine v3
  const scored = matches.map((match) => {
    const features: DrawFeatures = {
      xgHome: match.xg_home,
      xgAway: match.xg_away,
      homeGoalsAvg: match.home_goals_avg,
      awayGoalsAvg: match.away_goals_avg,
      homeConcedeAvg: match.home_concede_avg,
      awayConcedeAvg: match.away_concede_avg,
      homeDrawRate: match.home_draw_rate,
      awayDrawRate: match.away_draw_rate,
      h2hDrawRate: match.h2h_draw_rate,
      h2hIsReal: match.h2h_is_real ?? false,
      drawOdds: match.draw_odds,
      homeOdds: 0,  // not stored — could add later
      awayOdds: 0,
      oddsMovement: match.odds_movement ?? undefined,
      oddsOpenDraw: match.odds_open ?? undefined,
      homeFormDrawRate: match.home_form_draw_rate ?? undefined,
      awayFormDrawRate: match.away_form_draw_rate ?? undefined,
      homeFormGoalsAvg: match.home_form_goals_avg ?? undefined,
      awayFormGoalsAvg: match.away_form_goals_avg ?? undefined,
      homeGamesLast14: match.home_games_last14 ?? undefined,
      awayGamesLast14: match.away_games_last14 ?? undefined,
      leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
      leagueDrawBoost: match.leagues?.draw_boost ?? 0,
    }

    const prediction = predictDraw(features)
    return { ...match, ...prediction }
  })

  // Persist scores back to matches table
  await Promise.all(
    scored.map((m) =>
      supabaseAdmin
        .from('matches')
        .update({
          draw_score:       m.drawScore,
          draw_probability: m.probability,
          confidence:       m.confidence,
        })
        .eq('id', m.id)
    )
  )

  // Clear today's predictions and rebuild
  await supabaseAdmin
    .from('predictions')
    .delete()
    .eq('prediction_date', today)

  // Sort: primary = drawScore DESC
  // Tiebreak 1: sweet-spot odds (3.0–3.4 > 2.8–3.0 > rest)
  // Tiebreak 2: real team stats > estimated
  const oddsQuality = (odds: number) => {
    if (odds >= 3.0 && odds <= 3.4) return 3
    if (odds >= 2.8 && odds < 3.0)  return 2
    if (odds > 3.4 && odds <= 3.7)  return 1
    return 0
  }

  const top10 = [...scored]
    .sort((a, b) => {
      if (Math.abs(b.drawScore - a.drawScore) > 0.05) return b.drawScore - a.drawScore
      const oddsQ = oddsQuality(b.draw_odds) - oddsQuality(a.draw_odds)
      if (oddsQ !== 0) return oddsQ
      const aReal = (a as any).has_real_team_stats ? 1 : 0
      const bReal = (b as any).has_real_team_stats ? 1 : 0
      return bReal - aReal
    })
    .slice(0, 10)

  const { error: insertErr } = await supabaseAdmin
    .from('predictions')
    .insert(
      top10.map((m, i) => ({
        match_id:         m.id,
        prediction_date:  today,
        rank:             i + 1,
        draw_score:       m.drawScore,
        draw_probability: m.probability,
        confidence:       m.confidence,
        draw_odds:        m.draw_odds,
      }))
    )

  if (insertErr) {
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  return NextResponse.json({
    success:     true,
    fetched,
    predictions: top10.length,
    top_pick:    top10[0]
      ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].drawScore})`
      : null,
  })
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runPipeline()
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runPipeline()
}