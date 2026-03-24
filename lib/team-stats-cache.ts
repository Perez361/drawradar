// lib/team-stats-cache.ts
//
// Fetches per-team statistics from API-Football and caches in Supabase.
// Cache TTL = 7 days (stats are stable across a season).
//
// ─── One-time Supabase migration ─────────────────────────────────────────────
//
//   CREATE TABLE IF NOT EXISTS team_stats (
//     team_id           INTEGER NOT NULL,
//     league_id         INTEGER NOT NULL,
//     season            INTEGER NOT NULL,
//     goals_for_avg     NUMERIC(4,2),
//     goals_against_avg NUMERIC(4,2),
//     draw_rate         NUMERIC(4,3),
//     matches_played    INTEGER,
//     fetched_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
//     PRIMARY KEY (team_id, league_id, season)
//   );
//
//   ALTER TABLE matches
//     ADD COLUMN IF NOT EXISTS home_team_ext_id    INTEGER,
//     ADD COLUMN IF NOT EXISTS away_team_ext_id    INTEGER,
//     ADD COLUMN IF NOT EXISTS league_ext_id       INTEGER,
//     ADD COLUMN IF NOT EXISTS has_real_team_stats BOOLEAN DEFAULT false;

import { supabaseAdmin } from './supabase'
import { API_FOOTBALL_BASE } from './api-football'

const CACHE_TTL_DAYS = 7

export interface TeamStats {
  goalsForAvg: number
  goalsAgainstAvg: number
  drawRate: number
  matchesPlayed: number
}

interface ApiTeamStatsResponse {
  response: {
    fixtures: {
      played: { total: number }
      draws:  { total: number }
    }
    goals: {
      for:     { average: { total: string } }
      against: { average: { total: string } }
    }
  }
}

// ─── Single team (cache-first) ────────────────────────────────────────────────

export async function getTeamStats(
  apiKey: string,
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStats | null> {
  const cached = await readCache(teamId, leagueId, season)
  if (cached) return cached

  const fresh = await fetchFromApi(apiKey, teamId, leagueId, season)
  if (!fresh) return null

  await writeCache(teamId, leagueId, season, fresh)
  return fresh
}

// ─── Batch: many teams with API quota guard ───────────────────────────────────

export async function getTeamStatsBatch(
  apiKey: string,
  teams: Array<{ teamId: number; leagueId: number; season: number }>,
  maxApiCalls = 40
): Promise<Map<string, TeamStats>> {
  const result = new Map<string, TeamStats>()
  let apiCallsUsed = 0
  let fromCache = 0

  for (const { teamId, leagueId, season } of teams) {
    const key = cacheKey(teamId, leagueId, season)

    const cached = await readCache(teamId, leagueId, season)
    if (cached) {
      result.set(key, cached)
      fromCache++
      continue
    }

    if (apiCallsUsed >= maxApiCalls) {
      console.log(`[team-stats] quota exhausted at ${apiCallsUsed} calls, skipping team ${teamId}`)
      continue
    }

    const fresh = await fetchFromApi(apiKey, teamId, leagueId, season)
    apiCallsUsed++

    if (fresh) {
      await writeCache(teamId, leagueId, season, fresh)
      result.set(key, fresh)
    }
  }

  console.log(
    `[team-stats] batch done — ${result.size}/${teams.length} resolved` +
    ` (${fromCache} cache hits, ${apiCallsUsed} API calls)`
  )

  return result
}

export function cacheKey(teamId: number, leagueId: number, season: number): string {
  return `${teamId}:${leagueId}:${season}`
}

// ─── Cache read ───────────────────────────────────────────────────────────────

async function readCache(
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStats | null> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - CACHE_TTL_DAYS)

  const { data, error } = await supabaseAdmin
    .from('team_stats')
    .select('goals_for_avg, goals_against_avg, draw_rate, matches_played')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('season', season)
    .gte('fetched_at', cutoff.toISOString())
    .single()

  if (error || !data) return null

  return {
    goalsForAvg:      Number(data.goals_for_avg),
    goalsAgainstAvg:  Number(data.goals_against_avg),
    drawRate:         Number(data.draw_rate),
    matchesPlayed:    data.matches_played ?? 0,
  }
}

// ─── Cache write ──────────────────────────────────────────────────────────────

async function writeCache(
  teamId: number,
  leagueId: number,
  season: number,
  stats: TeamStats
): Promise<void> {
  const { error } = await supabaseAdmin
    .from('team_stats')
    .upsert(
      {
        team_id:           teamId,
        league_id:         leagueId,
        season,
        goals_for_avg:     stats.goalsForAvg,
        goals_against_avg: stats.goalsAgainstAvg,
        draw_rate:         stats.drawRate,
        matches_played:    stats.matchesPlayed,
        fetched_at:        new Date().toISOString(),
      },
      { onConflict: 'team_id,league_id,season' }
    )

  if (error) {
    console.error(`[team-stats] write error for team ${teamId}:`, error.message)
  }
}

// ─── API fetch ────────────────────────────────────────────────────────────────

async function fetchFromApi(
  apiKey: string,
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStats | null> {
  const url =
    `${API_FOOTBALL_BASE}/teams/statistics` +
    `?team=${teamId}&league=${leagueId}&season=${season}`

  try {
    const res = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
    })

    if (!res.ok) {
      console.warn(`[team-stats] HTTP ${res.status} for team ${teamId}`)
      return null
    }

    const remaining = res.headers.get('x-ratelimit-requests-remaining')
    console.log(`[team-stats] team ${teamId} fetched — quota remaining: ${remaining}`)

    const json = (await res.json()) as ApiTeamStatsResponse
    const r = json?.response
    if (!r) return null

    const played = r.fixtures?.played?.total ?? 0
    const draws  = r.fixtures?.draws?.total  ?? 0
    if (played === 0) return null

    const goalsForAvg     = parseFloat(r.goals?.for?.average?.total     ?? '0')
    const goalsAgainstAvg = parseFloat(r.goals?.against?.average?.total ?? '0')

    return {
      goalsForAvg:     Math.round(goalsForAvg     * 100) / 100,
      goalsAgainstAvg: Math.round(goalsAgainstAvg * 100) / 100,
      drawRate:        Math.round((draws / played) * 1000) / 1000,
      matchesPlayed:   played,
    }
  } catch (err) {
    console.error(`[team-stats] fetch threw for team ${teamId}:`, err)
    return null
  }
}

// ─── Current football season year ────────────────────────────────────────────
// European convention: "2024" season runs Aug 2024 – May 2025.
// July+ → new season started this year. Jan–June → season started last year.
// Southern-hemisphere leagues (Brazil etc.) start Feb/Mar of the same year,
// so the calendar year they start in is also returned correctly.

export function currentSeason(): number {
  const now = new Date()
  const month = now.getMonth() + 1 // 1–12
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1
}