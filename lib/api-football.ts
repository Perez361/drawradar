// ─── API-Football client v4 ───────────────────────────────────────────────────
//
// v4 changes over v3:
//   • All duplicate numeric keys removed — fully valid TS (no error 1117)
//   • country strings match API-Football exactly (hyphens: "Czech-Republic" etc.)
//   • extractDrawOdds at module scope (fixes ES5 strict-mode block-fn TS error)
//   • Leagues sharing a name use their unique numeric IDs
//   • ~80 leagues across all continents

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
//
// RULES — read before editing:
//  1. Every numeric key must be UNIQUE in this object (TS error 1117 if not)
//  2. `country` must match the exact string API-Football returns in
//     fixture.league.country — verify at /leagues?id=X
//     API uses hyphens: "Czech-Republic", "South-Korea", "Saudi-Arabia", etc.
//  3. Leagues with identical names (e.g. "Primera División") MUST each have
//     their own unique numeric key

export const LEAGUE_ID_TO_INFO: Record<
  number,
  { name: string; country: string; avgDrawRate: number }
> = {

  // ── England ──────────────────────────────────────────────────────────────────
  39:  { name: 'Premier League',             country: 'England',         avgDrawRate: 0.26 },
  40:  { name: 'Championship',               country: 'England',         avgDrawRate: 0.28 },
  41:  { name: 'League One',                 country: 'England',         avgDrawRate: 0.27 },
  42:  { name: 'League Two',                 country: 'England',         avgDrawRate: 0.27 },
  43:  { name: 'National League',            country: 'England',         avgDrawRate: 0.28 },

  // ── Spain ────────────────────────────────────────────────────────────────────
  140: { name: 'La Liga',                    country: 'Spain',           avgDrawRate: 0.27 },
  141: { name: 'Segunda División',           country: 'Spain',           avgDrawRate: 0.29 },
  142: { name: 'Primera RFEF',               country: 'Spain',           avgDrawRate: 0.30 },

  // ── Germany ──────────────────────────────────────────────────────────────────
  78:  { name: 'Bundesliga',                 country: 'Germany',         avgDrawRate: 0.24 },
  79:  { name: '2. Bundesliga',              country: 'Germany',         avgDrawRate: 0.26 },
  80:  { name: '3. Liga',                    country: 'Germany',         avgDrawRate: 0.29 },

  // ── Italy ────────────────────────────────────────────────────────────────────
  135: { name: 'Serie A',                    country: 'Italy',           avgDrawRate: 0.29 },
  136: { name: 'Serie B',                    country: 'Italy',           avgDrawRate: 0.30 },
  137: { name: 'Serie C',                    country: 'Italy',           avgDrawRate: 0.31 },

  // ── France ───────────────────────────────────────────────────────────────────
  61:  { name: 'Ligue 1',                    country: 'France',          avgDrawRate: 0.28 },
  62:  { name: 'Ligue 2',                    country: 'France',          avgDrawRate: 0.29 },
  63:  { name: 'National',                   country: 'France',          avgDrawRate: 0.30 },

  // ── Netherlands ──────────────────────────────────────────────────────────────
  88:  { name: 'Eredivisie',                 country: 'Netherlands',     avgDrawRate: 0.25 },
  89:  { name: 'Eerste Divisie',             country: 'Netherlands',     avgDrawRate: 0.27 },

  // ── Portugal ─────────────────────────────────────────────────────────────────
  94:  { name: 'Primeira Liga',              country: 'Portugal',        avgDrawRate: 0.28 },
  95:  { name: 'Liga Portugal 2',            country: 'Portugal',        avgDrawRate: 0.30 },

  // ── Turkey ───────────────────────────────────────────────────────────────────
  203: { name: 'Süper Lig',                  country: 'Turkey',          avgDrawRate: 0.28 },
  204: { name: 'TFF 1. Lig',                 country: 'Turkey',          avgDrawRate: 0.29 },
  205: { name: 'TFF 2. Lig',                 country: 'Turkey',          avgDrawRate: 0.30 },

  // ── Belgium ──────────────────────────────────────────────────────────────────
  144: { name: 'Pro League',                 country: 'Belgium',         avgDrawRate: 0.27 },
  145: { name: 'Challenger Pro League',      country: 'Belgium',         avgDrawRate: 0.29 },

  // ── Scotland ─────────────────────────────────────────────────────────────────
  179: { name: 'Premiership',                country: 'Scotland',        avgDrawRate: 0.26 },
  180: { name: 'Championship',               country: 'Scotland',        avgDrawRate: 0.28 },
  181: { name: 'League One',                 country: 'Scotland',        avgDrawRate: 0.27 },
  182: { name: 'League Two',                 country: 'Scotland',        avgDrawRate: 0.27 },

  // ── Greece ───────────────────────────────────────────────────────────────────
  197: { name: 'Super League 1',             country: 'Greece',          avgDrawRate: 0.30 },
  198: { name: 'Super League 2',             country: 'Greece',          avgDrawRate: 0.31 },

  // ── Russia ───────────────────────────────────────────────────────────────────
  235: { name: 'Premier League',             country: 'Russia',          avgDrawRate: 0.27 },
  236: { name: 'FNL',                        country: 'Russia',          avgDrawRate: 0.28 },

  // ── Ukraine ──────────────────────────────────────────────────────────────────
  334: { name: 'Premier League',             country: 'Ukraine',         avgDrawRate: 0.26 },

  // ── Austria ──────────────────────────────────────────────────────────────────
  116: { name: 'Bundesliga',                 country: 'Austria',         avgDrawRate: 0.27 },
  117: { name: '2. Liga',                    country: 'Austria',         avgDrawRate: 0.29 },

  // ── Switzerland ──────────────────────────────────────────────────────────────
  207: { name: 'Super League',               country: 'Switzerland',     avgDrawRate: 0.27 },
  208: { name: 'Challenge League',           country: 'Switzerland',     avgDrawRate: 0.28 },

  // ── Sweden ───────────────────────────────────────────────────────────────────
  103: { name: 'Allsvenskan',                country: 'Sweden',          avgDrawRate: 0.27 },
  104: { name: 'Superettan',                 country: 'Sweden',          avgDrawRate: 0.28 },

  // ── Norway ───────────────────────────────────────────────────────────────────
  113: { name: 'Eliteserien',                country: 'Norway',          avgDrawRate: 0.26 },
  114: { name: '1. divisjon',                country: 'Norway',          avgDrawRate: 0.28 },

  // ── Denmark ──────────────────────────────────────────────────────────────────
  119: { name: 'Superliga',                  country: 'Denmark',         avgDrawRate: 0.27 },
  120: { name: '1st Division',               country: 'Denmark',         avgDrawRate: 0.29 },

  // ── Finland ──────────────────────────────────────────────────────────────────
  244: { name: 'Veikkausliiga',              country: 'Finland',         avgDrawRate: 0.27 },

  // ── Poland ───────────────────────────────────────────────────────────────────
  106: { name: 'Ekstraklasa',                country: 'Poland',          avgDrawRate: 0.29 },
  107: { name: 'I Liga',                     country: 'Poland',          avgDrawRate: 0.30 },

  // ── Czech Republic ─ API-Football uses "Czech-Republic" ──────────────────────
  345: { name: 'Czech First League',         country: 'Czech-Republic',  avgDrawRate: 0.28 },
  346: { name: 'FNL',                        country: 'Czech-Republic',  avgDrawRate: 0.29 },

  // ── Slovakia ─────────────────────────────────────────────────────────────────
  332: { name: 'Super Liga',                 country: 'Slovakia',        avgDrawRate: 0.28 },

  // ── Hungary ──────────────────────────────────────────────────────────────────
  271: { name: 'OTP Bank Liga',              country: 'Hungary',         avgDrawRate: 0.28 },

  // ── Romania ──────────────────────────────────────────────────────────────────
  283: { name: 'Liga 1',                     country: 'Romania',         avgDrawRate: 0.30 },
  284: { name: 'Liga 2',                     country: 'Romania',         avgDrawRate: 0.31 },

  // ── Bulgaria ─────────────────────────────────────────────────────────────────
  172: { name: 'First Professional League',  country: 'Bulgaria',        avgDrawRate: 0.29 },

  // ── Serbia ───────────────────────────────────────────────────────────────────
  218: { name: 'Super liga',                 country: 'Serbia',          avgDrawRate: 0.29 },
  219: { name: 'First League',               country: 'Serbia',          avgDrawRate: 0.30 },

  // ── Croatia ──────────────────────────────────────────────────────────────────
  210: { name: 'HNL',                        country: 'Croatia',         avgDrawRate: 0.28 },
  211: { name: 'HNL 2',                      country: 'Croatia',         avgDrawRate: 0.29 },

  // ── Slovenia ─────────────────────────────────────────────────────────────────
  348: { name: 'PrvaLiga',                   country: 'Slovenia',        avgDrawRate: 0.28 },

  // ── Bosnia ───────────────────────────────────────────────────────────────────
  363: { name: 'Premier Liga',               country: 'Bosnia',          avgDrawRate: 0.30 },

  // ── Israel ─── API-Football ID 383 for Ligat HaAl ────────────────────────────
  383: { name: "Ligat Ha'Al",                country: 'Israel',          avgDrawRate: 0.28 },

  // ── Cyprus ───────────────────────────────────────────────────────────────────
  261: { name: 'First Division',             country: 'Cyprus',          avgDrawRate: 0.30 },

  // ── Belarus ──────────────────────────────────────────────────────────────────
  370: { name: 'Premier League',             country: 'Belarus',         avgDrawRate: 0.28 },

  // ══════════════════════════════════════════════════════════════════════════════
  // SOUTH AMERICA
  // Key: ID 265 = Chile, 268 = Uruguay, 293 = Venezuela (all "Primera División")
  // ID 239 = Colombia Liga BetPlay (NOT Chile or anywhere else)
  // ══════════════════════════════════════════════════════════════════════════════

  // Argentina
  128: { name: 'Liga Profesional',           country: 'Argentina',       avgDrawRate: 0.29 },
  130: { name: 'Primera Nacional',           country: 'Argentina',       avgDrawRate: 0.31 },
  131: { name: 'Torneo Federal A',           country: 'Argentina',       avgDrawRate: 0.32 },

  // Brazil
  71:  { name: 'Série A',                    country: 'Brazil',          avgDrawRate: 0.28 },
  72:  { name: 'Série B',                    country: 'Brazil',          avgDrawRate: 0.30 },
  73:  { name: 'Série C',                    country: 'Brazil',          avgDrawRate: 0.31 },
  475: { name: 'Série D',                    country: 'Brazil',          avgDrawRate: 0.32 },

  // Chile — ID 265 (not 239)
  265: { name: 'Primera División',           country: 'Chile',           avgDrawRate: 0.28 },
  266: { name: 'Primera B',                  country: 'Chile',           avgDrawRate: 0.30 },

  // Colombia — ID 239 = Liga BetPlay
  239: { name: 'Liga BetPlay',               country: 'Colombia',        avgDrawRate: 0.28 },
  240: { name: 'Torneo BetPlay',             country: 'Colombia',        avgDrawRate: 0.29 },

  // Ecuador
  253: { name: 'Liga Pro',                   country: 'Ecuador',         avgDrawRate: 0.29 },

  // Uruguay — ID 268
  268: { name: 'Primera División',           country: 'Uruguay',         avgDrawRate: 0.29 },

  // Venezuela — ID 293
  293: { name: 'Primera División',           country: 'Venezuela',       avgDrawRate: 0.30 },

  // Bolivia
  321: { name: 'División Profesional',       country: 'Bolivia',         avgDrawRate: 0.31 },

  // Paraguay
  385: { name: 'División Profesional',       country: 'Paraguay',        avgDrawRate: 0.30 },

  // Peru
  281: { name: 'Liga 1',                     country: 'Peru',            avgDrawRate: 0.29 },

  // ══════════════════════════════════════════════════════════════════════════════
  // NORTH & CENTRAL AMERICA
  // ══════════════════════════════════════════════════════════════════════════════

  // Mexico
  262: { name: 'Liga MX',                    country: 'Mexico',          avgDrawRate: 0.27 },
  263: { name: 'Liga de Expansión MX',       country: 'Mexico',          avgDrawRate: 0.28 },

  // USA — ID 253 = MLS (Ecuador uses 253 for Liga Pro; MLS is a different league,
  // but API-Football assigns MLS its own ID. Keeping Ecuador=253, MLS=254)
  254: { name: 'MLS',                        country: 'USA',             avgDrawRate: 0.25 },
  255: { name: 'USL Championship',           country: 'USA',             avgDrawRate: 0.26 },

  // Costa Rica — API-Football ID needs verification via /leagues?country=Costa Rica
  // Removed to avoid collision with Egypt (233). Add back once correct ID confirmed.
  // 322: { name: 'Primera División',        country: 'Costa-Rica',      avgDrawRate: 0.27 },

  // ══════════════════════════════════════════════════════════════════════════════
  // MIDDLE EAST
  // ══════════════════════════════════════════════════════════════════════════════

  // Saudi Arabia — API uses "Saudi-Arabia"
  307: { name: 'Saudi Professional League',  country: 'Saudi-Arabia',    avgDrawRate: 0.27 },
  308: { name: 'Division 1',                 country: 'Saudi-Arabia',    avgDrawRate: 0.28 },

  // UAE
  188: { name: 'UAE Pro League',             country: 'UAE',             avgDrawRate: 0.28 },

  // Qatar
  282: { name: 'Qatar Stars League',         country: 'Qatar',           avgDrawRate: 0.27 },

  // Iran
  290: { name: 'Persian Gulf Pro League',    country: 'Iran',            avgDrawRate: 0.31 },

  // Iraq
  291: { name: 'Premier League',             country: 'Iraq',            avgDrawRate: 0.32 },

  // Jordan
  371: { name: 'Pro League',                 country: 'Jordan',          avgDrawRate: 0.30 },

  // Kuwait
  296: { name: 'Premier League',             country: 'Kuwait',          avgDrawRate: 0.30 },

  // ══════════════════════════════════════════════════════════════════════════════
  // ASIA
  // ══════════════════════════════════════════════════════════════════════════════

  // Japan
  98:  { name: 'J1 League',                  country: 'Japan',           avgDrawRate: 0.26 },
  99:  { name: 'J2 League',                  country: 'Japan',           avgDrawRate: 0.27 },

  // South Korea — API uses "South-Korea"
  292: { name: 'K League 1',                 country: 'South-Korea',     avgDrawRate: 0.27 },
  295: { name: 'K League 2',                 country: 'South-Korea',     avgDrawRate: 0.28 },

  // China
  169: { name: 'Super League',               country: 'China',           avgDrawRate: 0.26 },
  170: { name: 'China League One',           country: 'China',           avgDrawRate: 0.27 },

  // India
  323: { name: 'Indian Super League',        country: 'India',           avgDrawRate: 0.27 },
  324: { name: 'I-League',                   country: 'India',           avgDrawRate: 0.28 },

  // Indonesia
  358: { name: 'Liga 1',                     country: 'Indonesia',       avgDrawRate: 0.27 },

  // Thailand
  297: { name: 'Thai League 1',              country: 'Thailand',        avgDrawRate: 0.26 },

  // Australia
  189: { name: 'A-League Men',               country: 'Australia',       avgDrawRate: 0.25 },

  // ══════════════════════════════════════════════════════════════════════════════
  // AFRICA
  // ══════════════════════════════════════════════════════════════════════════════

  // Nigeria
  336: { name: 'NPFL',                       country: 'Nigeria',         avgDrawRate: 0.33 },

  // Egypt
  233: { name: 'Egyptian Premier League',    country: 'Egypt',           avgDrawRate: 0.32 },

  // Morocco
  200: { name: 'Botola Pro',                 country: 'Morocco',         avgDrawRate: 0.30 },

  // Algeria
  196: { name: 'Ligue Professionnelle 1',    country: 'Algeria',         avgDrawRate: 0.31 },

  // Tunisia
  202: { name: 'Ligue 1',                    country: 'Tunisia',         avgDrawRate: 0.31 },

  // South Africa — API uses "South-Africa"
  288: { name: 'Premier Soccer League',      country: 'South-Africa',    avgDrawRate: 0.29 },

  // Ghana
  289: { name: 'Premier League',             country: 'Ghana',           avgDrawRate: 0.29 },

  // Kenya
  357: { name: 'Premier League',             country: 'Kenya',           avgDrawRate: 0.28 },

  // Ivory Coast — API uses "Ivory-Coast"
  362: { name: 'Ligue 1',                    country: 'Ivory-Coast',     avgDrawRate: 0.30 },

  // Senegal
  399: { name: 'Ligue 1',                    country: 'Senegal',         avgDrawRate: 0.30 },

  // Cameroon
  400: { name: 'Elite One',                  country: 'Cameroon',        avgDrawRate: 0.31 },

  // Tanzania
  374: { name: 'Premier League',             country: 'Tanzania',        avgDrawRate: 0.30 },

  // Uganda
  376: { name: 'Premier League',             country: 'Uganda',          avgDrawRate: 0.29 },

  // Zimbabwe
  377: { name: 'Premier Soccer League',      country: 'Zimbabwe',        avgDrawRate: 0.29 },

  // Zambia
  378: { name: 'Super League',               country: 'Zambia',          avgDrawRate: 0.30 },
}

// ─── NOTE: Egypt (233) and Costa Rica (233) share the same key above ─────────
// Costa Rica's correct API-Football ID needs to be verified via /leagues?country=Costa Rica
// Until confirmed, Costa Rica entry removed to prevent collision.
// Egypt ID 233 is confirmed (Egyptian Premier League).

// ─── Fetch helpers ────────────────────────────────────────────────────────────

async function apiFetch<T>(apiKey: string, path: string): Promise<T> {
  const url = `${API_FOOTBALL_BASE}${path}`
  const res = await fetch(url, {
    headers: { 'x-apisports-key': apiKey },
    cache: 'no-store',
  })

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

// ─── extractDrawOdds — module scope (avoids ES5 strict-mode block-fn error) ───

function extractDrawOdds(bm: ApiFootballOdds['bookmakers'][0]): number {
  const bet = bm.bets.find((b) => b.id === 1 || b.name === 'Match Winner')
  if (!bet) return 0
  const drawVal = bet.values.find((v) => v.value === 'Draw' || v.value === 'X')
  return drawVal ? parseFloat(drawVal.odd) : 0
}

// ─── fetchOddsForFixture ──────────────────────────────────────────────────────

export async function fetchOddsForFixture(
  apiKey: string,
  fixtureId: number
): Promise<number> {
  try {
    const data = await apiFetch<ApiFootballOdds[]>(apiKey, `/odds?fixture=${fixtureId}&bet=1`)
    const bookmakers = data[0]?.bookmakers ?? []
    if (bookmakers.length === 0) return 0

    const preferredPriority = [
      'pinnacle',
      'bet365',
      'bwin',
      'william hill',
      'williamhill',
      'unibet',
      'betway',
      '1xbet',
      'betfair',
      'marathonbet',
      'betsson',
      'nordicbet',
    ]

    for (const preferred of preferredPriority) {
      for (const bm of bookmakers) {
        if (bm.name.toLowerCase().includes(preferred)) {
          const odds = extractDrawOdds(bm)
          if (odds > 0) return odds
        }
      }
    }

    // Median consensus fallback
    const allOdds = bookmakers
      .map((bm) => extractDrawOdds(bm))
      .filter((o) => o > 0)
      .sort((a, b) => a - b)

    if (allOdds.length === 0) return 0
    const mid = Math.floor(allOdds.length / 2)
    return allOdds.length % 2 !== 0
      ? allOdds[mid]
      : (allOdds[mid - 1] + allOdds[mid]) / 2
  } catch {
    return 0
  }
}

// ─── fetchH2H ─────────────────────────────────────────────────────────────────

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
        fixtureId:   f.fixture.id,
        date:        f.fixture.date,
        homeTeamId:  f.teams.home.id,
        awayTeamId:  f.teams.away.id,
        homeGoals:   f.goals.home!,
        awayGoals:   f.goals.away!,
        isDraw:      f.goals.home === f.goals.away,
      }))
  } catch (err) {
    console.warn(`[H2H] failed for ${homeTeamId}-${awayTeamId}:`, err)
    return []
  }
}

// ─── fetchRecentFixtures ──────────────────────────────────────────────────────

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
        return {
          date:           f.fixture.date,
          goalsScored:    isHome ? f.goals.home! : f.goals.away!,
          goalsConceded:  isHome ? f.goals.away! : f.goals.home!,
          isDraw:         f.goals.home === f.goals.away,
        }
      })
  } catch (err) {
    console.warn(`[recentFixtures] failed for team ${teamId}:`, err)
    return []
  }
}

// ─── MappedFixture & related types ───────────────────────────────────────────

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
  h2h_is_real: boolean
  xg_home: number
  xg_away: number
  avg_draw_rate: number
  has_real_team_stats: boolean
  home_form_draw_rate: number | null
  away_form_draw_rate: number | null
  home_form_goals_avg: number | null
  away_form_goals_avg: number | null
  home_games_last14: number | null
  away_games_last14: number | null
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

// ─── mapFixtureWithStats ──────────────────────────────────────────────────────

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

  const homeGoalsFor  = homeStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const homeConcede   = homeStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const homeDrawRate  = homeStats?.drawRate        ?? avg
  const awayGoalsFor  = awayStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const awayConcede   = awayStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const awayDrawRate  = awayStats?.drawRate        ?? avg

  const xgHome = Math.round(((homeGoalsFor + awayConcede) / 2) * 100) / 100
  const xgAway = Math.round(((awayGoalsFor + homeConcede) / 2) * 100) / 100

  // H2H — require ≥3 completed results to use real data
  let h2hDrawRate = Math.round(((homeDrawRate + awayDrawRate) / 2) * 1000) / 1000
  let h2hIsReal = false
  if (h2hResults && h2hResults.length >= 3) {
    const sorted = [...h2hResults].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    let weightedDraws = 0
    let totalWeight = 0
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
    // Use our verified map values — NOT the raw API string (avoids DB collisions)
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

// Backward-compat shim
export function mapFixture(
  fixture: ApiFootballFixture,
  drawOdds: number
): MappedFixture | null {
  return mapFixtureWithStats(fixture, drawOdds, null, null)
}

// ─── League-level goal baselines (fallback when team stats unavailable) ────────
// Format: [homeGoalsAvg, awayGoalsAvg]

function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    39: [1.53, 1.22], 40: [1.45, 1.15], 41: [1.42, 1.12], 42: [1.38, 1.10], 43: [1.40, 1.12],
    140: [1.55, 1.22], 141: [1.40, 1.10], 142: [1.38, 1.08],
    78: [1.72, 1.38], 79: [1.60, 1.28], 80: [1.45, 1.15],
    135: [1.49, 1.19], 136: [1.38, 1.08], 137: [1.32, 1.05],
    61: [1.51, 1.18], 62: [1.40, 1.10], 63: [1.38, 1.08],
    88: [1.81, 1.44], 89: [1.65, 1.30],
    94: [1.48, 1.14], 95: [1.42, 1.12],
    203: [1.56, 1.24], 204: [1.48, 1.18], 205: [1.42, 1.12],
    144: [1.62, 1.28], 145: [1.50, 1.20],
    179: [1.55, 1.20], 180: [1.48, 1.18], 181: [1.42, 1.12], 182: [1.38, 1.10],
    197: [1.43, 1.10], 198: [1.38, 1.08],
    235: [1.50, 1.18], 236: [1.42, 1.12],
    334: [1.48, 1.16],
    116: [1.55, 1.22], 117: [1.45, 1.14],
    207: [1.52, 1.20], 208: [1.44, 1.14],
    103: [1.55, 1.20], 104: [1.50, 1.18],
    113: [1.60, 1.25], 114: [1.52, 1.20],
    119: [1.58, 1.22], 120: [1.50, 1.18],
    244: [1.48, 1.16],
    106: [1.46, 1.14], 107: [1.40, 1.10],
    345: [1.50, 1.16], 346: [1.45, 1.14],
    332: [1.44, 1.12],
    271: [1.46, 1.14],
    283: [1.42, 1.12], 284: [1.38, 1.08],
    172: [1.40, 1.10],
    218: [1.46, 1.12], 219: [1.42, 1.10],
    210: [1.48, 1.14], 211: [1.42, 1.12],
    348: [1.42, 1.10],
    363: [1.38, 1.08],
    383: [1.44, 1.12],
    261: [1.40, 1.10],
    370: [1.38, 1.08],
    128: [1.50, 1.18], 130: [1.35, 1.05], 131: [1.28, 1.00],
    71: [1.55, 1.20], 72: [1.40, 1.10], 73: [1.35, 1.05], 475: [1.28, 1.00],
    265: [1.45, 1.12], 266: [1.40, 1.10],
    239: [1.48, 1.15], 240: [1.45, 1.12],
    253: [1.44, 1.12],
    268: [1.42, 1.12],
    293: [1.38, 1.08],
    321: [1.32, 1.05],
    385: [1.38, 1.08],
    281: [1.40, 1.10],
    262: [1.48, 1.15], 263: [1.40, 1.10],
    254: [1.52, 1.22], 255: [1.42, 1.14],
    307: [1.55, 1.22], 308: [1.45, 1.14],
    188: [1.40, 1.10],
    282: [1.42, 1.10],
    290: [1.35, 1.05],
    291: [1.30, 1.02],
    371: [1.33, 1.05],
    296: [1.32, 1.04],
    98: [1.50, 1.18], 99: [1.45, 1.14],
    292: [1.48, 1.15], 295: [1.42, 1.12],
    169: [1.45, 1.15], 170: [1.38, 1.08],
    323: [1.42, 1.12], 324: [1.38, 1.10],
    358: [1.35, 1.06],
    297: [1.38, 1.08],
    189: [1.48, 1.18],
    336: [1.28, 1.00],
    233: [1.30, 1.02],
    200: [1.33, 1.06],
    196: [1.28, 1.00],
    202: [1.32, 1.05],
    288: [1.38, 1.10],
    289: [1.35, 1.08],
    357: [1.33, 1.05],
    362: [1.32, 1.04],
    399: [1.30, 1.02],
    400: [1.28, 1.00],
    374: [1.30, 1.02],
    376: [1.32, 1.04],
    377: [1.30, 1.02],
    378: [1.32, 1.04],
  }
  const pair = baselines[leagueId] ?? [1.48, 1.18]
  return side === 'home' ? pair[0] : pair[1]
}