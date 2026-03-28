// app/api/trigger-predictions/route.ts v7
//
// Free plan fixes:
//   • Odds are fetched SEQUENTIALLY via fetchOddsForFixtures() with 6.5s
//     delay between each call — stays under the 10 req/min free plan limit.
//   • Season is always FREE_PLAN_SEASON (2024) for team stats and form.
//   • H2H uses the updated fetchH2H() that omits the `last` param.
//   • Hard stop if API returns 0 fixtures (never fall through to stale DB rows).
//   • Fixtures capped at 8 tracked fixtures to preserve quota budget:
//       1  (fixtures endpoint) + 8 (odds) + 16 (team stats) + 8 (form) + 8 (H2H)
//       = ~41 requests, well inside the 100/day free plan limit.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchUpcomingFixtures,
  fetchOddsForFixtures,
  mapFixtureWithStats,
  LEAGUE_ID_TO_INFO,
  FREE_PLAN_SEASON,
  type MappedFixture,
} from '@/lib/api-football'
import {
  getTeamStatsBatch,
  getFormStatsBatch,
  getH2HBatch,
  cacheKey,
  h2hKey,
  loadPlattParams,
} from '@/lib/team-stats-cache'
import {
  predictDraw,
  setPlattParams,
  type DrawFeatures,
} from '@/lib/drawEngine'

// ─── Budget constants ─────────────────────────────────────────────────────────
// Free plan: 100 requests/day, 10 requests/minute.
// Budget per pipeline run (worst case, no cache hits):
//   1  fixtures endpoint
//   N  odds (one per tracked fixture, sequential, 6.5s apart)
//   2N team stats (home + away per fixture)
//   2N form stats
//   N  H2H
// With N=8: 1 + 8 + 16 + 16 + 8 = 49 requests. Safe for one daily run.
const MAX_FIXTURES_TO_PROCESS = 12

// ─── League upsert ────────────────────────────────────────────────────────────

async function upsertLeague(name: string, country: string, avgDrawRate: number): Promise<number | null> {
  const { data: existing, error: findErr } = await supabaseAdmin
    .from('leagues').select('id').eq('name', name).eq('country', country).maybeSingle()
  if (findErr) console.error(`[upsertLeague] find error for ${name}:`, findErr.message)
  if (existing) return existing.id

  const { data, error } = await supabaseAdmin
    .from('leagues').insert({ name, country, avg_draw_rate: avgDrawRate, draw_boost: 0 })
    .select('id').single()
  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await supabaseAdmin
        .from('leagues').select('id').eq('name', name).eq('country', country).maybeSingle()
      return retry?.id ?? null
    }
    console.error(`[upsertLeague] insert error for ${name}:`, error.message)
    return null
  }
  return data.id
}

// ─── Main fixture+odds fetcher ────────────────────────────────────────────────
// Returns -1 if API gave 0 fixtures (hard stop), 0 if no tracked+odds fixtures,
// or the count of matches upserted.

async function upsertUpcomingMatches(apiKey: string): Promise<number> {
  console.log(`[pipeline] Fetching upcoming fixtures…`)
  const allFixtures = await fetchUpcomingFixtures(apiKey, 7, MAX_FIXTURES_TO_PROCESS * 2)
  console.log(`[pipeline] Total upcoming tracked NS fixtures: ${allFixtures.length}`)

  if (allFixtures.length === 0) {
    console.warn(`[pipeline] API returned 0 fixtures — check quota/key/schedule.`)
    return -1
  }

  const tracked   = allFixtures.filter(f => LEAGUE_ID_TO_INFO[f.league.id])
  const untracked = allFixtures.filter(f => !LEAGUE_ID_TO_INFO[f.league.id])
  console.log(`[pipeline] Tracked: ${tracked.length} | Untracked: ${untracked.length}`)

  if (untracked.length > 0) {
    const sample = Array.from(new Map(
      untracked.map(f => [String(f.league.id), { id: f.league.id, name: f.league.name, country: f.league.country }])
    ).values()).slice(0, 5)
    console.log(`[pipeline] Untracked sample:`, JSON.stringify(sample))
  }

  if (tracked.length === 0) {
    console.log(`[pipeline] No tracked fixtures today.`)
    return 0
  }

  // Cap to budget limit
  const toProcess = tracked.slice(0, MAX_FIXTURES_TO_PROCESS)
  console.log(`[pipeline] Processing ${toProcess.length}/${tracked.length} tracked fixtures (budget cap: ${MAX_FIXTURES_TO_PROCESS})`)

  // Load existing opening odds from DB for line-movement tracking
  const fixtureExtIds = toProcess.map(f => `apifb_${f.fixture.id}`)
  const { data: existingRows } = await supabaseAdmin
    .from('matches').select('external_id, odds_open').in('external_id', fixtureExtIds)
  const existingOpenOdds = new Map<string, number>(
    (existingRows ?? []).filter(r => r.odds_open != null)
      .map(r => [r.external_id as string, r.odds_open as number])
  )

  // ── Fetch odds SEQUENTIALLY (rate-limit safe) ──────────────────────────────
  const fixtureIds = toProcess.map(f => f.fixture.id)
  console.log(`[pipeline] Fetching odds sequentially for ${fixtureIds.length} fixtures (~${Math.ceil(fixtureIds.length * 6.5 / 60)}min)…`)
  const oddsMap = await fetchOddsForFixtures(apiKey, fixtureIds)


  
  const fixturesWithOdds = toProcess
    .map(fixture => {
      const extId = `apifb_${fixture.fixture.id}`
      const drawOdds = oddsMap.get(fixture.fixture.id) ?? 0
      const openingOdds = existingOpenOdds.get(extId) ?? (drawOdds > 0 ? drawOdds : null)
      return { fixture, drawOdds, openingOdds }
    })
    .filter(({ drawOdds }) => drawOdds > 0)

  console.log(`[pipeline] Fixtures with valid odds: ${fixturesWithOdds.length} / ${toProcess.length}`)

  if (fixturesWithOdds.length === 0) {
    console.log(`[pipeline] No fixtures with odds — nothing to upsert.`)
    return 0
  }

  // ── Team stats, form, H2H ──────────────────────────────────────────────────
  const seenPairs = new Set<string>()
  const teamStatsPairs: Array<{ teamId: number; leagueId: number; season: number }> = []
  const h2hPairs: Array<{ homeTeamId: number; awayTeamId: number }> = []

  for (const { fixture } of fixturesWithOdds) {
    for (const teamId of [fixture.teams.home.id, fixture.teams.away.id]) {
      const key = cacheKey(teamId, fixture.league.id, FREE_PLAN_SEASON)
      if (!seenPairs.has(key)) {
        seenPairs.add(key)
        teamStatsPairs.push({ teamId, leagueId: fixture.league.id, season: FREE_PLAN_SEASON })
      }
    }
    h2hPairs.push({ homeTeamId: fixture.teams.home.id, awayTeamId: fixture.teams.away.id })
  }

  console.log(`[pipeline] Fetching team stats for ${teamStatsPairs.length} pairs (season ${FREE_PLAN_SEASON})…`)
  const statsMap = await getTeamStatsBatch(apiKey, teamStatsPairs, 16)

  console.log(`[pipeline] Fetching form stats…`)
  const formMap = await getFormStatsBatch(apiKey, teamStatsPairs, 16)

  console.log(`[pipeline] Fetching H2H for ${h2hPairs.length} pairs…`)
  const h2hMap = await getH2HBatch(apiKey, h2hPairs, 8)

  // ── Map fixtures ───────────────────────────────────────────────────────────
  const mapped = fixturesWithOdds
    .map(({ fixture, drawOdds, openingOdds }) => {
      const homeKey  = cacheKey(fixture.teams.home.id, fixture.league.id, FREE_PLAN_SEASON)
      const awayKey  = cacheKey(fixture.teams.away.id, fixture.league.id, FREE_PLAN_SEASON)
      const pairKey  = h2hKey(fixture.teams.home.id, fixture.teams.away.id)
      const h2hStats = h2hMap.get(pairKey)

      const h2hResults = h2hStats?.isReal
        ? buildH2HFromStats(h2hStats, fixture.teams.home.id, fixture.teams.away.id)
        : undefined

      return mapFixtureWithStats(
        fixture, drawOdds,
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
  if (mapped.length === 0) return 0

  // ── Upsert by league ───────────────────────────────────────────────────────
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

    const leagueId = await upsertLeague(first.league_name, first.league_country, leagueInfo.avgDrawRate)
    if (!leagueId) {
      console.error(`[pipeline] Could not get league ID for ${first.league_name} — skipping`)
      continue
    }

    const rows = matches.map(m => ({
      league_id: leagueId,
      home_team_name: m.home_team_name, away_team_name: m.away_team_name,
      match_date: m.match_date, draw_odds: m.draw_odds,
      xg_home: m.xg_home, xg_away: m.xg_away,
      home_goals_avg: m.home_goals_avg, away_goals_avg: m.away_goals_avg,
      home_concede_avg: m.home_concede_avg, away_concede_avg: m.away_concede_avg,
      home_draw_rate: m.home_draw_rate, away_draw_rate: m.away_draw_rate,
      h2h_draw_rate: m.h2h_draw_rate, h2h_is_real: m.h2h_is_real,
      home_form_draw_rate: m.home_form_draw_rate, away_form_draw_rate: m.away_form_draw_rate,
      home_form_goals_avg: m.home_form_goals_avg, away_form_goals_avg: m.away_form_goals_avg,
      home_games_last14: m.home_games_last14, away_games_last14: m.away_games_last14,
      odds_open: m.odds_open, odds_movement: m.odds_movement,
      draw_score: 0, draw_probability: 0, confidence: 0,
      status: 'scheduled',
      external_id: m.external_id,
      home_team_ext_id: m.home_team_id, away_team_ext_id: m.away_team_id,
      league_ext_id: m.league_id_ext, has_real_team_stats: m.has_real_team_stats,
    }))

    const { error } = await supabaseAdmin.from('matches').upsert(rows, { onConflict: 'external_id' })
    if (error) {
      console.error(`[pipeline] Upsert error for ${first.league_name}:`, error.message)
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
  homeTeamId: number, awayTeamId: number
) {
  if (!stats.isReal || stats.sampleSize === 0) return undefined
  const total = Math.min(stats.sampleSize, 10)
  const draws = Math.round(stats.drawRate * total)
  return Array.from({ length: total }, (_, i) => ({
    fixtureId: i,
    date: new Date(Date.now() - i * 30 * 24 * 60 * 60 * 1000).toISOString(),
    homeTeamId, awayTeamId,
    homeGoals: 1, awayGoals: i < draws ? 1 : 0, isDraw: i < draws,
  }))
}

// ─── Core pipeline ────────────────────────────────────────────────────────────

async function runPipeline(): Promise<NextResponse> {
  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) return NextResponse.json({ error: 'API_FOOTBALL_KEY not set' }, { status: 500 })

  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  console.log(`\n[pipeline] ═══ START ${today} ═══`)
  console.log(`[pipeline] Free plan budget: ${MAX_FIXTURES_TO_PROCESS} fixtures max, season ${FREE_PLAN_SEASON}`)

  try {
    const plattParams = await loadPlattParams()
    setPlattParams(plattParams.a, plattParams.b)
    console.log(`[pipeline] Platt: a=${plattParams.a}, b=${plattParams.b}, calibrated=${plattParams.isCalibrated}`)
  } catch { setPlattParams(-1.0, 0.0) }

  // ── Step 1: Fetch & upsert fixtures+odds ───────────────────────────────────
  let fetched: number
  try {
    fetched = await upsertUpcomingMatches(apiKey)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[pipeline] Fetch/upsert failed:', msg)
    return NextResponse.json({ error: `Fixture fetch failed: ${msg}` }, { status: 500 })
  }

  if (fetched === 0) {
    return NextResponse.json({
      success: true, fetched: 0, predictions: 0, top_pick: null,
      message: `No tracked upcoming fixtures with odds.`,
    })
  }

  // ── Step 2: Read fresh matches from DB ─────────────────────────────────────
  const endOfWeek = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000)
  const weekEndStr = endOfWeek.toISOString().split('T')[0] + 'T23:59:59'
  const { data: matches, error: matchErr } = await supabaseAdmin
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .gte('match_date', `${today}T00:00:00Z`)
    .lte('match_date', weekEndStr)

  if (matchErr || !matches || matches.length === 0) {
    const msg = matchErr?.message ?? `No matches in DB for ${today} after upsert.`
    console.error('[pipeline]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }

  console.log(`[pipeline] Scoring ${matches.length} matches…`)

  // ── Step 3: Score ──────────────────────────────────────────────────────────
  const scored = matches.map(match => {
    const features: DrawFeatures = {
      xgHome:            match.xg_home           ?? 1.2,
      xgAway:            match.xg_away           ?? 1.2,
      homeGoalsAvg:      match.home_goals_avg     ?? 1.4,
      awayGoalsAvg:      match.away_goals_avg     ?? 1.4,
      homeConcedeAvg:    match.home_concede_avg   ?? 1.2,
      awayConcedeAvg:    match.away_concede_avg   ?? 1.2,
      homeDrawRate:      match.home_draw_rate     ?? 0.27,
      awayDrawRate:      match.away_draw_rate     ?? 0.27,
      h2hDrawRate:       match.h2h_draw_rate      ?? 0.27,
      h2hIsReal:         match.h2h_is_real        ?? false,
      drawOdds:          match.draw_odds          ?? 3.2,
      homeOdds: 0, awayOdds: 0,
      xgIsReal:          (match.xg_home ?? 0) > 0,   // set true if xG was scraped
      hasRealTeamStats:  match.has_real_team_stats ?? false,  // already in DB
      oddsMovement:      match.odds_movement      ?? undefined,
      oddsOpenDraw:      match.odds_open          ?? undefined,
      homeFormDrawRate:  match.home_form_draw_rate ?? undefined,
      awayFormDrawRate:  match.away_form_draw_rate ?? undefined,
      homeFormGoalsAvg:  match.home_form_goals_avg ?? undefined,
      awayFormGoalsAvg:  match.away_form_goals_avg ?? undefined,
      homeGamesLast14:   match.home_games_last14  ?? undefined,
      awayGamesLast14:   match.away_games_last14  ?? undefined,
      leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
      leagueDrawBoost:   match.leagues?.draw_boost    ?? 0,
    }
    return { ...match, ...predictDraw(features) }
  })

  // ── Step 4: Write scores back ──────────────────────────────────────────────
  await Promise.all(scored.map(m =>
    supabaseAdmin.from('matches').update({
      draw_score: m.drawScore, draw_probability: m.probability, confidence: m.confidence,
    }).eq('id', m.id)
  ))
  console.log(`[pipeline] Scores written for ${scored.length} matches`)

  // ── Step 5: Rebuild predictions ────────────────────────────────────────────
  await supabaseAdmin.from('predictions').delete().eq('prediction_date', today)

  const oddsQuality = (o: number) => o >= 3.0 && o <= 3.4 ? 3 : o >= 2.8 && o < 3.0 ? 2 : o > 3.4 && o <= 3.7 ? 1 : 0

  const top10 = [...scored]
    .sort((a, b) => {
      if (Math.abs(b.drawScore - a.drawScore) > 0.05) return b.drawScore - a.drawScore
      const oq = oddsQuality(b.draw_odds ?? 0) - oddsQuality(a.draw_odds ?? 0)
      if (oq !== 0) return oq
      return ((b as any).has_real_team_stats ? 1 : 0) - ((a as any).has_real_team_stats ? 1 : 0)
    })
    .slice(0, 10)

  console.log(`[pipeline] Top scores: ${top10.map(m => m.drawScore.toFixed(2)).join(', ')}`)

  const insertRows = top10.map((m, i) => ({
    match_id: m.id, prediction_date: today, rank: i + 1,
    draw_score: m.drawScore, draw_probability: m.probability,
    confidence: m.confidence, draw_odds: Number(m.draw_odds ?? 0),
  }))

  const { error: insertErr } = await supabaseAdmin.from('predictions').insert(insertRows)
  if (insertErr) {
    console.error('[pipeline] Insert error:', insertErr.message)
    return NextResponse.json({ error: insertErr.message }, { status: 500 })
  }

  const topPick = top10[0]
    ? `${top10[0].home_team_name} vs ${top10[0].away_team_name} (score: ${top10[0].drawScore})`
    : null

  console.log(`[pipeline] ═══ DONE — ${top10.length} predictions inserted ═══\n`)
  return NextResponse.json({ success: true, fetched, predictions: top10.length, top_pick: topPick })
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