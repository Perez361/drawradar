// ─── AllSportsAPI client ──────────────────────────────────────────────────────
//
// Base URL: https://apiv2.allsportsapi.com/football/
// Key endpoints used by DrawRadar:
//   met=Fixtures   — fixtures by date range
//   met=H2H        — head-to-head between two teams
//   met=Odds       — pre-match 1x2 odds per match
//
// Response shape differs from API-Football:
//   • match_id, match_hometeam_id, match_awayteam_id  (string IDs)
//   • league_id, league_name, country_name
//   • match_date + match_time → ISO datetime
//   • match_hometeam_score / match_awayteam_score (empty string if not played)
//   • match_status: "NS" (not started), "FT", "" etc.
//   • goalscorer / cards arrays on detailed fixtures
//
// Odds endpoint (met=Odds) returns per-match:
//   odd_1 / odd_x / odd_2  (1=home, x=draw, 2=away) from multiple bookmakers

export const ALLSPORTS_BASE = 'https://apiv2.allsportsapi.com/football'

// ─── Raw response types ───────────────────────────────────────────────────────

export interface AllSportsFixture {
  match_id: string
  match_status: string          // "NS" | "FT" | "HT" | "1H" | "2H" | "" | etc.
  match_date: string            // "YYYY-MM-DD"
  match_time: string            // "HH:MM"
  match_hometeam_id: string
  match_hometeam_name: string
  match_awayteam_id: string
  match_awayteam_name: string
  match_hometeam_score: string  // "" when not played
  match_awayteam_score: string
  league_id: string
  league_name: string
  country_id: string
  country_name: string
  match_live: string            // "0" | "1"
}

export interface AllSportsOddsEntry {
  odd_bookmakers: string
  odd_1: string   // home win
  odd_x: string   // draw
  odd_2: string   // away win
  match_id: string
}

export interface AllSportsH2HFixture extends AllSportsFixture {
  // same shape, just returned in firstTeam_VS_secondTeam array
}

export interface AllSportsResponse<T> {
  success: number          // 1 = ok, 0 = error
  result: T | null
}

// ─── Fetch helper ─────────────────────────────────────────────────────────────

async function asFetch<T>(
  apiKey: string,
  params: Record<string, string>
): Promise<T | null> {
  const qs = new URLSearchParams({ APIkey: apiKey, ...params })
  const url = `${ALLSPORTS_BASE}/?${qs.toString()}`
  try {
    const res = await fetch(url, { cache: 'no-store' })
    if (!res.ok) {
      console.warn(`[allsports] HTTP ${res.status} for ${url}`)
      return null
    }
    const json = (await res.json()) as AllSportsResponse<T>
    if (json.success !== 1) {
      console.warn(`[allsports] API error response for met=${params.met}`)
      return null
    }
    return json.result
  } catch (err) {
    console.error(`[allsports] fetch error for met=${params.met}:`, err)
    return null
  }
}

// ─── Fixtures by date ─────────────────────────────────────────────────────────

export async function fetchAllSportsFixtures(
  apiKey: string,
  date: string  // "YYYY-MM-DD"
): Promise<AllSportsFixture[]> {
  const data = await asFetch<AllSportsFixture[]>(apiKey, {
    met: 'Fixtures',
    from: date,
    to: date,
  })
  return data ?? []
}

// ─── Odds for a specific match ────────────────────────────────────────────────

export async function fetchAllSportsOdds(
  apiKey: string,
  matchId: string
): Promise<AllSportsOddsEntry[]> {
  // met=Odds returns { matchId: [ {odd_bookmakers, odd_1, odd_x, odd_2}, ... ] }
  const data = await asFetch<Record<string, AllSportsOddsEntry[]>>(apiKey, {
    met: 'Odds',
    matchId,
  })
  if (!data) return []
  return data[matchId] ?? []
}

// ─── Extract best draw odds from bookmaker list ───────────────────────────────

const PRIORITY_BOOKS_AS = ['bet365', 'pinnacle', 'betway', 'bwin', '1xbet', 'unibet']

export function extractBestDrawOddsAS(entries: AllSportsOddsEntry[]): number {
  if (!entries.length) return 0

  // 1. Try priority bookmakers
  for (const preferred of PRIORITY_BOOKS_AS) {
    for (const e of entries) {
      if (e.odd_bookmakers.toLowerCase().includes(preferred)) {
        const odds = parseFloat(e.odd_x)
        if (odds >= 1.2 && odds <= 20) return Math.round(odds * 100) / 100
      }
    }
  }

  // 2. Clipped median fallback
  const allOdds = entries
    .map((e) => parseFloat(e.odd_x))
    .filter((o) => o >= 1.2 && o <= 20)
    .sort((a, b) => a - b)

  if (!allOdds.length) return 0
  const trimCount = Math.floor(allOdds.length * 0.15)
  const trimmed = allOdds.slice(trimCount, allOdds.length - trimCount)
  const src = trimmed.length ? trimmed : allOdds
  const mid = Math.floor(src.length / 2)
  const median =
    src.length % 2 !== 0 ? src[mid] : (src[mid - 1] + src[mid]) / 2
  return Math.round(median * 100) / 100
}

// ─── H2H between two teams ────────────────────────────────────────────────────

export interface AllSportsH2HResponse {
  firstTeam_VS_secondTeam: AllSportsH2HFixture[]
  firstTeam_lastResults: AllSportsH2HFixture[]
  secondTeam_lastResults: AllSportsH2HFixture[]
}

export async function fetchAllSportsH2H(
  apiKey: string,
  firstTeamId: string,
  secondTeamId: string
): Promise<AllSportsH2HResponse | null> {
  return asFetch<AllSportsH2HResponse>(apiKey, {
    met: 'H2H',
    firstTeamId,
    secondTeamId,
  })
}

// ─── Compute H2H draw stats from AllSports fixtures ──────────────────────────

export function computeAllSportsH2HStats(fixtures: AllSportsH2HFixture[]): {
  drawRate: number
  sampleSize: number
  isReal: boolean
} {
  const completed = fixtures.filter(
    (f) =>
      f.match_hometeam_score !== '' &&
      f.match_awayteam_score !== '' &&
      ['FT', 'AET', 'PEN'].includes(f.match_status)
  )

  if (completed.length < 3) {
    return { drawRate: 0.27, sampleSize: completed.length, isReal: false }
  }

  // Sort newest first
  const sorted = [...completed].sort(
    (a, b) =>
      new Date(`${b.match_date}T${b.match_time}`).getTime() -
      new Date(`${a.match_date}T${a.match_time}`).getTime()
  )

  let weightedDraws = 0
  let totalWeight = 0
  sorted.slice(0, 10).forEach((f, i) => {
    const w = i < 5 ? 2 : 1
    const isDraw =
      parseInt(f.match_hometeam_score) === parseInt(f.match_awayteam_score)
    weightedDraws += w * (isDraw ? 1 : 0)
    totalWeight += w
  })

  return {
    drawRate: Math.round((weightedDraws / totalWeight) * 1000) / 1000,
    sampleSize: sorted.length,
    isReal: sorted.length >= 5,
  }
}

// ─── Map AllSports fixture to a normalised shape ──────────────────────────────
// Used when AllSports is the PRIMARY source (not just odds supplement)

export interface NormalisedAllSportsFixture {
  external_id: string           // "allsp_<match_id>"
  allsports_match_id: string
  allsports_home_id: string
  allsports_away_id: string
  allsports_league_id: string
  league_name: string
  league_country: string
  home_team_name: string
  away_team_name: string
  match_date: string            // ISO datetime
  draw_odds: number             // 0 if not yet fetched
}

export function normaliseAllSportsFixture(
  f: AllSportsFixture,
  drawOdds = 0
): NormalisedAllSportsFixture {
  return {
    external_id:          `allsp_${f.match_id}`,
    allsports_match_id:   f.match_id,
    allsports_home_id:    f.match_hometeam_id,
    allsports_away_id:    f.match_awayteam_id,
    allsports_league_id:  f.league_id,
    league_name:          f.league_name,
    league_country:       f.country_name,
    home_team_name:       f.match_hometeam_name,
    away_team_name:       f.match_awayteam_name,
    match_date:           `${f.match_date}T${f.match_time}:00Z`,
    draw_odds:            drawOdds,
  }
}

// ─── Update accuracy: fetch results for past predictions ─────────────────────
// Given a list of match external IDs (allsp_*), fetch the actual results
// and return a map of external_id → { homeScore, awayScore, isDraw }

export async function fetchAllSportsResults(
  apiKey: string,
  matchIds: string[]  // raw allsports match IDs (no "allsp_" prefix)
): Promise<
  Map<string, { homeScore: number; awayScore: number; isDraw: boolean }>
> {
  const resultMap = new Map<
    string,
    { homeScore: number; awayScore: number; isDraw: boolean }
  >()

  // AllSports doesn't have a batch-by-ID endpoint for historical results;
  // we use the Fixtures endpoint with a specific matchId parameter.
  for (const matchId of matchIds) {
    const data = await asFetch<AllSportsFixture[]>(apiKey, {
      met: 'Fixtures',
      matchId,
    })
    if (!data || !data.length) continue
    const f = data[0]
    if (
      f.match_hometeam_score === '' ||
      f.match_awayteam_score === '' ||
      !['FT', 'AET', 'PEN'].includes(f.match_status)
    ) {
      continue
    }
    const home = parseInt(f.match_hometeam_score)
    const away = parseInt(f.match_awayteam_score)
    resultMap.set(matchId, { homeScore: home, awayScore: away, isDraw: home === away })
  }
  return resultMap
}