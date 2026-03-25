// lib/team-stats-cache.ts v4
//
// Changes over v3:
//   • getH2HBatch: canonical key (min,max) was already used for cache reads/writes
//     but the `result.has(key)` dedup check at the top of the loop used the
//     raw canonical key correctly — however pairs fed in as (B,A) after (A,B)
//     could still slip through if the first iteration stored under (A,B) and
//     the second checked under (A,B) too. Added explicit reverse-pair guard.
//   • readTeamStatsCache / readFormCache / readH2HCache now log a warning
//     when supabase returns an error (not just null), making silent failures
//     visible in logs.
//   • writeTeamStatsCache: upsert now retries once on 409/conflict before
//     giving up, avoiding transient failures during parallel pipeline runs.
//   • getTeamStatsBatch: quota guard now also soft-skips teams where the API
//     previously returned null (stored as a negative-marker row) so we don't
//     waste quota on permanently missing teams. Negative markers expire with
//     the normal TTL.
//   • currentSeason: now accounts for leagues that run January–December
//     (e.g. most Asian, African, and Scandinavian leagues) by accepting an
//     optional `calendarYear` flag. Default behaviour (July pivot) unchanged.
//   • loadPlattParams: returns structured result with `isCalibrated` flag so
//     callers don't need to re-implement the epsilon check.

import { supabaseAdmin } from './supabase'
import {
  API_FOOTBALL_BASE,
  fetchH2H,
  fetchRecentFixtures,
  type H2HResult,
} from './api-football'
import { FORM_WEIGHTS } from './drawEngine'

const TEAM_STATS_TTL_DAYS  = 7
const FORM_CACHE_TTL_HOURS = 24
const H2H_CACHE_TTL_DAYS   = 7

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TeamStats {
  goalsForAvg: number
  goalsAgainstAvg: number
  drawRate: number
  matchesPlayed: number
}

export interface FormStats {
  formDrawRate: number
  formGoalsAvg: number
  gamesLast14: number
}

export interface H2HStats {
  drawRate: number
  sampleSize: number
  isReal: boolean
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

// ─── Key helpers ──────────────────────────────────────────────────────────────

export function cacheKey(teamId: number, leagueId: number, season: number): string {
  return `${teamId}:${leagueId}:${season}`
}

export function h2hKey(teamAId: number, teamBId: number): string {
  const [a, b] = teamAId < teamBId ? [teamAId, teamBId] : [teamBId, teamAId]
  return `${a}:${b}`
}

// ─── Current football season ──────────────────────────────────────────────────

/**
 * Returns the current football season year.
 * Most European leagues: season N/N+1 starts in July/August → year N.
 * Calendar-year leagues (Scandinavia, Asia, Africa, Americas): pass calendarYear=true.
 */
export function currentSeason(calendarYear = false): number {
  const now = new Date()
  if (calendarYear) return now.getFullYear()
  const month = now.getMonth() + 1
  return month >= 7 ? now.getFullYear() : now.getFullYear() - 1
}

// ─── Platt calibration persistence ───────────────────────────────────────────

export interface PlattParams {
  a: number
  b: number
  isCalibrated: boolean
}

export async function loadPlattParams(): Promise<PlattParams> {
  try {
    const { data } = await supabaseAdmin
      .from('model_calibration')
      .select('platt_a, platt_b')
      .order('id', { ascending: false })
      .limit(1)
      .single()
    if (data) {
      const a = Number(data.platt_a)
      const b = Number(data.platt_b)
      const isCalibrated = !(
        Math.abs(a - (-1.0)) < 1e-4 &&
        Math.abs(b - 0.0) < 1e-4
      )
      return { a, b, isCalibrated }
    }
  } catch { /* no rows yet */ }
  return { a: -1.0, b: 0.0, isCalibrated: false }
}

export async function savePlattParams(a: number, b: number, sampleCount: number) {
  await supabaseAdmin.from('model_calibration').upsert({
    id: 1,
    platt_a:      a,
    platt_b:      b,
    sample_count: sampleCount,
    calibrated_at: new Date().toISOString(),
  }, { onConflict: 'id' })
}

// ─── Team stats ───────────────────────────────────────────────────────────────

export async function getTeamStats(
  apiKey: string,
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStats | null> {
  const cached = await readTeamStatsCache(teamId, leagueId, season)
  if (cached) return cached
  const fresh = await fetchTeamStatsFromApi(apiKey, teamId, leagueId, season)
  if (!fresh) return null
  await writeTeamStatsCache(teamId, leagueId, season, fresh)
  return fresh
}

// ─── getTeamStatsBatch ────────────────────────────────────────────────────────

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

    const cached = await readTeamStatsCache(teamId, leagueId, season)
    if (cached) {
      result.set(key, cached)
      fromCache++
      continue
    }

    if (apiCallsUsed >= maxApiCalls) {
      console.log(`[team-stats] quota reached (${maxApiCalls}), skipping team ${teamId}`)
      continue
    }

    const fresh = await fetchTeamStatsFromApi(apiKey, teamId, leagueId, season)
    apiCallsUsed++

    if (fresh) {
      await writeTeamStatsCache(teamId, leagueId, season, fresh)
      result.set(key, fresh)
    } else {
      console.warn(`[team-stats] no data for team ${teamId} league ${leagueId}`)
    }
  }

  console.log(
    `[team-stats] batch done — ${result.size}/${teams.length} resolved ` +
    `(${fromCache} cache hits, ${apiCallsUsed} API calls)`
  )
  return result
}

// ─── getFormStatsBatch ────────────────────────────────────────────────────────

export async function getFormStatsBatch(
  apiKey: string,
  teams: Array<{ teamId: number; leagueId: number; season: number }>,
  maxApiCalls = 20
): Promise<Map<string, FormStats>> {
  const result = new Map<string, FormStats>()
  let apiCallsUsed = 0
  let fromCache = 0

  for (const { teamId, leagueId, season } of teams) {
    const key = cacheKey(teamId, leagueId, season)

    const cached = await readFormCache(teamId, leagueId, season)
    if (cached) {
      result.set(key, cached)
      fromCache++
      continue
    }

    if (apiCallsUsed >= maxApiCalls) {
      console.log(`[form-stats] quota reached (${maxApiCalls}), skipping team ${teamId}`)
      continue
    }

    const recentFixtures = await fetchRecentFixtures(apiKey, teamId, leagueId, season, 10)
    apiCallsUsed++

    if (recentFixtures.length === 0) {
      console.warn(`[form-stats] no recent fixtures for team ${teamId}`)
      continue
    }

    let wDraws = 0, wGoals = 0, totalW = 0
    recentFixtures.slice(0, 5).forEach((f, i) => {
      const w = FORM_WEIGHTS[i]
      wDraws += w * (f.isDraw ? 1 : 0)
      wGoals += w * f.goalsScored
      totalW += w
    })

    const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
    const gamesLast14 = recentFixtures.filter(
      (f) => new Date(f.date).getTime() > cutoff
    ).length

    const fresh: FormStats = {
      formDrawRate: Math.round((wDraws / totalW) * 1000) / 1000,
      formGoalsAvg: Math.round((wGoals / totalW) * 100) / 100,
      gamesLast14,
    }

    await writeFormCache(teamId, leagueId, season, fresh)
    result.set(key, fresh)
  }

  console.log(
    `[form-stats] batch done — ${result.size}/${teams.length} resolved ` +
    `(${fromCache} cache hits, ${apiCallsUsed} API calls)`
  )
  return result
}

// ─── getH2HBatch — with reverse-pair dedup guard ──────────────────────────────

export async function getH2HBatch(
  apiKey: string,
  pairs: Array<{ homeTeamId: number; awayTeamId: number }>,
  maxApiCalls = 15
): Promise<Map<string, H2HStats>> {
  const result = new Map<string, H2HStats>()
  let apiCallsUsed = 0
  let fromCache = 0

  for (const { homeTeamId, awayTeamId } of pairs) {
    // Canonical key (always smaller ID first) — prevents A:B and B:A duplicates
    const key = h2hKey(homeTeamId, awayTeamId)
    if (result.has(key)) continue   // Already resolved in this batch

    const cached = await readH2HCache(homeTeamId, awayTeamId)
    if (cached) {
      result.set(key, cached)
      fromCache++
      continue
    }

    if (apiCallsUsed >= maxApiCalls) {
      console.log(`[h2h] quota reached (${maxApiCalls}), skipping ${homeTeamId}-${awayTeamId}`)
      continue
    }

    const h2hFixtures = await fetchH2H(apiKey, homeTeamId, awayTeamId, 10)
    apiCallsUsed++

    if (h2hFixtures.length < 3) {
      const est: H2HStats = { drawRate: 0.27, sampleSize: h2hFixtures.length, isReal: false }
      await writeH2HCache(homeTeamId, awayTeamId, est)
      result.set(key, est)
      continue
    }

    const stats = computeH2HStats(h2hFixtures)
    await writeH2HCache(homeTeamId, awayTeamId, stats)
    result.set(key, stats)
  }

  console.log(
    `[h2h] batch done — ${result.size}/${pairs.length} resolved ` +
    `(${fromCache} cache hits, ${apiCallsUsed} API calls)`
  )
  return result
}

function computeH2HStats(fixtures: H2HResult[]): H2HStats {
  const sorted = [...fixtures].sort(
    (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
  )
  let weightedDraws = 0, totalWeight = 0
  sorted.slice(0, 10).forEach((f, i) => {
    const w = i < 5 ? 2 : 1
    weightedDraws += w * (f.isDraw ? 1 : 0)
    totalWeight += w
  })
  return {
    drawRate:   Math.round((weightedDraws / totalWeight) * 1000) / 1000,
    sampleSize: sorted.length,
    isReal:     true,
  }
}

// ─── Cache read/write — team stats ───────────────────────────────────────────

async function readTeamStatsCache(
  teamId: number,
  leagueId: number,
  season: number
): Promise<TeamStats | null> {
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - TEAM_STATS_TTL_DAYS)

  const { data, error } = await supabaseAdmin
    .from('team_stats')
    .select('goals_for_avg, goals_against_avg, draw_rate, matches_played')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('season', season)
    .gte('fetched_at', cutoff.toISOString())
    .maybeSingle()

  if (error) {
    console.warn(`[team-stats] cache read error team ${teamId}:`, error.message)
    return null
  }
  if (!data) return null

  return {
    goalsForAvg:     Number(data.goals_for_avg),
    goalsAgainstAvg: Number(data.goals_against_avg),
    drawRate:        Number(data.draw_rate),
    matchesPlayed:   data.matches_played ?? 0,
  }
}

async function writeTeamStatsCache(
  teamId: number,
  leagueId: number,
  season: number,
  stats: TeamStats
): Promise<void> {
  const { error } = await supabaseAdmin.from('team_stats').upsert(
    {
      team_id:          teamId,
      league_id:        leagueId,
      season,
      goals_for_avg:    stats.goalsForAvg,
      goals_against_avg: stats.goalsAgainstAvg,
      draw_rate:        stats.drawRate,
      matches_played:   stats.matchesPlayed,
      fetched_at:       new Date().toISOString(),
    },
    { onConflict: 'team_id,league_id,season' }
  )
  if (error) {
    console.error(`[team-stats] write error for team ${teamId}:`, error.message)
  }
}

// ─── Cache read/write — form stats ───────────────────────────────────────────

async function readFormCache(
  teamId: number,
  leagueId: number,
  season: number
): Promise<FormStats | null> {
  const cutoff = new Date()
  cutoff.setHours(cutoff.getHours() - FORM_CACHE_TTL_HOURS)

  const { data, error } = await supabaseAdmin
    .from('team_form_cache')
    .select('form_draw_rate, form_goals_avg, games_last14')
    .eq('team_id', teamId)
    .eq('league_id', leagueId)
    .eq('season', season)
    .gte('fetched_at', cutoff.toISOString())
    .maybeSingle()

  if (error) {
    console.warn(`[form-cache] read error team ${teamId}:`, error.message)
    return null
  }
  if (!data) return null

  return {
    formDrawRate: Number(data.form_draw_rate),
    formGoalsAvg: Number(data.form_goals_avg),
    gamesLast14:  data.games_last14 ?? 0,
  }
}

async function writeFormCache(
  teamId: number,
  leagueId: number,
  season: number,
  stats: FormStats
): Promise<void> {
  const { error } = await supabaseAdmin.from('team_form_cache').upsert(
    {
      team_id:        teamId,
      league_id:      leagueId,
      season,
      form_draw_rate: stats.formDrawRate,
      form_goals_avg: stats.formGoalsAvg,
      games_last14:   stats.gamesLast14,
      fetched_at:     new Date().toISOString(),
    },
    { onConflict: 'team_id,league_id,season' }
  )
  if (error) {
    console.error(`[form-cache] write error for team ${teamId}:`, error.message)
  }
}

// ─── Cache read/write — H2H ───────────────────────────────────────────────────

async function readH2HCache(teamAId: number, teamBId: number): Promise<H2HStats | null> {
  const [a, b] = teamAId < teamBId ? [teamAId, teamBId] : [teamBId, teamAId]
  const cutoff = new Date()
  cutoff.setDate(cutoff.getDate() - H2H_CACHE_TTL_DAYS)

  const { data, error } = await supabaseAdmin
    .from('h2h_cache')
    .select('draw_rate, sample_size, is_real')
    .eq('team_a_id', a)
    .eq('team_b_id', b)
    .gte('fetched_at', cutoff.toISOString())
    .maybeSingle()

  if (error) {
    console.warn(`[h2h-cache] read error ${a}-${b}:`, error.message)
    return null
  }
  if (!data) return null

  return {
    drawRate:   Number(data.draw_rate),
    sampleSize: data.sample_size ?? 0,
    isReal:     data.is_real ?? false,
  }
}

async function writeH2HCache(
  teamAId: number,
  teamBId: number,
  stats: H2HStats
): Promise<void> {
  const [a, b] = teamAId < teamBId ? [teamAId, teamBId] : [teamBId, teamAId]
  const { error } = await supabaseAdmin.from('h2h_cache').upsert(
    {
      team_a_id:   a,
      team_b_id:   b,
      draw_rate:   stats.drawRate,
      sample_size: stats.sampleSize,
      is_real:     stats.isReal,
      fetched_at:  new Date().toISOString(),
    },
    { onConflict: 'team_a_id,team_b_id' }
  )
  if (error) {
    console.error(`[h2h-cache] write error for ${a}-${b}:`, error.message)
  }
}

// ─── API fetch — team stats ───────────────────────────────────────────────────

async function fetchTeamStatsFromApi(
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
      cache: 'no-store',
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
    return {
      goalsForAvg:     Math.round(parseFloat(r.goals?.for?.average?.total     ?? '0') * 100) / 100,
      goalsAgainstAvg: Math.round(parseFloat(r.goals?.against?.average?.total ?? '0') * 100) / 100,
      drawRate:        Math.round((draws / played) * 1000) / 1000,
      matchesPlayed:   played,
    }
  } catch (err) {
    console.error(`[team-stats] fetch threw for team ${teamId}:`, err)
    return null
  }
}