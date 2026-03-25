// ─── TheSportsDB API client ───────────────────────────────────────────────────
//
// Base URL: https://www.thesportsdb.com/api/v1/json/123/
// Free key: 123 | Rate limit: 30 req/min → enforce 1 req per 2.1s
//
// DrawRadar uses TheSportsDB for:
//   1. lookuptable   — league standings → real draw rates, form strings, goals
//   2. eventslast    — last 5 results per team → form draw rate + goal avg
//   3. lookupevent   — single event lookup → result checking for accuracy updates
//   4. eventsday     — day fixtures (5/day free) → gap-fill for very small leagues
//
// Free tier limits per endpoint:
//   eventsday    → 5 results
//   lookuptable  → 5 results (top 5 rows of standings table)
//   eventslast   → 5 results
//   eventsnext   → 5 results
//   lookupevent  → 1 result per call
//
// Key field mappings:
//   idEvent, strHomeTeam, strAwayTeam, idHomeTeam, idAwayTeam
//   intHomeScore, intAwayScore  (null = not played)
//   strStatus: "NS" | "FT" | "HT" | "1H" | "2H" | "CANC" | "PST"
//   dateEvent: "YYYY-MM-DD", strTime: "HH:MM:SS"
//   strLeague, idLeague, strSport
//
// Table row fields (lookuptable):
//   idTeam, strTeam, intPlayed, intWin, intDraw, intLoss
//   intGoalsFor, intGoalsAgainst, intPoints
//   strForm: "WDWLD" (last 5, newest first)

export const TSDB_BASE = 'https://www.thesportsdb.com/api/v1/json'

// ─── Rate limiter — 30 req/min, enforced as 2100ms min gap ───────────────────

let lastRequestAt = 0
const MIN_GAP_MS = 2100  // 2.1s between requests → safely under 30/min

async function rateLimit(): Promise<void> {
  const now = Date.now()
  const wait = MIN_GAP_MS - (now - lastRequestAt)
  if (wait > 0) {
    await new Promise((res) => setTimeout(res, wait))
  }
  lastRequestAt = Date.now()
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function tsdbFetch<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  await rateLimit()
  const qs = params ? '?' + new URLSearchParams(params).toString() : ''
  const url = `${TSDB_BASE}/${apiKey}/${endpoint}${qs}`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      console.warn(`[tsdb] HTTP ${res.status} for ${endpoint}`)
      return null
    }
    return await res.json() as T
  } catch (err) {
    console.error(`[tsdb] fetch error for ${endpoint}:`, err)
    return null
  }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface TSDBEvent {
  idEvent: string
  strEvent: string
  strSport: string
  idLeague: string
  strLeague: string
  strSeason: string
  strHomeTeam: string
  strAwayTeam: string
  idHomeTeam: string
  idAwayTeam: string
  intHomeScore: string | null   // null or "" if not played
  intAwayScore: string | null
  strStatus: string             // "NS", "FT", "HT", "1H", "2H", "CANC", "PST"
  dateEvent: string             // "YYYY-MM-DD"
  strTime: string               // "HH:MM:SS"
  strTimestamp: string | null   // ISO datetime
  strVenue: string | null
}

export interface TSDBTableRow {
  idTeam: string
  strTeam: string
  strBadge: string | null
  intPlayed: string
  intWin: string
  intDraw: string
  intLoss: string
  intGoalsFor: string
  intGoalsAgainst: string
  intPoints: string
  strForm: string | null        // "WDLWW" newest first, may be null
  intGoalDifference: string
  strSeason: string
}

export interface TSDBTeamStats {
  drawRate: number
  goalsForAvg: number
  goalsAgainstAvg: number
  matchesPlayed: number
  recentForm: string | null
}

// ─── Fetch league table (standings) ──────────────────────────────────────────
// Returns up to 5 rows for free tier — enough for the teams involved in
// any single match to have real draw rates, IF they're in the top 5.
// For full-table use, call per-league before running pipeline.

export async function fetchTSDBLeagueTable(
  apiKey: string,
  leagueId: string,
  season?: string
): Promise<TSDBTableRow[]> {
  const params: Record<string, string> = { l: leagueId }
  if (season) params.s = season

  const data = await tsdbFetch<{ table: TSDBTableRow[] | null }>(
    apiKey,
    'lookuptable.php',
    params
  )
  return data?.table ?? []
}

// ─── Fetch last 5 events for a team ──────────────────────────────────────────

export async function fetchTSDBTeamLastEvents(
  apiKey: string,
  teamId: string
): Promise<TSDBEvent[]> {
  const data = await tsdbFetch<{ results: TSDBEvent[] | null }>(
    apiKey,
    'eventslast.php',
    { id: teamId }
  )
  return data?.results ?? []
}

// ─── Fetch next 5 events for a team (useful for upcoming fixture check) ───────

export async function fetchTSDBTeamNextEvents(
  apiKey: string,
  teamId: string
): Promise<TSDBEvent[]> {
  const data = await tsdbFetch<{ events: TSDBEvent[] | null }>(
    apiKey,
    'eventsnext.php',
    { id: teamId }
  )
  return data?.events ?? []
}

// ─── Fetch single event by ID ─────────────────────────────────────────────────

export async function fetchTSDBEvent(
  apiKey: string,
  eventId: string
): Promise<TSDBEvent | null> {
  const data = await tsdbFetch<{ events: TSDBEvent[] | null }>(
    apiKey,
    'lookupevent.php',
    { id: eventId }
  )
  return data?.events?.[0] ?? null
}

// ─── Fetch today's soccer events (capped at 5 free) ──────────────────────────

export async function fetchTSDBEventsForDay(
  apiKey: string,
  date: string,  // "YYYY-MM-DD"
  leagueId?: string
): Promise<TSDBEvent[]> {
  const params: Record<string, string> = { d: date, s: 'Soccer' }
  if (leagueId) params.l = leagueId

  const data = await tsdbFetch<{ events: TSDBEvent[] | null }>(
    apiKey,
    'eventsday.php',
    params
  )
  return (data?.events ?? []).filter((e) => e.strSport === 'Soccer')
}

// ─── Compute team stats from league table row ─────────────────────────────────
// Primary use: get real draw rate for a team from the standings table.

export function tableRowToTeamStats(row: TSDBTableRow): TSDBTeamStats {
  const played = parseInt(row.intPlayed) || 0
  if (played === 0) {
    return { drawRate: 0.27, goalsForAvg: 1.4, goalsAgainstAvg: 1.2, matchesPlayed: 0, recentForm: null }
  }
  const draws = parseInt(row.intDraw) || 0
  const goalsFor = parseInt(row.intGoalsFor) || 0
  const goalsAgainst = parseInt(row.intGoalsAgainst) || 0

  return {
    drawRate:        Math.round((draws / played) * 1000) / 1000,
    goalsForAvg:     Math.round((goalsFor / played) * 100) / 100,
    goalsAgainstAvg: Math.round((goalsAgainst / played) * 100) / 100,
    matchesPlayed:   played,
    recentForm:      row.strForm ?? null,
  }
}

// ─── Compute form stats from last 5 events ────────────────────────────────────
// Returns formDrawRate (weighted) and formGoalsAvg for the given team.

export function computeTSDBFormStats(
  events: TSDBEvent[],
  teamId: string
): { formDrawRate: number; formGoalsAvg: number; gamesLast14: number } | null {
  const completed = events.filter(
    (e) =>
      e.intHomeScore !== null &&
      e.intHomeScore !== '' &&
      e.intAwayScore !== null &&
      e.intAwayScore !== '' &&
      ['FT', 'AET', 'PEN', 'AOT'].includes(e.strStatus)
  )

  if (!completed.length) return null

  const weights = [1.0, 0.9, 0.8, 0.7, 0.6]
  let wDraws = 0, wGoals = 0, totalW = 0

  completed.slice(0, 5).forEach((e, i) => {
    const w = weights[i] ?? 0.6
    const isHome = e.idHomeTeam === teamId
    const scored = isHome
      ? parseInt(e.intHomeScore!)
      : parseInt(e.intAwayScore!)
    const isDraw = e.intHomeScore === e.intAwayScore

    wDraws += w * (isDraw ? 1 : 0)
    wGoals += w * (isNaN(scored) ? 0 : scored)
    totalW += w
  })

  // Games in last 14 days
  const cutoff = Date.now() - 14 * 24 * 60 * 60 * 1000
  const gamesLast14 = completed.filter(
    (e) => new Date(e.dateEvent).getTime() > cutoff
  ).length

  return {
    formDrawRate: Math.round((wDraws / totalW) * 1000) / 1000,
    formGoalsAvg: Math.round((wGoals / totalW) * 100) / 100,
    gamesLast14,
  }
}

// ─── Compute H2H stats from last-5 events of both teams ──────────────────────
// We can cross-reference two teams' last events to find shared matches.
// Free tier gives us 5 each so overlap may be limited — used as supplement only.

export function computeTSDBH2H(
  homeLastEvents: TSDBEvent[],
  awayLastEvents: TSDBEvent[],
  homeTeamId: string,
  awayTeamId: string
): { drawRate: number; sampleSize: number; isReal: boolean } {
  // Find events where these two teams played each other
  const homeEventIds = new Set(homeLastEvents.map((e) => e.idEvent))
  const shared = awayLastEvents.filter(
    (e) =>
      homeEventIds.has(e.idEvent) &&
      ((e.idHomeTeam === homeTeamId && e.idAwayTeam === awayTeamId) ||
       (e.idHomeTeam === awayTeamId && e.idAwayTeam === homeTeamId)) &&
      e.intHomeScore !== null &&
      e.intHomeScore !== '' &&
      ['FT', 'AET', 'PEN', 'AOT'].includes(e.strStatus)
  )

  if (shared.length < 2) {
    return { drawRate: 0.27, sampleSize: shared.length, isReal: false }
  }

  const draws = shared.filter((e) => e.intHomeScore === e.intAwayScore).length
  return {
    drawRate:   Math.round((draws / shared.length) * 1000) / 1000,
    sampleSize: shared.length,
    isReal:     shared.length >= 2,
  }
}

// ─── TSDB League IDs (their IDs differ from API-Football and AllSports) ────────
// These are the TSDB idLeague values for major football leagues.
// Used when calling lookuptable to pre-populate draw rates for top leagues.

export const TSDB_LEAGUE_MAP: Record<
  string,
  { name: string; country: string; avgDrawRate: number }
> = {
  // 🇬🇧 England
  '4328': { name: 'Premier League', country: 'England', avgDrawRate: 0.26 },
  '4329': { name: 'Championship', country: 'England', avgDrawRate: 0.28 },

  // 🇪🇸 Spain
  '4335': { name: 'La Liga', country: 'Spain', avgDrawRate: 0.27 },
  '4336': { name: 'Segunda División', country: 'Spain', avgDrawRate: 0.29 },

  // 🇩🇪 Germany
  '4331': { name: 'Bundesliga', country: 'Germany', avgDrawRate: 0.24 },

  // 🇮🇹 Italy
  '4332': { name: 'Serie A', country: 'Italy', avgDrawRate: 0.29 },

  // 🇫🇷 France
  '4334': { name: 'Ligue 1', country: 'France', avgDrawRate: 0.28 },

  // 🇳🇱 Netherlands
  '4337': { name: 'Eredivisie', country: 'Netherlands', avgDrawRate: 0.25 },

  // 🇧🇪 Belgium
  '4338': { name: 'Pro League', country: 'Belgium', avgDrawRate: 0.27 },

  // 🇵🇹 Portugal
  '4344': { name: 'Primeira Liga', country: 'Portugal', avgDrawRate: 0.28 },

  // 🇹🇷 Turkey
  '4345': { name: 'Süper Lig', country: 'Turkey', avgDrawRate: 0.28 },

  // 🇬🇷 Greece
  '4347': { name: 'Super League 1', country: 'Greece', avgDrawRate: 0.30 },

  // 🇸🇪 Sweden
  '4350': { name: 'Allsvenskan', country: 'Sweden', avgDrawRate: 0.27 },

  // 🇳🇴 Norway
  '4351': { name: 'Eliteserien', country: 'Norway', avgDrawRate: 0.29 },

  // 🇩🇰 Denmark
  '4352': { name: 'Superliga', country: 'Denmark', avgDrawRate: 0.27 },

  // 🇵🇱 Poland
  '4353': { name: 'Ekstraklasa', country: 'Poland', avgDrawRate: 0.29 },

  // 🇷🇺 Russia
  '4354': { name: 'Russian Premier League', country: 'Russia', avgDrawRate: 0.27 },

  // 🇺🇸 USA
  '4346': { name: 'MLS', country: 'USA', avgDrawRate: 0.27 },

  // 🇲🇽 Mexico
  '4406': { name: 'Liga MX', country: 'Mexico', avgDrawRate: 0.27 },

  // 🇧🇷 Brazil
  '4424': { name: 'Brasileirão Serie A', country: 'Brazil', avgDrawRate: 0.28 },

  // 🇦🇷 Argentina
  '4425': { name: 'Liga Profesional', country: 'Argentina', avgDrawRate: 0.29 },

  // 🌍 International
  '4480': { name: 'Champions League', country: 'Europe', avgDrawRate: 0.24 },
  '4481': { name: 'Europa League', country: 'Europe', avgDrawRate: 0.26 },

  // 🌏 Asia / Oceania
  '4396': { name: 'A-League Men', country: 'Australia', avgDrawRate: 0.25 },

  // 🔥 HIGH DRAW LEAGUES (ADDED – VERY IMPORTANT)

  // 🇨🇭 Switzerland
  '4355': { name: 'Swiss Super League', country: 'Switzerland', avgDrawRate: 0.30 },

  // 🇦🇹 Austria
  '4356': { name: 'Austrian Bundesliga', country: 'Austria', avgDrawRate: 0.29 },

  // 🇨🇿 Czech Republic
  '4357': { name: 'Czech First League', country: 'Czech Republic', avgDrawRate: 0.30 },

  // 🇮🇱 Israel
  '4358': { name: 'Israeli Premier League', country: 'Israel', avgDrawRate: 0.31 },

  // 🇭🇺 Hungary
  '4359': { name: 'NB I', country: 'Hungary', avgDrawRate: 0.30 },

  // 🇷🇴 Romania
  '4360': { name: 'Liga I', country: 'Romania', avgDrawRate: 0.30 },

  // 🇸🇰 Slovakia
  '4361': { name: 'Slovak Super Liga', country: 'Slovakia', avgDrawRate: 0.31 },

  // 🇸🇮 Slovenia
  '4362': { name: 'PrvaLiga', country: 'Slovenia', avgDrawRate: 0.30 },

  // 🇿🇦 South Africa
  '4399': { name: 'PSL', country: 'South Africa', avgDrawRate: 0.32 },
};

// ─── Rate limit budget tracker ────────────────────────────────────────────────
// Expose remaining budget so callers can stop early if needed.

let requestsThisMinute = 0
let minuteWindowStart = Date.now()

export function getRateLimitBudget(): { used: number; remaining: number; resetIn: number } {
  const now = Date.now()
  if (now - minuteWindowStart > 60_000) {
    requestsThisMinute = 0
    minuteWindowStart = now
  }
  return {
    used:      requestsThisMinute,
    remaining: 30 - requestsThisMinute,
    resetIn:   Math.max(0, 60_000 - (now - minuteWindowStart)),
  }
}

// Wrap tsdbFetch to track usage (re-export for internal use)
export async function tsdbFetchTracked<T>(
  apiKey: string,
  endpoint: string,
  params: Record<string, string> = {}
): Promise<T | null> {
  const now = Date.now()
  if (now - minuteWindowStart > 60_000) {
    requestsThisMinute = 0
    minuteWindowStart = now
  }
  requestsThisMinute++
  return tsdbFetch<T>(apiKey, endpoint, params)
}