// app/api/admin/allsports-fixtures/route.ts
//
// Fetches today's fixtures + odds from AllSportsAPI and upserts them into the
// matches table — using the same schema as the existing API-Football pipeline.
//
// Strategy:
//   1. Fetch all of today's fixtures from AllSportsAPI
//   2. Filter to scheduled (NS) only; skip those already in DB via external_id
//   3. For each new fixture, fetch draw odds (met=Odds)
//   4. Skip if draw_odds == 0 or outside the useful range (2.5–4.5)
//   5. Build a MappedFixture-compatible row (using league baselines for stats)
//      and upsert into matches table
//   6. Return a summary
//
// This route can be called:
//   • From the admin panel (GET in dev)
//   • As a POST from a Vercel cron alongside /api/trigger-predictions
//
// NOTE: AllSportsAPI uses its own league IDs that differ from API-Football.
//       We maintain a separate map (ALLSPORTS_LEAGUE_MAP) and store
//       external_id as "allsp_<match_id>" to avoid collisions.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchAllSportsFixtures,
  fetchAllSportsOdds,
  extractBestDrawOddsAS,
  fetchAllSportsH2H,
  computeAllSportsH2HStats,
  type AllSportsFixture,
} from '@/lib/allsports-api'

// ─── League map: AllSports league_id → our canonical name + country + avgDrawRate
// Add more as needed. IDs from AllSports differ from API-Football.
// ─────────────────────────────────────────────────────────────────────────────

interface LeagueInfo {
  name: string
  country: string
  avgDrawRate: number
}

const ALLSPORTS_LEAGUE_MAP: Record<string, LeagueInfo> = {
  // England
  '148': { name: 'Premier League',   country: 'England',     avgDrawRate: 0.26 },
  '149': { name: 'Championship',     country: 'England',     avgDrawRate: 0.28 },
  '150': { name: 'League One',       country: 'England',     avgDrawRate: 0.27 },
  '151': { name: 'League Two',       country: 'England',     avgDrawRate: 0.27 },
  // Spain
  '302': { name: 'La Liga',          country: 'Spain',       avgDrawRate: 0.27 },
  '303': { name: 'Segunda División', country: 'Spain',       avgDrawRate: 0.29 },
  // Germany
  '175': { name: 'Bundesliga',       country: 'Germany',     avgDrawRate: 0.24 },
  '176': { name: '2. Bundesliga',    country: 'Germany',     avgDrawRate: 0.26 },
  // Italy
  '207': { name: 'Serie A',          country: 'Italy',       avgDrawRate: 0.29 },
  '208': { name: 'Serie B',          country: 'Italy',       avgDrawRate: 0.30 },
  // France
  '168': { name: 'Ligue 1',          country: 'France',      avgDrawRate: 0.28 },
  '169': { name: 'Ligue 2',          country: 'France',      avgDrawRate: 0.29 },
  // Netherlands
  '244': { name: 'Eredivisie',       country: 'Netherlands', avgDrawRate: 0.25 },
  // Portugal
  '308': { name: 'Primeira Liga',    country: 'Portugal',    avgDrawRate: 0.28 },
  // Turkey
  '203': { name: 'Süper Lig',        country: 'Turkey',      avgDrawRate: 0.28 },
  // Belgium
  '144': { name: 'Pro League',       country: 'Belgium',     avgDrawRate: 0.27 },
  // Scotland
  '501': { name: 'Premiership',      country: 'Scotland',    avgDrawRate: 0.26 },
  // Greece
  '197': { name: 'Super League 1',   country: 'Greece',      avgDrawRate: 0.30 },
  // Russia
  '235': { name: 'Premier League',   country: 'Russia',      avgDrawRate: 0.27 },
  // Ukraine
  '333': { name: 'Premier League',   country: 'Ukraine',     avgDrawRate: 0.28 },
  // Brazil
  '71':  { name: 'Série A',          country: 'Brazil',      avgDrawRate: 0.28 },
  '72':  { name: 'Série B',          country: 'Brazil',      avgDrawRate: 0.30 },
  // Argentina
  '128': { name: 'Liga Profesional', country: 'Argentina',   avgDrawRate: 0.29 },
  // Mexico
  '262': { name: 'Liga MX',          country: 'Mexico',      avgDrawRate: 0.27 },
  // USA
  '253': { name: 'MLS',              country: 'USA',         avgDrawRate: 0.27 },
  // Japan
  '98':  { name: 'J1 League',        country: 'Japan',       avgDrawRate: 0.26 },
  // South Korea
  '292': { name: 'K League 1',       country: 'South Korea', avgDrawRate: 0.27 },
  // Saudi Arabia
  '307': { name: 'Saudi Professional League', country: 'Saudi Arabia', avgDrawRate: 0.27 },
  // Egypt
  '233': { name: 'Egyptian Premier League',   country: 'Egypt',        avgDrawRate: 0.32 },
  // Nigeria
  '399': { name: 'NPFL',             country: 'Nigeria',     avgDrawRate: 0.33 },
  // Ghana
  '570': { name: 'Premier League',   country: 'Ghana',       avgDrawRate: 0.30 },
  // South Africa
  '288': { name: 'Premier Soccer League', country: 'South Africa', avgDrawRate: 0.29 },
  // Morocco
  '200': { name: 'Botola Pro',       country: 'Morocco',     avgDrawRate: 0.30 },
  // Australia
  '188': { name: 'A-League Men',     country: 'Australia',   avgDrawRate: 0.25 },
  // Champions League & Europa
  '9':   { name: 'Champions League', country: 'Europe',      avgDrawRate: 0.24 },
  '10':  { name: 'Europa League',    country: 'Europe',      avgDrawRate: 0.26 },
}

// ─── League goal baselines (fallback when no team stats available) ─────────────

function getLeagueGoalsAvg(leagueId: string, side: 'home' | 'away'): number {
  const baselines: Record<string, [number, number]> = {
    '148': [1.53, 1.22], '149': [1.45, 1.15], '150': [1.42, 1.12], '151': [1.38, 1.10],
    '302': [1.55, 1.22], '303': [1.40, 1.10],
    '175': [1.72, 1.38], '176': [1.60, 1.28],
    '207': [1.49, 1.19], '208': [1.38, 1.08],
    '168': [1.51, 1.18], '169': [1.40, 1.10],
    '244': [1.81, 1.44],
    '308': [1.48, 1.14],
    '203': [1.56, 1.24],
    '144': [1.62, 1.28],
    '501': [1.55, 1.20],
    '197': [1.43, 1.10],
    '235': [1.50, 1.18],
    '333': [1.48, 1.15],
    '71':  [1.55, 1.20], '72': [1.40, 1.10],
    '128': [1.50, 1.18],
    '262': [1.48, 1.15],
    '253': [1.40, 1.10],
    '98':  [1.50, 1.18],
    '292': [1.48, 1.15],
    '307': [1.55, 1.22],
    '233': [1.30, 1.02],
    '288': [1.38, 1.10],
    '9':   [1.45, 1.15],
    '10':  [1.42, 1.12],
  }
  const pair = baselines[leagueId] ?? [1.45, 1.18]
  return side === 'home' ? pair[0] : pair[1]
}

// ─── Upsert league into DB, returns league DB id ──────────────────────────────

async function upsertLeagueAS(
  name: string,
  country: string,
  avgDrawRate: number
): Promise<number | null> {
  const { data: existing } = await supabaseAdmin
    .from('leagues')
    .select('id')
    .eq('name', name)
    .eq('country', country)
    .maybeSingle()

  if (existing) return existing.id

  const { data, error } = await supabaseAdmin
    .from('leagues')
    .insert({ name, country, avg_draw_rate: avgDrawRate, draw_boost: 0 })
    .select('id')
    .single()

  if (error) {
    if (error.code === '23505') {
      const { data: retry } = await supabaseAdmin
        .from('leagues')
        .select('id')
        .eq('name', name)
        .eq('country', country)
        .maybeSingle()
      return retry?.id ?? null
    }
    console.error(`[allsports-upsert] league error for ${name}:`, error.message)
    return null
  }
  return data.id
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function runAllSportsFetch(): Promise<NextResponse> {
  const apiKey = process.env.ALLSPORTS_API_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'ALLSPORTS_API_KEY not set' }, { status: 500 })
  }

  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  console.log(`[allsports] Fetching fixtures for ${today}…`)

  // 1. Fetch all fixtures for today
  const allFixtures = await fetchAllSportsFixtures(apiKey, today)
  console.log(`[allsports] Total fixtures returned: ${allFixtures.length}`)

  // 2. Filter: only scheduled (NS), only tracked leagues
  const scheduled = allFixtures.filter(
    (f) =>
      (f.match_status === 'NS' || f.match_status === '') &&
      ALLSPORTS_LEAGUE_MAP[f.league_id]
  )
  console.log(`[allsports] Scheduled + tracked: ${scheduled.length}`)

  if (!scheduled.length) {
    return NextResponse.json({
      success: true,
      fetched: allFixtures.length,
      tracked: 0,
      upserted: 0,
      skippedNoOdds: 0,
      message: 'No tracked scheduled fixtures found',
    })
  }

  // 3. Load existing external_ids so we don't double-process
  const externalIds = scheduled.map((f) => `allsp_${f.match_id}`)
  const { data: existingRows } = await supabaseAdmin
    .from('matches')
    .select('external_id, odds_open')
    .in('external_id', externalIds)

  const existingMap = new Map<string, number | null>(
    (existingRows ?? []).map((r) => [r.external_id as string, r.odds_open as number | null])
  )

  let upserted = 0
  let skippedNoOdds = 0
  let skippedOddsRange = 0

  for (const fixture of scheduled) {
    const extId = `allsp_${fixture.match_id}`
    const leagueInfo = ALLSPORTS_LEAGUE_MAP[fixture.league_id]!

    // 4. Fetch draw odds
    const oddsEntries = await fetchAllSportsOdds(apiKey, fixture.match_id)
    const drawOdds = extractBestDrawOddsAS(oddsEntries)

    if (drawOdds === 0) {
      skippedNoOdds++
      continue
    }

    // Only consider odds in meaningful range
    if (drawOdds < 2.4 || drawOdds > 5.0) {
      skippedOddsRange++
      continue
    }

    // Opening odds: preserve existing or set to current
    const openingOdds = existingMap.get(extId) ?? drawOdds
    const oddsMovement =
      openingOdds && openingOdds !== drawOdds
        ? Math.round((drawOdds - openingOdds) * 100) / 100
        : null

    // 5. H2H data
    let h2hDrawRate = leagueInfo.avgDrawRate
    let h2hIsReal = false

    const h2hData = await fetchAllSportsH2H(
      apiKey,
      fixture.match_hometeam_id,
      fixture.match_awayteam_id
    )
    if (h2hData?.firstTeam_VS_secondTeam) {
      const stats = computeAllSportsH2HStats(h2hData.firstTeam_VS_secondTeam)
      if (stats.isReal) {
        h2hDrawRate = stats.drawRate
        h2hIsReal = true
      }
    }

    // 6. Build xG estimates from league baselines
    const homeGoalsFor  = getLeagueGoalsAvg(fixture.league_id, 'home')
    const homeConcede   = getLeagueGoalsAvg(fixture.league_id, 'away')
    const awayGoalsFor  = getLeagueGoalsAvg(fixture.league_id, 'away')
    const awayConcede   = getLeagueGoalsAvg(fixture.league_id, 'home')

    const xgHome = Math.round(((homeGoalsFor + awayConcede) / 2) * 100) / 100
    const xgAway = Math.round(((awayGoalsFor + homeConcede) / 2) * 100) / 100

    const avgDrawRate = leagueInfo.avgDrawRate
    const homeDrawRate = avgDrawRate
    const awayDrawRate = avgDrawRate

    // 7. Upsert league
    const leagueDbId = await upsertLeagueAS(
      leagueInfo.name,
      leagueInfo.country,
      leagueInfo.avgDrawRate
    )
    if (!leagueDbId) {
      console.warn(`[allsports] Could not get league ID for ${leagueInfo.name}, skipping`)
      continue
    }

    // 8. Build match row
    const matchDate = `${fixture.match_date}T${fixture.match_time}:00Z`

    const row = {
      league_id:            leagueDbId,
      home_team_name:       fixture.match_hometeam_name,
      away_team_name:       fixture.match_awayteam_name,
      match_date:           matchDate,
      draw_odds:            drawOdds,
      xg_home:              xgHome,
      xg_away:              xgAway,
      home_goals_avg:       homeGoalsFor,
      away_goals_avg:       awayGoalsFor,
      home_concede_avg:     homeConcede,
      away_concede_avg:     awayConcede,
      home_draw_rate:       homeDrawRate,
      away_draw_rate:       awayDrawRate,
      h2h_draw_rate:        h2hDrawRate,
      h2h_is_real:          h2hIsReal,
      home_form_draw_rate:  null,
      away_form_draw_rate:  null,
      home_form_goals_avg:  null,
      away_form_goals_avg:  null,
      home_games_last14:    null,
      away_games_last14:    null,
      odds_open:            openingOdds,
      odds_movement:        oddsMovement,
      draw_score:           0,
      draw_probability:     0,
      confidence:           0,
      status:               'scheduled',
      external_id:          extId,
      // No API-Football team/league ext IDs available here
      home_team_ext_id:     null,
      away_team_ext_id:     null,
      league_ext_id:        null,
      has_real_team_stats:  false,
    }

    const { error } = await supabaseAdmin
      .from('matches')
      .upsert(row, { onConflict: 'external_id' })

    if (error) {
      console.error(`[allsports] upsert error for ${extId}:`, error.message)
    } else {
      upserted++
      console.log(
        `[allsports] upserted: ${fixture.match_hometeam_name} vs ${fixture.match_awayteam_name} ` +
        `(odds: ${drawOdds}, league: ${leagueInfo.name})`
      )
    }
  }

  console.log(
    `[allsports] Done — upserted: ${upserted}, no-odds: ${skippedNoOdds}, ` +
    `out-of-range: ${skippedOddsRange}`
  )

  return NextResponse.json({
    success: true,
    date: today,
    fetched: allFixtures.length,
    tracked: scheduled.length,
    upserted,
    skippedNoOdds,
    skippedOddsRange,
  })
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runAllSportsFetch()
}

export async function POST(req: NextRequest) {
  const authHeader = req.headers.get('authorization')
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runAllSportsFetch()
}