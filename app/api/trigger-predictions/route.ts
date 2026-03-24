// app/api/trigger-predictions/route.ts v5
//
// Changes over v4:
//   • Full diagnostic logging at every gate so you can see exactly how many
//     fixtures are dropped and why (no odds, not in league map, etc.).
//   • upsertLeague now logs a warning when the DB returns an unexpected error
//     instead of silently returning null and dropping the whole league.
//   • All league lookups use LEAGUE_ID_TO_INFO canonical country/name strings,
//     never raw API strings. This prevents duplicate league rows.
//   • Added summary stats at end of pipeline (fixtures fetched → tracked →
//     with-odds → mapped → scored → inserted) so you can see each drop point.
//   • Platt params load error is caught and falls back to defaults rather than
//     crashing the whole pipeline.

import { NextRequest, NextResponse } from 'next/server'
import { supabase, supabaseAdmin } from '@/lib/supabase'
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

// ─── League upsert ────────────────────────────────────────────────────────────

async function upsertLeague(
  name: string,
  country: string,
  avgDrawRate: number
): Promise<number | null> {
  // Check if league already exists (using canonical name + country from our map)
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('leagues')
    .select('id')
    .eq('name', name)
    .eq('country', country)
    .maybeSingle()

  if (findErr) {
    console.error(`[upsertLeague] find error for ${name} (${country}):`, findErr.message)
  }

  if (existing) return existing.id

  const { data, error } = await supabaseAdmin
    .from('leagues')
    .insert({ name, country, avg_draw_rate: avgDrawRate, draw_boost: 0 })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      // Race condition — inserted between our find and insert, fetch it
      const { data: retry, error: retryErr } = await supabaseAdmin
        .from('leagues')
        .select('id')
        .eq('name', name)
        .eq('country', country)
        .maybeSingle()
      if (retryErr) {
        console.error(`[upsertLeague] retry find error for ${name}:`, retryErr.message)
        return null
      }
      return retry?.id ?? null
    }
    console.error(`[upsertLeague] insert error for ${name} (${country}):`, error.message)
    return null
  }
  return data.id
}

// ─── Main fixture fetcher ─────────────────────────────────────────────────────

async function upsertTodayMatches(today: string): Promise<number> {
  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) throw new Error('API_FOOTBALL_KEY env var is not set')

  console.log(`[pipeline] Fetching all fixtures for ${today}…`)
  const allFixtures = await fetchFixturesForDate(apiKey, today)
  console.log(`[pipeline] Total fixtures from API: ${allFixtures.length}`)

  const tracked = allFixtures.filter(f => LEAGUE_ID_TO_INFO[f.league.id])
  const untracked = allFixtures.filter(f => !LEAGUE_ID_TO_INFO[f.league.id])

  console.log(`[pipeline] Tracked leagues: ${tracked.length} fixtures`)
  console.log(`[pipeline] Untracked leagues: ${untracked.length} fixtures`)

  // Log a sample of untracked leagues so you can add missing ones
  if (untracked.length > 0) {
    const untrackedSample = Array.from(new Map(
      untracked.map(f => [`${f.league.id}`, { id: f.league.id, name: f.league.name, country: f.league.country }])
    ).values()).slice(0, 10)
    console.log(`[pipeline] Untracked league sample:`, JSON.stringify(untrackedSample))
  }

  if (tracked.length === 0) {
    console.log(`[pipeline] No tracked fixtures for ${today}`)
    return 0
  }

  // Limit to 50 to respect API quota
  const toProcess = tracked.slice(0, 50)
  const fixtureIds = toProcess.map(f => `apifb_${f.fixture.id}`)

  // Load existing opening odds from DB to preserve line-movement tracking
  const { data: existingRows } = await supabaseAdmin
    .from('matches')
    .select('external_id, odds_open')
    .in('external_id', fixtureIds)

  const existingOpenOdds = new Map<string, number>(
    (existingRows ?? [])
      .filter(r => r.odds_open != null)
      .map(r => [r.external_id as string, r.odds_open as number])
  )

  console.log(`[pipeline] Fetching odds for ${toProcess.length} fixtures…`)
  const withOdds = await Promise.all(
    toProcess.map(async (fixture) => {
      const extId = `apifb_${fixture.fixture.id}`
      const drawOdds = await fetchOddsForFixture(apiKey, fixture.fixture.id)
      const openingOdds = existingOpenOdds.get(extId) ?? (drawOdds > 0 ? drawOdds : null)
      return { fixture, drawOdds, openingOdds }
    })
  )

  const fixturesWithOdds = withOdds.filter(({ drawOdds }) => drawOdds > 0)
  const droppedNoOdds = withOdds.filter(({ drawOdds }) => drawOdds <= 0)

  console.log(`[pipeline] Fixtures with valid odds: ${fixturesWithOdds.length}`)
  console.log(`[pipeline] Dropped (no odds): ${droppedNoOdds.length}`)
  if (droppedNoOdds.length > 0) {
    console.log(`[pipeline] No-odds fixture IDs: ${droppedNoOdds.map(f => f.fixture.fixture.id).join(', ')}`)
  }

  if (fixturesWithOdds.length === 0) {
    console.log(`[pipeline] No fixtures with odds — nothing to upsert`)
    return 0
  }

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

  console.log(`[pipeline] Fetching team stats for ${teamStatsPairs.length} team/league pairs…`)
  const statsMap = await getTeamStatsBatch(apiKey, teamStatsPairs, 35)

  console.log(`[pipeline] Fetching form stats…`)
  const formMap = await getFormStatsBatch(apiKey, teamStatsPairs, 15)

  console.log(`[pipeline] Fetching H2H for ${h2hPairs.length} pairs…`)
  const h2hMap = await getH2HBatch(apiKey, h2hPairs, 10)

  const mapped = fixturesWithOdds
    .map(({ fixture, drawOdds, openingOdds }) => {
      const homeKey  = cacheKey(fixture.teams.home.id, fixture.league.id, season)
      const awayKey  = cacheKey(fixture.teams.away.id, fixture.league.id, season)
      const pairKey  = h2hKey(fixture.teams.home.id, fixture.teams.away.id)
      const h2hStats = h2hMap.get(pairKey)

      const h2hResults = h2hStats?.isReal
        ? buildH2HFromStats(h2hStats, fixture.teams.home.id, fixture.teams.away.id)
        : undefined

      return mapFixtureWithStats(
        fixture,
        drawOdds,
        statsMap.get(homeKey) ?? null,
        statsMap.get(awayKey) ?? null,
        h2hResults,
        formMap.get(homeKey) ?? null,
        formMap.get(awayKey) ?? null,
        openingOdds
      )
    })
    .filter((m): m is MappedFixture => m !== null)

  console.log(`[pipeline] Valid mapped fixtures: ${mapped.length}`)

  if (mapped.length === 0) {
    console.log(`[pipeline] All fixtures were filtered out by mapFixtureWithStats`)
    return 0
  }

  // Group by league for batch upserts
  const byLeague = new Map<string, MappedFixture[]>()
  for (const m of mapped) {
    const key = `${m.league_name}::${m.league_country}`
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
    if (!leagueId) {
      console.error(`[pipeline] Could not get league ID for ${first.league_name} (${first.league_country}) — skipping ${matches.length} fixtures`)
      continue
    }

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
      console.error(`[pipeline] Upsert error for ${first.league_name} (${first.league_country}):`, error.message)
    } else {
      console.log(`[pipeline] Upserted ${rows.length} matches for ${first.league_name} (${first.league_country})`)
      totalUpserted += rows.length
    }
  }

  console.log(`[pipeline] Total matches upserted: ${totalUpserted}`)
  return totalUpserted
}

function buildH2HFromStats(
  stats: { drawRate: number; sampleSize: number; isReal: boolean },
  homeTeamId: number,
  awayTeamId: number
) {
  if (!stats.isReal || stats.sampleSize === 0) return undefined
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

  console.log(`\n[pipeline] ═══ START ${today} ═══`)

  // Load Platt calibration params
  let plattA = -1.0
  let plattB = 0.0
  try {
    const plattParams = await loadPlattParams()
    plattA = plattParams.a
    plattB = plattParams.b
    setPlattParams(plattA, plattB)
    console.log(`[pipeline] Platt params: a=${plattA}, b=${plattB}, calibrated=${plattParams.isCalibrated}`)
  } catch (err) {
    console.warn('[pipeline] Failed to load Platt params, using defaults:', err)
    setPlattParams(-1.0, 0.0)
  }

  let fetched = 0
  try {
    fetched = await upsertTodayMatches(today)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] Fetch/upsert failed:', message)
    // Continue — maybe matches were already upserted from an earlier run today
  }

  // Fetch all of today's matches from DB (regardless of status)
  const { data: matches, error: matchErr } = await supabaseAdmin
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)

  if (matchErr) {
    console.error('[pipeline] Matches query error:', matchErr.message)
    return NextResponse.json({ error: matchErr.message }, { status: 500 })
  }

  if (!matches || matches.length === 0) {
    const msg = `No matches in DB for ${today}. Fetched: ${fetched} rows. Check API quota and league filter.`
    console.error(`[pipeline] ${msg}`)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  console.log(`[pipeline] Scoring ${matches.length} matches from DB…`)

  // Score every match
  const scored = matches.map((match) => {
    const features: DrawFeatures = {
      xgHome:            match.xg_home       ?? 1.2,
      xgAway:            match.xg_away       ?? 1.2,
      homeGoalsAvg:      match.home_goals_avg ?? 1.4,
      awayGoalsAvg:      match.away_goals_avg ?? 1.4,
      homeConcedeAvg:    match.home_concede_avg ?? 1.2,
      awayConcedeAvg:    match.away_concede_avg ?? 1.2,
      homeDrawRate:      match.home_draw_rate   ?? 0.27,
      awayDrawRate:      match.away_draw_rate   ?? 0.27,
      h2hDrawRate:       match.h2h_draw_rate    ?? 0.27,
      h2hIsReal:         match.h2h_is_real ?? false,
      drawOdds:          match.draw_odds ?? 3.2,
      homeOdds:          0,
      awayOdds:          0,
      oddsMovement:      match.odds_movement ?? undefined,
      oddsOpenDraw:      match.odds_open ?? undefined,
      homeFormDrawRate:  match.home_form_draw_rate ?? undefined,
      awayFormDrawRate:  match.away_form_draw_rate ?? undefined,
      homeFormGoalsAvg:  match.home_form_goals_avg ?? undefined,
      awayFormGoalsAvg:  match.away_form_goals_avg ?? undefined,
      homeGamesLast14:   match.home_games_last14 ?? undefined,
      awayGamesLast14:   match.away_games_last14 ?? undefined,
      leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
      leagueDrawBoost:   match.leagues?.draw_boost ?? 0,
    }
    const prediction = predictDraw(features)
    return { ...match, ...prediction }
  })

  // Write scores back to matches table
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
  console.log(`[pipeline] Updated draw_score / probability / confidence on ${scored.length} matches`)

  // Clear today's predictions and rebuild
  const { error: deleteErr } = await supabaseAdmin
    .from('predictions')
    .delete()
    .eq('prediction_date', today)

  if (deleteErr) {
    console.error('[pipeline] Delete predictions error:', deleteErr.message)
  } else {
    console.log(`[pipeline] Cleared existing predictions for ${today}`)
  }

  // Sort with tiebreaks
  const oddsQuality = (odds: number) => {
    if (odds >= 3.0 && odds <= 3.4) return 3
    if (odds >= 2.8 && odds < 3.0)  return 2
    if (odds > 3.4 && odds <= 3.7)  return 1
    return 0
  }

  const top10 = [...scored]
    .sort((a, b) => {
      if (Math.abs(b.drawScore - a.drawScore) > 0.05) return b.drawScore - a.drawScore
      const oddsQ = oddsQuality(b.draw_odds ?? 0) - oddsQuality(a.draw_odds ?? 0)
      if (oddsQ !== 0) return oddsQ
      const aReal = (a as any).has_real_team_stats ? 1 : 0
      const bReal = (b as any).has_real_team_stats ? 1 : 0
      return bReal - aReal
    })
    .slice(0, 10)

  console.log(`[pipeline] Top 10 scores: ${top10.map(m => m.drawScore.toFixed(2)).join(', ')}`)

  const insertRows = top10.map((m, i) => ({
    match_id:         m.id,
    prediction_date:  today,
    rank:             i + 1,
    draw_score:       m.drawScore,
    draw_probability: m.probability,
    confidence:       m.confidence,
    draw_odds:        Number(m.draw_odds ?? 0),
  }))

  console.log(`[pipeline] Inserting ${insertRows.length} predictions…`)

  const { error: insertErr } = await supabaseAdmin
    .from('predictions')
    .insert(insertRows)

  if (insertErr) {
    console.error('[pipeline] Insert predictions error:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const topPick = top10[0]
    ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].drawScore})`
    : null

  console.log(`[pipeline] ═══ DONE — ${top10.length} predictions inserted ═══\n`)

  return NextResponse.json({
    success:     true,
    fetched,
    predictions: top10.length,
    top_pick:    topPick,
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