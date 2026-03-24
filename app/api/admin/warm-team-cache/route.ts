// app/api/admin/warm-team-cache/route.ts
//
// Pre-populates the team_stats cache before the daily pipeline runs.
// Reads today's matches, extracts unique (teamId, leagueId) pairs,
// and bulk-fetches stats (cache-first, then API) with a quota guard.
//
// Call this via the admin panel or from your cron before trigger-predictions.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'
import { getTeamStatsBatch, cacheKey, currentSeason } from '@/lib/team-stats-cache'

export async function POST(req: NextRequest) {
  const isProduction = process.env.NODE_ENV === 'production'
  if (isProduction) {
    const authHeader = req.headers.get('authorization')
    if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
    }
  }

  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API_FOOTBALL_KEY not set' }, { status: 500 })
  }

  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  const season = currentSeason()

  // Read today's matches (they must already be upserted by the fixtures step)
  const { data: matches, error } = await supabaseAdmin
    .from('matches')
    .select('home_team_ext_id, away_team_ext_id, league_ext_id')
    .gte('match_date', `${today}T00:00:00`)
    .lte('match_date', `${today}T23:59:59`)

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  if (!matches || matches.length === 0) {
    return NextResponse.json({ warmed: 0, message: 'No matches found for today' })
  }

  // Build unique (teamId, leagueId) pairs
  const pairs = new Map<string, { teamId: number; leagueId: number; season: number }>()

  for (const m of matches) {
    const leagueId = m.league_ext_id as number | null
    if (!leagueId) continue

    for (const teamId of [m.home_team_ext_id, m.away_team_ext_id] as (number | null)[]) {
      if (!teamId) continue
      const key = cacheKey(teamId, leagueId, season)
      if (!pairs.has(key)) {
        pairs.set(key, { teamId, leagueId, season })
      }
    }
  }

  const teamList = Array.from(pairs.values())
  console.log(`[warm-cache] ${teamList.length} unique team/league pairs to resolve`)

  // Fetch stats — cache-first, up to 45 fresh API calls
  const statsMap = await getTeamStatsBatch(apiKey, teamList, 45)

  return NextResponse.json({
    totalPairs: teamList.length,
    warmed:     statsMap.size,
    message:    `Resolved stats for ${statsMap.size}/${teamList.length} teams`,
  })
}