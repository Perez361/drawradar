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

// ─── League IDs — ordered by draw rate (highest first) ───────────────────────

export const LEAGUE_IDS = [
  // ~32–33% — highest draw rate
  264,  // NPFL (Nigeria)
  323,  // Iraq Premier League
  233,  // Egyptian Premier League
  131,  // Torneo Federal A (Argentina 3rd)
  475,  // Serie D (Brazil)
  321,  // División Profesional (Bolivia)

  // ~31%
  347,  // Tunisian Ligue Pro 1
  327,  // Algerian Ligue Pro 1
  307,  // Persian Gulf Pro League (Iran)
  73,   // Serie C (Brazil)
  137,  // Serie C / Lega Pro (Italy)
  198,  // Super League 2 (Greece)
  284,  // Liga 2 (Romania)
  130,  // Primera Nacional (Argentina 2nd)

  // ~30%
  200,  // Botola Pro (Morocco)
  283,  // Liga 1 (Romania)
  197,  // Super League (Greece)
  136,  // Serie B (Italy)
  62,   // Ligue 2 (France)
  63,   // National 1 (France)
  95,   // Liga Portugal 2
  142,  // Primera RFEF (Spain)
  318,  // Lebanon Premier League
  319,  // Jordan Premier League
  72,   // Serie B (Brazil)
  240,  // Primera B (Chile)
  293,  // Primera División (Venezuela)
  385,  // División Profesional (Paraguay)

  // ~29%
  135,  // Serie A (Italy)
  218,  // SuperLiga (Serbia)
  106,  // Ekstraklasa (Poland)
  219,  // First League (Serbia)
  107,  // I Liga (Poland)
  145,  // Challenger Pro League (Belgium)
  204,  // TFF 1. Lig (Turkey)
  120,  // 1st Division (Denmark)
  289,  // Premier Soccer League (South Africa)
  290,  // Ghana Premier League
  128,  // Primera División (Argentina)
  141,  // Segunda División (Spain)
  243,  // Categoría Primera B (Colombia)
  238,  // LigaPro (Ecuador)
  268,  // Primera División (Uruguay)
  346,  // FNL (Czech 2nd div)
  211,  // HNL 2 (Croatia)

  // ~28%
  345,  // Czech First League
  94,   // Primeira Liga (Portugal)
  61,   // Ligue 1 (France)
  203,  // Super Lig (Turkey)
  210,  // HNL (Croatia)
  40,   // Championship (England)
  71,   // Brasileirão (Brazil)
  239,  // Primera División (Chile)
  242,  // Categoría Primera A (Colombia)
  357,  // Kenya Premier League
  308,  // UAE Pro League
  43,   // National League (England)
  180,  // Championship (Scotland)
  104,  // Superettan (Sweden)
  114,  // First Division (Norway)

  // ~27%
  140,  // La Liga (Spain)
  144,  // Pro League (Belgium)
  179,  // Scottish Premiership
  103,  // Allsvenskan (Sweden)
  119,  // Superliga (Denmark)
  113,  // Eliteserien (Norway)
  39,   // Premier League (England)
  41,   // League One (England)
  42,   // League Two (England)
  79,   // Bundesliga 2 (Germany)
  169,  // Saudi Pro League
  292,  // K League 1 (South Korea)
  262,  // Liga MX (Mexico)
  89,   // Eerste Divisie (Netherlands)
  302,  // I-League (India)

  // ~26%
  80,   // 3. Liga (Germany)
  98,   // J1 League (Japan)
  39,   // Premier League (England)
  301,  // Indian Super League

  // ~25–26%
  78,   // Bundesliga (Germany)
  88,   // Eredivisie (Netherlands)
  253,  // MLS (USA)
  188,  // A-League (Australia)
  333,  // Chinese Super League
]

// ─── League info map ──────────────────────────────────────────────────────────

export const LEAGUE_ID_TO_INFO: Record<number, { name: string; country: string; avgDrawRate: number }> = {
  // ── Africa ──────────────────────────────────────────────────────────────────
  264: { name: 'NPFL',                          country: 'Nigeria',          avgDrawRate: 0.33 },
  233: { name: 'Egyptian Premier League',        country: 'Egypt',            avgDrawRate: 0.32 },
  347: { name: 'Ligue Professionnelle 1',        country: 'Tunisia',          avgDrawRate: 0.31 },
  327: { name: 'Ligue Professionnelle 1',        country: 'Algeria',          avgDrawRate: 0.31 },
  200: { name: 'Botola Pro',                     country: 'Morocco',          avgDrawRate: 0.30 },
  289: { name: 'Premier Soccer League',          country: 'South Africa',     avgDrawRate: 0.29 },
  290: { name: 'Ghana Premier League',           country: 'Ghana',            avgDrawRate: 0.29 },
  357: { name: 'Premier League',                 country: 'Kenya',            avgDrawRate: 0.28 },

  // ── Europe — Top Tier ────────────────────────────────────────────────────────
  135: { name: 'Serie A',                        country: 'Italy',            avgDrawRate: 0.29 },
  136: { name: 'Serie B',                        country: 'Italy',            avgDrawRate: 0.30 },
  137: { name: 'Serie C',                        country: 'Italy',            avgDrawRate: 0.31 },
  62:  { name: 'Ligue 2',                        country: 'France',           avgDrawRate: 0.29 },
  61:  { name: 'Ligue 1',                        country: 'France',           avgDrawRate: 0.28 },
  63:  { name: 'National 1',                     country: 'France',           avgDrawRate: 0.30 },
  283: { name: 'Liga 1',                         country: 'Romania',          avgDrawRate: 0.30 },
  284: { name: 'Liga 2',                         country: 'Romania',          avgDrawRate: 0.31 },
  197: { name: 'Super League',                   country: 'Greece',           avgDrawRate: 0.30 },
  198: { name: 'Super League 2',                 country: 'Greece',           avgDrawRate: 0.31 },
  218: { name: 'SuperLiga',                      country: 'Serbia',           avgDrawRate: 0.29 },
  219: { name: 'First League',                   country: 'Serbia',           avgDrawRate: 0.30 },
  106: { name: 'Ekstraklasa',                    country: 'Poland',           avgDrawRate: 0.29 },
  107: { name: 'I Liga',                         country: 'Poland',           avgDrawRate: 0.30 },
  345: { name: 'Czech First League',             country: 'Czech Republic',   avgDrawRate: 0.28 },
  346: { name: 'FNL',                            country: 'Czech Republic',   avgDrawRate: 0.29 },
  94:  { name: 'Primeira Liga',                  country: 'Portugal',         avgDrawRate: 0.28 },
  95:  { name: 'Liga Portugal 2',                country: 'Portugal',         avgDrawRate: 0.30 },
  203: { name: 'Super Lig',                      country: 'Turkey',           avgDrawRate: 0.28 },
  204: { name: 'TFF 1. Lig',                     country: 'Turkey',           avgDrawRate: 0.29 },
  210: { name: 'HNL',                            country: 'Croatia',          avgDrawRate: 0.28 },
  211: { name: 'HNL 2',                          country: 'Croatia',          avgDrawRate: 0.29 },
  140: { name: 'La Liga',                        country: 'Spain',            avgDrawRate: 0.27 },
  141: { name: 'Segunda División',               country: 'Spain',            avgDrawRate: 0.29 },
  142: { name: 'Primera RFEF',                   country: 'Spain',            avgDrawRate: 0.30 },
  78:  { name: 'Bundesliga',                     country: 'Germany',          avgDrawRate: 0.24 },
  79:  { name: 'Bundesliga 2',                   country: 'Germany',          avgDrawRate: 0.26 },
  80:  { name: '3. Liga',                        country: 'Germany',          avgDrawRate: 0.29 },
  39:  { name: 'Premier League',                 country: 'England',          avgDrawRate: 0.26 },
  40:  { name: 'Championship',                   country: 'England',          avgDrawRate: 0.28 },
  41:  { name: 'League One',                     country: 'England',          avgDrawRate: 0.27 },
  42:  { name: 'League Two',                     country: 'England',          avgDrawRate: 0.27 },
  43:  { name: 'National League',                country: 'England',          avgDrawRate: 0.28 },
  88:  { name: 'Eredivisie',                     country: 'Netherlands',      avgDrawRate: 0.25 },
  89:  { name: 'Eerste Divisie',                 country: 'Netherlands',      avgDrawRate: 0.27 },
  144: { name: 'Pro League',                     country: 'Belgium',          avgDrawRate: 0.27 },
  145: { name: 'Challenger Pro League',          country: 'Belgium',          avgDrawRate: 0.29 },
  179: { name: 'Scottish Premiership',           country: 'Scotland',         avgDrawRate: 0.26 },
  180: { name: 'Championship',                   country: 'Scotland',         avgDrawRate: 0.28 },
  103: { name: 'Allsvenskan',                    country: 'Sweden',           avgDrawRate: 0.27 },
  104: { name: 'Superettan',                     country: 'Sweden',           avgDrawRate: 0.28 },
  113: { name: 'Eliteserien',                    country: 'Norway',           avgDrawRate: 0.26 },
  114: { name: 'First Division',                 country: 'Norway',           avgDrawRate: 0.28 },
  119: { name: 'Superliga',                      country: 'Denmark',          avgDrawRate: 0.27 },
  120: { name: '1st Division',                   country: 'Denmark',          avgDrawRate: 0.29 },

  // ── Americas ─────────────────────────────────────────────────────────────────
  128: { name: 'Primera División',               country: 'Argentina',        avgDrawRate: 0.29 },
  130: { name: 'Primera Nacional',               country: 'Argentina',        avgDrawRate: 0.31 },
  131: { name: 'Torneo Federal A',               country: 'Argentina',        avgDrawRate: 0.32 },
  71:  { name: 'Brasileirão',                    country: 'Brazil',           avgDrawRate: 0.28 },
  72:  { name: 'Serie B',                        country: 'Brazil',           avgDrawRate: 0.30 },
  73:  { name: 'Serie C',                        country: 'Brazil',           avgDrawRate: 0.31 },
  475: { name: 'Serie D',                        country: 'Brazil',           avgDrawRate: 0.32 },
  239: { name: 'Primera División',               country: 'Chile',            avgDrawRate: 0.28 },
  240: { name: 'Primera B',                      country: 'Chile',            avgDrawRate: 0.30 },
  242: { name: 'Categoría Primera A',            country: 'Colombia',         avgDrawRate: 0.28 },
  243: { name: 'Categoría Primera B',            country: 'Colombia',         avgDrawRate: 0.29 },
  262: { name: 'Liga MX',                        country: 'Mexico',           avgDrawRate: 0.27 },
  253: { name: 'MLS',                            country: 'USA',              avgDrawRate: 0.25 },
  238: { name: 'LigaPro',                        country: 'Ecuador',          avgDrawRate: 0.29 },
  268: { name: 'Primera División',               country: 'Uruguay',          avgDrawRate: 0.29 },
  293: { name: 'Primera División',               country: 'Venezuela',        avgDrawRate: 0.30 },
  321: { name: 'División Profesional',           country: 'Bolivia',          avgDrawRate: 0.31 },
  385: { name: 'División Profesional',           country: 'Paraguay',         avgDrawRate: 0.30 },

  // ── Middle East ───────────────────────────────────────────────────────────────
  307: { name: 'Persian Gulf Pro League',        country: 'Iran',             avgDrawRate: 0.31 },
  323: { name: 'Premier League',                 country: 'Iraq',             avgDrawRate: 0.32 },
  318: { name: 'Premier League',                 country: 'Lebanon',          avgDrawRate: 0.30 },
  319: { name: 'Premier League',                 country: 'Jordan',           avgDrawRate: 0.30 },
  169: { name: 'Saudi Pro League',               country: 'Saudi Arabia',     avgDrawRate: 0.27 },
  308: { name: 'UAE Pro League',                 country: 'UAE',              avgDrawRate: 0.28 },

  // ── Asia / Oceania ────────────────────────────────────────────────────────────
  98:  { name: 'J1 League',                      country: 'Japan',            avgDrawRate: 0.26 },
  292: { name: 'K League 1',                     country: 'South Korea',      avgDrawRate: 0.27 },
  301: { name: 'Indian Super League',            country: 'India',            avgDrawRate: 0.27 },
  302: { name: 'I-League',                       country: 'India',            avgDrawRate: 0.28 },
  333: { name: 'Chinese Super League',           country: 'China',            avgDrawRate: 0.26 },
  188: { name: 'A-League',                       country: 'Australia',        avgDrawRate: 0.25 },
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

export async function fetchFixturesForDate(
  apiKey: string,
  date: string
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
  if (!leagueInfo) return null

  const status = fixture.fixture.status.short
  if (!['NS', 'TBD'].includes(status)) return null

  const avg = leagueInfo.avgDrawRate
  const homeGoalsAvg = getLeagueGoalsAvg(fixture.league.id, 'home')
  const awayGoalsAvg = getLeagueGoalsAvg(fixture.league.id, 'away')
  const homeConcede = getLeagueGoalsAvg(fixture.league.id, 'away')
  const awayConcede = getLeagueGoalsAvg(fixture.league.id, 'home')

  const xgHome = Math.round(((homeGoalsAvg + awayConcede) / 2) * 100) / 100
  const xgAway = Math.round(((awayGoalsAvg + homeConcede) / 2) * 100) / 100

  return {
    external_id:      `apifb_${fixture.fixture.id}`,
    league_id_ext:    fixture.league.id,
    league_name:      leagueInfo.name,
    league_country:   leagueInfo.country,
    home_team_name:   fixture.teams.home.name,
    away_team_name:   fixture.teams.away.name,
    match_date:       fixture.fixture.date,
    draw_odds:        drawOdds || 3.2,
    home_goals_avg:   homeGoalsAvg,
    away_goals_avg:   awayGoalsAvg,
    home_concede_avg: homeConcede,
    away_concede_avg: awayConcede,
    home_draw_rate:   avg,
    away_draw_rate:   avg,
    h2h_draw_rate:    avg,
    xg_home:          xgHome,
    xg_away:          xgAway,
    avg_draw_rate:    avg,
  }
}

// ─── League goal averages ─────────────────────────────────────────────────────

function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    // [home, away] — lower scoring = higher draw tendency

    // Africa
    264: [1.28, 1.00], // Nigeria NPFL
    233: [1.30, 1.02], // Egypt
    347: [1.32, 1.05], // Tunisia
    327: [1.28, 1.00], // Algeria
    200: [1.33, 1.06], // Morocco
    289: [1.38, 1.10], // South Africa
    290: [1.35, 1.08], // Ghana
    357: [1.33, 1.05], // Kenya

    // Italy
    135: [1.49, 1.19], // Serie A
    136: [1.38, 1.08], // Serie B
    137: [1.32, 1.05], // Serie C

    // France
    61:  [1.51, 1.18], // Ligue 1
    62:  [1.40, 1.10], // Ligue 2
    63:  [1.38, 1.08], // National 1

    // Romania
    283: [1.42, 1.12], // Liga 1
    284: [1.38, 1.08], // Liga 2

    // Greece
    197: [1.43, 1.10], // Super League
    198: [1.38, 1.08], // Super League 2

    // Serbia
    218: [1.46, 1.12], // SuperLiga
    219: [1.42, 1.10], // First League

    // Poland
    106: [1.46, 1.14], // Ekstraklasa
    107: [1.40, 1.10], // I Liga

    // Czech
    345: [1.50, 1.16], // First League
    346: [1.45, 1.14], // FNL

    // Portugal
    94:  [1.48, 1.14], // Primeira Liga
    95:  [1.42, 1.12], // Liga Portugal 2

    // Turkey
    203: [1.56, 1.24], // Super Lig
    204: [1.48, 1.18], // TFF 1. Lig

    // Croatia
    210: [1.48, 1.14], // HNL
    211: [1.42, 1.12], // HNL 2

    // Spain
    140: [1.55, 1.22], // La Liga
    141: [1.40, 1.10], // Segunda
    142: [1.38, 1.08], // Primera RFEF

    // Germany
    78:  [1.72, 1.38], // Bundesliga
    79:  [1.60, 1.28], // Bundesliga 2
    80:  [1.45, 1.15], // 3. Liga

    // England
    39:  [1.53, 1.22], // Premier League
    40:  [1.45, 1.15], // Championship
    41:  [1.42, 1.12], // League One
    42:  [1.38, 1.10], // League Two
    43:  [1.40, 1.12], // National League

    // Netherlands
    88:  [1.81, 1.44], // Eredivisie
    89:  [1.65, 1.30], // Eerste Divisie

    // Belgium
    144: [1.62, 1.28], // Pro League
    145: [1.50, 1.20], // Challenger Pro

    // Scotland
    179: [1.55, 1.20], // Premiership
    180: [1.48, 1.18], // Championship

    // Sweden
    103: [1.55, 1.20], // Allsvenskan
    104: [1.50, 1.18], // Superettan

    // Norway
    113: [1.60, 1.25], // Eliteserien
    114: [1.52, 1.20], // First Division

    // Denmark
    119: [1.58, 1.22], // Superliga
    120: [1.50, 1.18], // 1st Division

    // Argentina
    128: [1.50, 1.18], // Primera División
    130: [1.35, 1.05], // Primera Nacional
    131: [1.28, 1.00], // Torneo Federal A

    // Brazil
    71:  [1.55, 1.20], // Brasileirão
    72:  [1.40, 1.10], // Serie B
    73:  [1.35, 1.05], // Serie C
    475: [1.28, 1.00], // Serie D

    // Chile
    239: [1.45, 1.12], // Primera División
    240: [1.40, 1.10], // Primera B

    // Colombia
    242: [1.48, 1.15], // Categoría Primera A
    243: [1.45, 1.12], // Categoría Primera B

    // Mexico / USA
    262: [1.48, 1.15], // Liga MX
    253: [1.52, 1.22], // MLS

    // South America others
    238: [1.44, 1.12], // Ecuador LigaPro
    268: [1.42, 1.12], // Uruguay
    293: [1.38, 1.08], // Venezuela
    321: [1.32, 1.05], // Bolivia
    385: [1.38, 1.08], // Paraguay

    // Middle East
    307: [1.35, 1.05], // Iran
    323: [1.30, 1.02], // Iraq
    318: [1.32, 1.05], // Lebanon
    319: [1.33, 1.05], // Jordan
    169: [1.55, 1.22], // Saudi Pro League
    308: [1.40, 1.10], // UAE

    // Asia / Oceania
    98:  [1.50, 1.18], // J1 League
    292: [1.48, 1.15], // K League 1
    301: [1.42, 1.12], // Indian Super League
    302: [1.38, 1.10], // I-League
    333: [1.45, 1.15], // Chinese Super League
    188: [1.48, 1.18], // A-League
  }

  const pair = baselines[leagueId] ?? [1.50, 1.20]
  return side === 'home' ? pair[0] : pair[1]
}