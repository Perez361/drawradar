// ─── API-Football client v2 ───────────────────────────────────────────────────
// New additions over v1:
//   • fetchH2H()          — real head-to-head fixture history
//   • fetchRecentFixtures()— last N results per team (form + fatigue)
//   • fetchOddsForFixtures()— batch odds with opening-odds storage
//   • All existing exports preserved for backward compat

export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io'

// ─── Raw API types ────────────────────────────────────────────────────────────

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

// ─── H2H types ────────────────────────────────────────────────────────────────

export interface H2HResult {
  fixtureId: number
  date: string
  homeTeamId: number
  awayTeamId: number
  homeGoals: number
  awayGoals: number
  isDraw: boolean
}

// ─── League info map ──────────────────────────────────────────────────────────

export const LEAGUE_ID_TO_INFO: Record<
  number,
  { name: string; country: string; avgDrawRate: number }
> = {
  264: { name: 'NPFL',                       country: 'Nigeria',        avgDrawRate: 0.33 },
  233: { name: 'Egyptian Premier League',    country: 'Egypt',          avgDrawRate: 0.32 },
  347: { name: 'Ligue Professionnelle 1',    country: 'Tunisia',        avgDrawRate: 0.31 },
  327: { name: 'Ligue Professionnelle 1',    country: 'Algeria',        avgDrawRate: 0.31 },
  200: { name: 'Botola Pro',                 country: 'Morocco',        avgDrawRate: 0.30 },
  289: { name: 'Premier Soccer League',      country: 'South Africa',   avgDrawRate: 0.29 },
  290: { name: 'Ghana Premier League',       country: 'Ghana',          avgDrawRate: 0.29 },
  357: { name: 'Premier League',             country: 'Kenya',          avgDrawRate: 0.28 },
  135: { name: 'Serie A',                    country: 'Italy',          avgDrawRate: 0.29 },
  136: { name: 'Serie B',                    country: 'Italy',          avgDrawRate: 0.30 },
  137: { name: 'Serie C',                    country: 'Italy',          avgDrawRate: 0.31 },
  61:  { name: 'Ligue 1',                    country: 'France',         avgDrawRate: 0.28 },
  62:  { name: 'Ligue 2',                    country: 'France',         avgDrawRate: 0.29 },
  63:  { name: 'National 1',                 country: 'France',         avgDrawRate: 0.30 },
  283: { name: 'Liga 1',                     country: 'Romania',        avgDrawRate: 0.30 },
  284: { name: 'Liga 2',                     country: 'Romania',        avgDrawRate: 0.31 },
  197: { name: 'Super League',               country: 'Greece',         avgDrawRate: 0.30 },
  198: { name: 'Super League 2',             country: 'Greece',         avgDrawRate: 0.31 },
  218: { name: 'SuperLiga',                  country: 'Serbia',         avgDrawRate: 0.29 },
  219: { name: 'First League',               country: 'Serbia',         avgDrawRate: 0.30 },
  106: { name: 'Ekstraklasa',                country: 'Poland',         avgDrawRate: 0.29 },
  107: { name: 'I Liga',                     country: 'Poland',         avgDrawRate: 0.30 },
  345: { name: 'Czech First League',         country: 'Czech Republic', avgDrawRate: 0.28 },
  346: { name: 'FNL',                        country: 'Czech Republic', avgDrawRate: 0.29 },
  94:  { name: 'Primeira Liga',              country: 'Portugal',       avgDrawRate: 0.28 },
  95:  { name: 'Liga Portugal 2',            country: 'Portugal',       avgDrawRate: 0.30 },
  203: { name: 'Super Lig',                  country: 'Turkey',         avgDrawRate: 0.28 },
  204: { name: 'TFF 1. Lig',                 country: 'Turkey',         avgDrawRate: 0.29 },
  210: { name: 'HNL',                        country: 'Croatia',        avgDrawRate: 0.28 },
  211: { name: 'HNL 2',                      country: 'Croatia',        avgDrawRate: 0.29 },
  140: { name: 'La Liga',                    country: 'Spain',          avgDrawRate: 0.27 },
  141: { name: 'Segunda División',           country: 'Spain',          avgDrawRate: 0.29 },
  142: { name: 'Primera RFEF',               country: 'Spain',          avgDrawRate: 0.30 },
  78:  { name: 'Bundesliga',                 country: 'Germany',        avgDrawRate: 0.24 },
  79:  { name: 'Bundesliga 2',               country: 'Germany',        avgDrawRate: 0.26 },
  80:  { name: '3. Liga',                    country: 'Germany',        avgDrawRate: 0.29 },
  39:  { name: 'Premier League',             country: 'England',        avgDrawRate: 0.26 },
  40:  { name: 'Championship',               country: 'England',        avgDrawRate: 0.28 },
  41:  { name: 'League One',                 country: 'England',        avgDrawRate: 0.27 },
  42:  { name: 'League Two',                 country: 'England',        avgDrawRate: 0.27 },
  43:  { name: 'National League',            country: 'England',        avgDrawRate: 0.28 },
  88:  { name: 'Eredivisie',                 country: 'Netherlands',    avgDrawRate: 0.25 },
  89:  { name: 'Eerste Divisie',             country: 'Netherlands',    avgDrawRate: 0.27 },
  144: { name: 'Pro League',                 country: 'Belgium',        avgDrawRate: 0.27 },
  145: { name: 'Challenger Pro League',      country: 'Belgium',        avgDrawRate: 0.29 },
  179: { name: 'Scottish Premiership',       country: 'Scotland',       avgDrawRate: 0.26 },
  180: { name: 'Championship',               country: 'Scotland',       avgDrawRate: 0.28 },
  103: { name: 'Allsvenskan',                country: 'Sweden',         avgDrawRate: 0.27 },
  104: { name: 'Superettan',                 country: 'Sweden',         avgDrawRate: 0.28 },
  113: { name: 'Eliteserien',                country: 'Norway',         avgDrawRate: 0.26 },
  114: { name: 'First Division',             country: 'Norway',         avgDrawRate: 0.28 },
  119: { name: 'Superliga',                  country: 'Denmark',        avgDrawRate: 0.27 },
  120: { name: '1st Division',               country: 'Denmark',        avgDrawRate: 0.29 },
  128: { name: 'Primera División',           country: 'Argentina',      avgDrawRate: 0.29 },
  130: { name: 'Primera Nacional',           country: 'Argentina',      avgDrawRate: 0.31 },
  131: { name: 'Torneo Federal A',           country: 'Argentina',      avgDrawRate: 0.32 },
  71:  { name: 'Brasileirão',                country: 'Brazil',         avgDrawRate: 0.28 },
  72:  { name: 'Serie B',                    country: 'Brazil',         avgDrawRate: 0.30 },
  73:  { name: 'Serie C',                    country: 'Brazil',         avgDrawRate: 0.31 },
  475: { name: 'Serie D',                    country: 'Brazil',         avgDrawRate: 0.32 },
  239: { name: 'Primera División',           country: 'Chile',          avgDrawRate: 0.28 },
  240: { name: 'Primera B',                  country: 'Chile',          avgDrawRate: 0.30 },
  242: { name: 'Categoría Primera A',        country: 'Colombia',       avgDrawRate: 0.28 },
  243: { name: 'Categoría Primera B',        country: 'Colombia',       avgDrawRate: 0.29 },
  262: { name: 'Liga MX',                    country: 'Mexico',         avgDrawRate: 0.27 },
  253: { name: 'MLS',                        country: 'USA',            avgDrawRate: 0.25 },
  238: { name: 'LigaPro',                    country: 'Ecuador',        avgDrawRate: 0.29 },
  268: { name: 'Primera División',           country: 'Uruguay',        avgDrawRate: 0.29 },
  293: { name: 'Primera División',           country: 'Venezuela',      avgDrawRate: 0.30 },
  321: { name: 'División Profesional',       country: 'Bolivia',        avgDrawRate: 0.31 },
  385: { name: 'División Profesional',       country: 'Paraguay',       avgDrawRate: 0.30 },
  307: { name: 'Persian Gulf Pro League',    country: 'Iran',           avgDrawRate: 0.31 },
  323: { name: 'Premier League',             country: 'Iraq',           avgDrawRate: 0.32 },
  318: { name: 'Premier League',             country: 'Lebanon',        avgDrawRate: 0.30 },
  319: { name: 'Premier League',             country: 'Jordan',         avgDrawRate: 0.30 },
  169: { name: 'Saudi Pro League',           country: 'Saudi Arabia',   avgDrawRate: 0.27 },
  308: { name: 'UAE Pro League',             country: 'UAE',            avgDrawRate: 0.28 },
  98:  { name: 'J1 League',                  country: 'Japan',          avgDrawRate: 0.26 },
  292: { name: 'K League 1',                 country: 'South Korea',    avgDrawRate: 0.27 },
  301: { name: 'Indian Super League',        country: 'India',          avgDrawRate: 0.27 },
  302: { name: 'I-League',                   country: 'India',          avgDrawRate: 0.28 },
  333: { name: 'Chinese Super League',       country: 'China',          avgDrawRate: 0.26 },
  188: { name: 'A-League',                   country: 'Australia',      avgDrawRate: 0.25 },
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(apiKey: string, path: string): Promise<T> {
  const url = `${API_FOOTBALL_BASE}${path}`
  const res = await fetch(url, { headers: { 'x-apisports-key': apiKey } })

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`API-Football ${path}: ${res.status} ${body}`)
  }

  const remaining = res.headers.get('x-ratelimit-requests-remaining')
  const used = res.headers.get('x-ratelimit-requests-used')
  console.log(`[API-Football] ${path} — used: ${used}, remaining: ${remaining}`)

  const data = await res.json()
  return (data.response ?? []) as T
}

export async function fetchFixturesForDate(
  apiKey: string,
  date: string
): Promise<ApiFootballFixture[]> {
  return apiFetch<ApiFootballFixture[]>(apiKey, `/fixtures?date=${date}&timezone=UTC`)
}

export async function fetchOddsForFixture(
  apiKey: string,
  fixtureId: number
): Promise<number> {
  try {
    const data = await apiFetch<ApiFootballOdds[]>(apiKey, `/odds?fixture=${fixtureId}&bet=1`)
    const bookmakers = data[0]?.bookmakers ?? []
    for (const bm of bookmakers) {
      const bet = bm.bets.find((b) => b.id === 1)
      if (!bet) continue
      const drawValue = bet.values.find((v) => v.value === 'Draw')
      if (drawValue) return parseFloat(drawValue.odd)
    }
    return 0
  } catch {
    return 0
  }
}

// ─── NEW: Fetch H2H fixtures ──────────────────────────────────────────────────
// Returns last N completed H2H meetings between two teams.
// Uses 1 API call per unique team pair.

export async function fetchH2H(
  apiKey: string,
  homeTeamId: number,
  awayTeamId: number,
  last = 10
): Promise<H2HResult[]> {
  try {
    const raw = await apiFetch<ApiFootballFixture[]>(
      apiKey,
      `/fixtures/headtohead?h2h=${homeTeamId}-${awayTeamId}&last=${last}`
    )

    return raw
      .filter(
        (f) =>
          f.goals.home !== null &&
          f.goals.away !== null &&
          !['NS', 'TBD', 'CANC', 'PST'].includes(f.fixture.status.short)
      )
      .map((f) => ({
        fixtureId: f.fixture.id,
        date: f.fixture.date,
        homeTeamId: f.teams.home.id,
        awayTeamId: f.teams.away.id,
        homeGoals: f.goals.home!,
        awayGoals: f.goals.away!,
        isDraw: f.goals.home === f.goals.away,
      }))
  } catch (err) {
    console.warn(`[H2H] failed for ${homeTeamId}-${awayTeamId}:`, err)
    return []
  }
}

// ─── NEW: Fetch recent team fixtures (form + fatigue) ─────────────────────────
// Returns last N completed fixtures for a team.
// Uses 1 API call per team (cache 24h to stay within quota).

export interface RecentFixture {
  date: string
  goalsScored: number
  goalsConceded: number
  isDraw: boolean
}

export async function fetchRecentFixtures(
  apiKey: string,
  teamId: number,
  leagueId: number,
  season: number,
  last = 5
): Promise<RecentFixture[]> {
  try {
    const raw = await apiFetch<ApiFootballFixture[]>(
      apiKey,
      `/fixtures?team=${teamId}&league=${leagueId}&season=${season}&last=${last}&status=FT`
    )

    return raw
      .filter((f) => f.goals.home !== null && f.goals.away !== null)
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
      .map((f) => {
        const isHome = f.teams.home.id === teamId
        const scored = isHome ? f.goals.home! : f.goals.away!
        const conceded = isHome ? f.goals.away! : f.goals.home!
        return {
          date: f.fixture.date,
          goalsScored: scored,
          goalsConceded: conceded,
          isDraw: f.goals.home === f.goals.away,
        }
      })
  } catch (err) {
    console.warn(`[recentFixtures] failed for team ${teamId}:`, err)
    return []
  }
}

// ─── MappedFixture (unchanged interface, new optional fields added) ───────────

export interface MappedFixture {
  external_id: string
  fixture_id: number
  home_team_id: number
  away_team_id: number
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
  h2h_is_real: boolean       // NEW — true = from API, false = blended estimate
  xg_home: number
  xg_away: number
  avg_draw_rate: number
  has_real_team_stats: boolean
  // Form features (new — null when not yet fetched)
  home_form_draw_rate: number | null
  away_form_draw_rate: number | null
  home_form_goals_avg: number | null
  away_form_goals_avg: number | null
  home_games_last14: number | null
  away_games_last14: number | null
  // Line movement (new)
  odds_open: number | null
  odds_movement: number | null
}

export interface PerTeamStats {
  goalsForAvg: number
  goalsAgainstAvg: number
  drawRate: number
}

export interface FormStats {
  formDrawRate: number
  formGoalsAvg: number
  gamesLast14: number
}

export function mapFixtureWithStats(
  fixture: ApiFootballFixture,
  drawOdds: number,
  homeStats: PerTeamStats | null,
  awayStats: PerTeamStats | null,
  h2hResults?: H2HResult[],
  homeForm?: FormStats | null,
  awayForm?: FormStats | null,
  openingDrawOdds?: number | null
): MappedFixture | null {
  const leagueInfo = LEAGUE_ID_TO_INFO[fixture.league.id]
  if (!leagueInfo) return null

  const status = fixture.fixture.status.short
  if (!['NS', 'TBD'].includes(status)) return null
  if (drawOdds <= 0) return null

  const avg = leagueInfo.avgDrawRate

  const homeGoalsFor    = homeStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const homeConcede     = homeStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const homeDrawRate    = homeStats?.drawRate        ?? avg
  const awayGoalsFor    = awayStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const awayConcede     = awayStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const awayDrawRate    = awayStats?.drawRate        ?? avg

  const xgHome = Math.round(((homeGoalsFor + awayConcede) / 2) * 100) / 100
  const xgAway = Math.round(((awayGoalsFor + homeConcede) / 2) * 100) / 100

  // H2H — use real data if available
  let h2hDrawRate = Math.round(((homeDrawRate + awayDrawRate) / 2) * 1000) / 1000
  let h2hIsReal = false
  if (h2hResults && h2hResults.length >= 3) {
    // Weight recent 2×
    const sorted = [...h2hResults].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    let weightedDraws = 0, totalWeight = 0
    sorted.slice(0, 10).forEach((r, i) => {
      const w = i < 5 ? 2 : 1
      weightedDraws += w * (r.isDraw ? 1 : 0)
      totalWeight += w
    })
    h2hDrawRate = Math.round((weightedDraws / totalWeight) * 1000) / 1000
    h2hIsReal = true
  }

  const oddsMovement =
    openingDrawOdds && openingDrawOdds > 0
      ? Math.round((drawOdds - openingDrawOdds) * 100) / 100
      : null

  return {
    external_id:         `apifb_${fixture.fixture.id}`,
    fixture_id:          fixture.fixture.id,
    home_team_id:        fixture.teams.home.id,
    away_team_id:        fixture.teams.away.id,
    league_id_ext:       fixture.league.id,
    league_name:         leagueInfo.name,
    league_country:      leagueInfo.country,
    home_team_name:      fixture.teams.home.name,
    away_team_name:      fixture.teams.away.name,
    match_date:          fixture.fixture.date,
    draw_odds:           drawOdds,
    home_goals_avg:      homeGoalsFor,
    away_goals_avg:      awayGoalsFor,
    home_concede_avg:    homeConcede,
    away_concede_avg:    awayConcede,
    home_draw_rate:      homeDrawRate,
    away_draw_rate:      awayDrawRate,
    h2h_draw_rate:       h2hDrawRate,
    h2h_is_real:         h2hIsReal,
    xg_home:             xgHome,
    xg_away:             xgAway,
    avg_draw_rate:       avg,
    has_real_team_stats: homeStats !== null || awayStats !== null,
    home_form_draw_rate: homeForm?.formDrawRate ?? null,
    away_form_draw_rate: awayForm?.formDrawRate ?? null,
    home_form_goals_avg: homeForm?.formGoalsAvg ?? null,
    away_form_goals_avg: awayForm?.formGoalsAvg ?? null,
    home_games_last14:   homeForm?.gamesLast14 ?? null,
    away_games_last14:   awayForm?.gamesLast14 ?? null,
    odds_open:           openingDrawOdds ?? null,
    odds_movement:       oddsMovement,
  }
}

// Keep old signature working
export function mapFixture(
  fixture: ApiFootballFixture,
  drawOdds: number
): MappedFixture | null {
  return mapFixtureWithStats(fixture, drawOdds, null, null)
}

// ─── League-level goal averages (baseline fallback) ───────────────────────────

function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    264: [1.28, 1.00], 233: [1.30, 1.02], 347: [1.32, 1.05], 327: [1.28, 1.00],
    200: [1.33, 1.06], 289: [1.38, 1.10], 290: [1.35, 1.08], 357: [1.33, 1.05],
    135: [1.49, 1.19], 136: [1.38, 1.08], 137: [1.32, 1.05],
    61:  [1.51, 1.18], 62:  [1.40, 1.10], 63:  [1.38, 1.08],
    283: [1.42, 1.12], 284: [1.38, 1.08],
    197: [1.43, 1.10], 198: [1.38, 1.08],
    218: [1.46, 1.12], 219: [1.42, 1.10],
    106: [1.46, 1.14], 107: [1.40, 1.10],
    345: [1.50, 1.16], 346: [1.45, 1.14],
    94:  [1.48, 1.14], 95:  [1.42, 1.12],
    203: [1.56, 1.24], 204: [1.48, 1.18],
    210: [1.48, 1.14], 211: [1.42, 1.12],
    140: [1.55, 1.22], 141: [1.40, 1.10], 142: [1.38, 1.08],
    78:  [1.72, 1.38], 79:  [1.60, 1.28], 80:  [1.45, 1.15],
    39:  [1.53, 1.22], 40:  [1.45, 1.15], 41:  [1.42, 1.12],
    42:  [1.38, 1.10], 43:  [1.40, 1.12],
    88:  [1.81, 1.44], 89:  [1.65, 1.30],
    144: [1.62, 1.28], 145: [1.50, 1.20],
    179: [1.55, 1.20], 180: [1.48, 1.18],
    103: [1.55, 1.20], 104: [1.50, 1.18],
    113: [1.60, 1.25], 114: [1.52, 1.20],
    119: [1.58, 1.22], 120: [1.50, 1.18],
    128: [1.50, 1.18], 130: [1.35, 1.05], 131: [1.28, 1.00],
    71:  [1.55, 1.20], 72:  [1.40, 1.10], 73:  [1.35, 1.05], 475: [1.28, 1.00],
    239: [1.45, 1.12], 240: [1.40, 1.10],
    242: [1.48, 1.15], 243: [1.45, 1.12],
    262: [1.48, 1.15], 253: [1.52, 1.22],
    238: [1.44, 1.12], 268: [1.42, 1.12], 293: [1.38, 1.08],
    321: [1.32, 1.05], 385: [1.38, 1.08],
    307: [1.35, 1.05], 323: [1.30, 1.02], 318: [1.32, 1.05], 319: [1.33, 1.05],
    169: [1.55, 1.22], 308: [1.40, 1.10],
    98:  [1.50, 1.18], 292: [1.48, 1.15],
    301: [1.42, 1.12], 302: [1.38, 1.10],
    333: [1.45, 1.15], 188: [1.48, 1.18],
  }
  const pair = baselines[leagueId] ?? [1.50, 1.20]
  return side === 'home' ? pair[0] : pair[1]
}