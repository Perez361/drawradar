// ─── API-Football client ──────────────────────────────────────────────────────
// Docs: https://www.api-football.com/documentation-v3
// Free tier: 100 requests/day — we use ~2/day (fixtures + nothing else needed)

export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io'

export interface ApiFootballFixture {
  fixture: {
    id: number
    date: string
    status: { short: string }
  }
  league: {
    id: number
    name: string
    country: string
    logo: string
    flag: string
    season: number
    round: string
  }
  teams: {
    home: { id: number; name: string; logo: string }
    away: { id: number; name: string; logo: string }
  }
  goals: {
    home: number | null
    away: number | null
  }
}

export interface ApiFootballOdds {
  fixture: { id: number }
  bookmakers: Array<{
    id: number
    name: string
    bets: Array<{
      id: number
      name: string
      values: Array<{ value: string; odd: string }>
    }>
  }>
}

// League IDs on API-Football we want to cover
// Full list: https://www.api-football.com/documentation-v3#tag/Leagues
export const LEAGUE_IDS = [
  // Top 5 Europe
  39,   // Premier League
  140,  // La Liga
  135,  // Serie A
  78,   // Bundesliga
  61,   // Ligue 1

  // Europe tier 2
  88,   // Eredivisie
  94,   // Primeira Liga
  203,  // Super Lig
  144,  // Pro League (Belgium)
  179,  // Scottish Premiership
  197,  // Super League (Greece)
  103,  // Allsvenskan (Sweden)
  113,  // Eliteserien (Norway)
  119,  // Superliga (Denmark)
  106,  // Ekstraklasa (Poland)
  345,  // Czech First League
  218,  // SuperLiga (Serbia)
  283,  // Liga 1 (Romania)
  210,  // HNL (Croatia)
  144,  // Austrian Bundesliga

  // England lower
  40,   // Championship
  41,   // League One
  42,   // League Two

  // Germany / Spain / Italy / France lower
  79,   // Bundesliga 2
  141,  // Segunda División
  136,  // Serie B
  62,   // Ligue 2

  // Americas
  71,   // Brasileirão
  128,  // Primera División (Argentina)
  262,  // Liga MX
  253,  // MLS
  239,  // Primera División (Chile)
  242,  // Categoría Primera A (Colombia)

  // Asia / Middle East
  98,   // J1 League (Japan)
  292,  // K League 1 (South Korea)
  169,  // Saudi Pro League
  188,  // A-League (Australia)
]

export const LEAGUE_ID_TO_INFO: Record<number, { name: string; country: string; avgDrawRate: number }> = {
  39:  { name: 'Premier League',        country: 'England',      avgDrawRate: 0.26 },
  140: { name: 'La Liga',               country: 'Spain',        avgDrawRate: 0.27 },
  135: { name: 'Serie A',               country: 'Italy',        avgDrawRate: 0.29 },
  78:  { name: 'Bundesliga',            country: 'Germany',      avgDrawRate: 0.24 },
  61:  { name: 'Ligue 1',               country: 'France',       avgDrawRate: 0.28 },
  88:  { name: 'Eredivisie',            country: 'Netherlands',  avgDrawRate: 0.25 },
  94:  { name: 'Primeira Liga',         country: 'Portugal',     avgDrawRate: 0.28 },
  203: { name: 'Super Lig',             country: 'Turkey',       avgDrawRate: 0.28 },
  144: { name: 'Pro League',            country: 'Belgium',      avgDrawRate: 0.27 },
  179: { name: 'Scottish Premiership',  country: 'Scotland',     avgDrawRate: 0.26 },
  197: { name: 'Super League',          country: 'Greece',       avgDrawRate: 0.30 },
  103: { name: 'Allsvenskan',           country: 'Sweden',       avgDrawRate: 0.27 },
  113: { name: 'Eliteserien',           country: 'Norway',       avgDrawRate: 0.26 },
  119: { name: 'Superliga',             country: 'Denmark',      avgDrawRate: 0.27 },
  106: { name: 'Ekstraklasa',           country: 'Poland',       avgDrawRate: 0.29 },
  345: { name: 'Czech First League',    country: 'Czech Republic', avgDrawRate: 0.28 },
  218: { name: 'SuperLiga',             country: 'Serbia',       avgDrawRate: 0.29 },
  283: { name: 'Liga 1',                country: 'Romania',      avgDrawRate: 0.30 },
  210: { name: 'HNL',                   country: 'Croatia',      avgDrawRate: 0.28 },
  40:  { name: 'Championship',          country: 'England',      avgDrawRate: 0.28 },
  41:  { name: 'League One',            country: 'England',      avgDrawRate: 0.27 },
  42:  { name: 'League Two',            country: 'England',      avgDrawRate: 0.27 },
  79:  { name: 'Bundesliga 2',          country: 'Germany',      avgDrawRate: 0.26 },
  141: { name: 'Segunda División',      country: 'Spain',        avgDrawRate: 0.29 },
  136: { name: 'Serie B',               country: 'Italy',        avgDrawRate: 0.30 },
  62:  { name: 'Ligue 2',               country: 'France',       avgDrawRate: 0.29 },
  71:  { name: 'Brasileirão',           country: 'Brazil',       avgDrawRate: 0.28 },
  128: { name: 'Primera División',      country: 'Argentina',    avgDrawRate: 0.29 },
  262: { name: 'Liga MX',               country: 'Mexico',       avgDrawRate: 0.27 },
  253: { name: 'MLS',                   country: 'USA',          avgDrawRate: 0.25 },
  239: { name: 'Primera División',      country: 'Chile',        avgDrawRate: 0.28 },
  242: { name: 'Categoría Primera A',   country: 'Colombia',     avgDrawRate: 0.28 },
  98:  { name: 'J1 League',             country: 'Japan',        avgDrawRate: 0.26 },
  292: { name: 'K League 1',            country: 'South Korea',  avgDrawRate: 0.27 },
  169: { name: 'Saudi Pro League',      country: 'Saudi Arabia', avgDrawRate: 0.27 },
  188: { name: 'A-League',              country: 'Australia',    avgDrawRate: 0.25 },
}

// Fetch all fixtures for a given date across all our leagues in ONE request
export async function fetchFixturesForDate(
  apiKey: string,
  date: string  // YYYY-MM-DD
): Promise<ApiFootballFixture[]> {
  const url = `${API_FOOTBALL_BASE}/fixtures?date=${date}&timezone=UTC`

  const res = await fetch(url, {
    headers: {
      'x-apisports-key': apiKey,
    },
  })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API-Football fixtures error: ${res.status} ${body}`)
  }

  const remaining = res.headers.get('x-ratelimit-requests-remaining')
  const used = res.headers.get('x-ratelimit-requests-used')
  console.log(`[API-Football] requests used: ${used}, remaining: ${remaining}`)

  const data = await res.json()
  return (data.response ?? []) as ApiFootballFixture[]
}

// Fetch pre-match odds for a fixture (match winner = bet id 1)
export async function fetchOddsForFixture(
  apiKey: string,
  fixtureId: number
): Promise<number> {
  const url = `${API_FOOTBALL_BASE}/odds?fixture=${fixtureId}&bet=1`

  const res = await fetch(url, {
    headers: { 'x-apisports-key': apiKey },
  })

  if (!res.ok) return 0

  const data = await res.json()
  const bookmakers: ApiFootballOdds['bookmakers'] = data.response?.[0]?.bookmakers ?? []

  // Try to get draw odds from available bookmakers
  for (const bm of bookmakers) {
    const bet = bm.bets.find((b) => b.id === 1)
    if (!bet) continue
    const drawValue = bet.values.find((v) => v.value === 'Draw')
    if (drawValue) return parseFloat(drawValue.odd)
  }

  return 0
}

export interface MappedFixture {
  external_id: string
  league_id_ext: number
  league_name: string
  league_country: string
  home_team_name: string
  away_team_name: string
  match_date: string
  draw_odds: number
  home_goals_avg: number
  away_goals_avg: number
  home_concede_avg: number
  away_concede_avg: number
  home_draw_rate: number
  away_draw_rate: number
  h2h_draw_rate: number
  xg_home: number
  xg_away: number
  avg_draw_rate: number
}

export function mapFixture(fixture: ApiFootballFixture, drawOdds: number): MappedFixture | null {
  const leagueInfo = LEAGUE_ID_TO_INFO[fixture.league.id]
  if (!leagueInfo) return null  // skip leagues we don't track

  // Only scheduled or not yet started
  const status = fixture.fixture.status.short
  if (!['NS', 'TBD'].includes(status)) return null

  const avg = leagueInfo.avgDrawRate

  // Estimate xG from league averages
  // Using league goal averages as baseline until we have per-team stats
  const homeGoalsAvg = getLeagueGoalsAvg(fixture.league.id, 'home')
  const awayGoalsAvg = getLeagueGoalsAvg(fixture.league.id, 'away')
  const homeConcede = getLeagueGoalsAvg(fixture.league.id, 'away')
  const awayConcede = getLeagueGoalsAvg(fixture.league.id, 'home')

  const xgHome = Math.round(((homeGoalsAvg + awayConcede) / 2) * 100) / 100
  const xgAway = Math.round(((awayGoalsAvg + homeConcede) / 2) * 100) / 100

  return {
    external_id:     `apifb_${fixture.fixture.id}`,
    league_id_ext:   fixture.league.id,
    league_name:     leagueInfo.name,
    league_country:  leagueInfo.country,
    home_team_name:  fixture.teams.home.name,
    away_team_name:  fixture.teams.away.name,
    match_date:      fixture.fixture.date,
    draw_odds:       drawOdds || 3.2,  // fallback to implied ~31% if no odds
    home_goals_avg:  homeGoalsAvg,
    away_goals_avg:  awayGoalsAvg,
    home_concede_avg: homeConcede,
    away_concede_avg: awayConcede,
    home_draw_rate:  avg,
    away_draw_rate:  avg,
    h2h_draw_rate:   avg,
    xg_home:         xgHome,
    xg_away:         xgAway,
    avg_draw_rate:   avg,
  }
}

// League goal averages baseline
function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    // [home, away]
    39:  [1.53, 1.22], 140: [1.55, 1.22], 135: [1.49, 1.19],
    78:  [1.72, 1.38], 61:  [1.51, 1.18], 88:  [1.81, 1.44],
    94:  [1.48, 1.14], 203: [1.58, 1.25], 144: [1.62, 1.28],
    179: [1.55, 1.20], 197: [1.45, 1.10], 103: [1.55, 1.20],
    113: [1.60, 1.25], 119: [1.58, 1.22], 106: [1.48, 1.15],
    345: [1.52, 1.18], 218: [1.48, 1.14], 283: [1.45, 1.12],
    210: [1.50, 1.15], 40:  [1.45, 1.15], 41:  [1.42, 1.12],
    42:  [1.38, 1.10], 79:  [1.60, 1.28], 141: [1.40, 1.10],
    136: [1.38, 1.08], 62:  [1.40, 1.10], 71:  [1.55, 1.20],
    128: [1.50, 1.18], 262: [1.48, 1.15], 253: [1.52, 1.22],
    239: [1.45, 1.12], 242: [1.48, 1.15], 98:  [1.50, 1.18],
    292: [1.48, 1.15], 169: [1.55, 1.22], 188: [1.48, 1.18],
  }
  const pair = baselines[leagueId] ?? [1.50, 1.20]
  return side === 'home' ? pair[0] : pair[1]
}