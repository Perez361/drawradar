// app/api/admin/tsdb-enrich/route.ts

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import {
  fetchTSDBLeagueTable,
  tableRowToTeamStats,
  TSDB_LEAGUE_MAP,
  getRateLimitBudget,
  type TSDBTeamStats,
} from '@/lib/thesportsdb-api'

// ─── TSDB league ID lookup ───────────────────────────────────────────────

function findTSDBLeagueId(leagueName: string, country: string): string | null {
  for (const [tsdbId, info] of Object.entries(TSDB_LEAGUE_MAP)) {
    if (
      info.name.toLowerCase() === leagueName.toLowerCase() &&
      info.country.toLowerCase() === country.toLowerCase()
    ) {
      return tsdbId
    }
  }

  for (const [tsdbId, info] of Object.entries(TSDB_LEAGUE_MAP)) {
    if (
      info.country.toLowerCase() === country.toLowerCase() &&
      (info.name.toLowerCase().includes(leagueName.toLowerCase()) ||
        leagueName.toLowerCase().includes(info.name.toLowerCase()))
    ) {
      return tsdbId
    }
  }

  return null
}

// ─── Main enrichment runner ──────────────────────────────────────────────

async function runTSDBEnrich(): Promise<NextResponse> {
  const apiKey = process.env.TSDB_API_KEY ?? '123'

  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  console.log(`[tsdb-enrich] Starting enrichment for ${today}`)

  // ── 1. Load matches ────────────────────────────────────────────────────
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select(`
      id,
      home_team_name,
      away_team_name,
      league_id,
      leagues(name, country)
    `)
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!matches?.length) {
    return NextResponse.json({ success: true, enriched: 0 })
  }

  console.log(`[tsdb-enrich] Found ${matches.length} matches`)

  // ── 2. Group matches by league ─────────────────────────────────────────
  type LeagueGroup = {
    tsdbLeagueId: string | null
    leagueName: string
    country: string
    matches: typeof matches
    teamMap: Map<string, { homeIds: number[]; awayIds: number[] }>
  }

  const leagueGroups = new Map<string, LeagueGroup>()

  for (const m of matches) {
    const league = (m as any).leagues
    const leagueName = league?.name ?? 'Unknown'
    const country = league?.country ?? ''
    const key = `${leagueName}::${country}`

    if (!leagueGroups.has(key)) {
      leagueGroups.set(key, {
        tsdbLeagueId: findTSDBLeagueId(leagueName, country),
        leagueName,
        country,
        matches: [],
        teamMap: new Map(),
      })
    }

    const group = leagueGroups.get(key)!
    group.matches.push(m)

    const addTeam = (name: string, isHome: boolean) => {
      const lower = name.toLowerCase()
      if (!group.teamMap.has(lower)) {
        group.teamMap.set(lower, { homeIds: [], awayIds: [] })
      }
      const entry = group.teamMap.get(lower)!
      isHome ? entry.homeIds.push(m.id) : entry.awayIds.push(m.id)
    }

    addTeam(m.home_team_name, true)
    addTeam(m.away_team_name, false)
  }

  // ── 3. Fetch league tables ─────────────────────────────────────────────
  const leagueTeamStats = new Map<string, Map<string, TSDBTeamStats>>()

  let requestsUsed = 0

  for (const [, group] of leagueGroups) {
    const budget = getRateLimitBudget()
    if (budget.remaining < 3) break

    if (!group.tsdbLeagueId) continue

    const table = await fetchTSDBLeagueTable(apiKey, group.tsdbLeagueId)
    requestsUsed++

    if (!table.length) continue

    const teamMap = new Map<string, TSDBTeamStats>()

    for (const row of table) {
      teamMap.set(row.strTeam.toLowerCase(), tableRowToTeamStats(row))
    }

    leagueTeamStats.set(group.tsdbLeagueId, teamMap)
  }

  // ── 4. Update matches ──────────────────────────────────────────────────
  let enriched = 0

  for (const [, group] of leagueGroups) {
    if (!group.tsdbLeagueId) continue

    const teamStats = leagueTeamStats.get(group.tsdbLeagueId)
    if (!teamStats) continue

    for (const match of group.matches) {
      const homeStats = teamStats.get(match.home_team_name.toLowerCase())
      const awayStats = teamStats.get(match.away_team_name.toLowerCase())

      if (!homeStats && !awayStats) continue

      const payload: Record<string, number | boolean> = {}

      if (homeStats) {
        payload.home_draw_rate = homeStats.drawRate
        payload.home_goals_avg = homeStats.goalsForAvg
        payload.home_concede_avg = homeStats.goalsAgainstAvg
      }

      if (awayStats) {
        payload.away_draw_rate = awayStats.drawRate
        payload.away_goals_avg = awayStats.goalsForAvg
        payload.away_concede_avg = awayStats.goalsAgainstAvg
      }

      if (homeStats && awayStats) {
        payload.xg_home =
          Math.round(((homeStats.goalsForAvg + awayStats.goalsAgainstAvg) / 2) * 100) / 100

        payload.xg_away =
          Math.round(((awayStats.goalsForAvg + homeStats.goalsAgainstAvg) / 2) * 100) / 100
      }

      payload.has_real_team_stats = true

      const { error } = await supabaseAdmin
        .from('matches')
        .update(payload)
        .eq('id', match.id)

      if (!error) enriched++
    }
  }

  // ── 5. Update league draw rates ────────────────────────────────────────
  let updatedLeagues = 0

  for (const [, group] of leagueGroups) {
    if (!group.tsdbLeagueId) continue

    const teamStats = leagueTeamStats.get(group.tsdbLeagueId)
    if (!teamStats) continue

    const rates = Array.from(teamStats.values()).map(t => t.drawRate)
    if (!rates.length) continue

    const avg =
      rates.reduce((sum, r) => sum + r, 0) / rates.length

    const leagueId = group.matches[0]?.league_id
    if (!leagueId) continue

    const { error } = await supabaseAdmin
      .from('leagues')
      .update({ avg_draw_rate: Math.round(avg * 1000) / 1000 })
      .eq('id', leagueId)

    if (!error) updatedLeagues++
  }

  return NextResponse.json({
    success: true,
    enriched,
    updatedLeagues,
    requestsUsed,
    budget: getRateLimitBudget(),
  })
}

// ─── Routes ──────────────────────────────────────────────────────────────

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 })
  }
  return runTSDBEnrich()
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runTSDBEnrich()
}