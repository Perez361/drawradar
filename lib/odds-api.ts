// ─── The Odds API client ──────────────────────────────────────────────────────
// Docs: https://the-odds-api.com/lol-of-the-api/
// Free tier: 500 requests/month  (~16/day)
// Strategy: 1 request to fetch all today's events + odds in one shot using
//   the "odds" endpoint with "h2h" market — draw is the "Draw" outcome.

export const ODDS_API_BASE = 'https://api.the-odds-api.com/v4'

// Leagues supported on free tier that match your LEAGUE_FLAGS map.
// sport_key list: https://the-odds-api.com/sports-odds-data/sports-apis.html
export const SUPPORTED_SPORT_KEYS: Record<string, { name: string; country: string }> = {
  // Soccer
  'soccer_epl':              { name: 'Premier League',  country: 'England' },
  'soccer_germany_bundesliga':{ name: 'Bundesliga',     country: 'Germany' },
  'soccer_spain_la_liga':    { name: 'La Liga',         country: 'Spain'   },
  'soccer_italy_serie_a':    { name: 'Serie A',         country: 'Italy'   },
  'soccer_france_ligue_one': { name: 'Ligue 1',         country: 'France'  },
  'soccer_netherlands_eredivisie': { name: 'Eredivisie', country: 'Netherlands' },
  'soccer_portugal_primeira_liga': { name: 'Primeira Liga', country: 'Portugal' },
  'soccer_turkey_super_league':    { name: 'Super Lig',  country: 'Turkey'  },
  // Basketball
  'basketball_nba':          { name: 'NBA',             country: 'USA'     },
  'basketball_wnba':         { name: 'WNBA',            country: 'USA'     },
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface OddsApiEvent {
  id: string
  sport_key: string
  sport_title: string
  commence_time: string   // ISO 8601
  home_team: string
  away_team: string
  bookmakers: OddsApiBookmaker[]
}

export interface OddsApiBookmaker {
  key: string
  title: string
  last_update: string
  markets: OddsApiMarket[]
}

export interface OddsApiMarket {
  key: string   // 'h2h' | 'totals' | 'spreads'
  last_update: string
  outcomes: OddsApiOutcome[]
}

export interface OddsApiOutcome {
  name: string   // home team name | away team name | 'Draw' | 'Over' | 'Under'
  price: number  // decimal odds
  point?: number // for totals (Over/Under) and spreads
}

// ─── Fetch helpers ────────────────────────────────────────────────────────────

/**
 * Fetch all upcoming events + odds for a single sport key.
 * Uses 1 API request per sport key.
 * Pass dateFrom / dateTo (ISO strings) to restrict to today only.
 * Pass markets to specify which betting markets (default: h2h for soccer).
 */
export async function fetchOddsForSport(
  sportKey: string,
  apiKey: string,
  options: { dateFrom?: string; dateTo?: string; markets?: string } = {}
): Promise<OddsApiEvent[]> {
  const params = new URLSearchParams({
    apiKey,
    regions: 'eu',          // European bookmakers → better draw odds
    markets: options.markets ?? 'h2h',
    oddsFormat: 'decimal',
    dateFormat: 'iso',
  })
  if (options.dateFrom) params.set('commenceTimeFrom', options.dateFrom)
  if (options.dateTo)   params.set('commenceTimeTo',   options.dateTo)

  const url = `${ODDS_API_BASE}/sports/${sportKey}/odds/?${params}`
  const res = await fetch(url)

  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Odds API error for ${sportKey}: ${res.status} ${body}`)
  }

  // Log remaining quota so you can monitor usage
  const remaining = res.headers.get('x-requests-remaining')
  const used      = res.headers.get('x-requests-used')
  console.log(`[OddsAPI] ${sportKey} — requests used: ${used}, remaining: ${remaining}`)

  return res.json() as Promise<OddsApiEvent[]>
}

/**
 * Fetch today's events across all supported leagues.
 * Costs 1 request per league (up to 8 on free tier).
 * To stay within 500/month budget (~16/day) we fetch all 8 = 8 req/day = 240/month ✓
 */
export async function fetchMatchesForDate(
  apiKey: string,
  dateFrom: string,
  dateTo: string
): Promise<OddsApiEvent[]> {
  // Use UTC midnight to UTC 23:59 to avoid timezone drift
  const fromIso = `${dateFrom}T00:00:00Z`
  const toIso   = `${dateTo}T23:59:59Z`

  const results = await Promise.allSettled(
    Object.keys(SUPPORTED_SPORT_KEYS).map((key) =>
      fetchOddsForSport(key, apiKey, { dateFrom: fromIso, dateTo: toIso })
    )
  )

  const events: OddsApiEvent[] = []
  for (const result of results) {
    if (result.status === 'fulfilled') {
      events.push(...result.value)
    } else {
      console.error('[OddsAPI] Failed to fetch a sport:', result.reason)
    }
  }
  return events
}

// ─── Map OddsApiEvent → matches table row ─────────────────────────────────────

export interface MappedMatch {
  external_id: string        // odds API event id — store to avoid re-inserting
  league_name: string
  league_country: string
  home_team_name: string
  away_team_name: string
  match_date: string         // ISO
  draw_odds: number
  // Stats we can't get from free-tier odds API — seeded with league averages.
  // These will improve once you add a stats provider or build history.
  home_goals_avg: number
  away_goals_avg: number
  home_concede_avg: number
  away_concede_avg: number
  home_draw_rate: number
  away_draw_rate: number
  h2h_draw_rate: number
  xg_home: number
  xg_away: number
  status: 'scheduled'
}

// League-level baseline stats (averages across Europe's top leagues).
// These are reasonable seeds until you accumulate per-team history.
const LEAGUE_BASELINES: Record<string, Partial<MappedMatch>> = {
  'soccer_epl':                    { home_goals_avg: 1.53, away_goals_avg: 1.22, home_concede_avg: 1.22, away_concede_avg: 1.53, home_draw_rate: 0.26, away_draw_rate: 0.26, h2h_draw_rate: 0.26 },
  'soccer_germany_bundesliga':     { home_goals_avg: 1.72, away_goals_avg: 1.38, home_concede_avg: 1.38, away_concede_avg: 1.72, home_draw_rate: 0.24, away_draw_rate: 0.24, h2h_draw_rate: 0.24 },
  'soccer_spain_la_liga':          { home_goals_avg: 1.55, away_goals_avg: 1.22, home_concede_avg: 1.22, away_concede_avg: 1.55, home_draw_rate: 0.27, away_draw_rate: 0.27, h2h_draw_rate: 0.27 },
  'soccer_italy_serie_a':          { home_goals_avg: 1.49, away_goals_avg: 1.19, home_concede_avg: 1.19, away_concede_avg: 1.49, home_draw_rate: 0.29, away_draw_rate: 0.29, h2h_draw_rate: 0.29 },
  'soccer_france_ligue_one':       { home_goals_avg: 1.51, away_goals_avg: 1.18, home_concede_avg: 1.18, away_concede_avg: 1.51, home_draw_rate: 0.28, away_draw_rate: 0.28, h2h_draw_rate: 0.28 },
  'soccer_netherlands_eredivisie': { home_goals_avg: 1.81, away_goals_avg: 1.44, home_concede_avg: 1.44, away_concede_avg: 1.81, home_draw_rate: 0.25, away_draw_rate: 0.25, h2h_draw_rate: 0.25 },
  'soccer_portugal_primeira_liga': { home_goals_avg: 1.48, away_goals_avg: 1.14, home_concede_avg: 1.14, away_concede_avg: 1.48, home_draw_rate: 0.28, away_draw_rate: 0.28, h2h_draw_rate: 0.28 },
  'soccer_turkey_super_league':    { home_goals_avg: 1.58, away_goals_avg: 1.25, home_concede_avg: 1.25, away_concede_avg: 1.58, home_draw_rate: 0.28, away_draw_rate: 0.28, h2h_draw_rate: 0.28 },
}

/**
 * Extract the best available draw odds from an event's bookmakers.
 * Prefers Pinnacle > Bet365 > first available. Returns 0 if not found.
 */
function extractDrawOdds(event: OddsApiEvent): number {
  const preferred = ['pinnacle', 'bet365', 'unibet', 'betfair']

  let bestOdds = 0
  let bestFromPreferred = 0

  for (const bm of event.bookmakers) {
    const h2h = bm.markets.find((m) => m.key === 'h2h')
    if (!h2h) continue
    const draw = h2h.outcomes.find((o) => o.name === 'Draw')
    if (!draw) continue

    if (preferred.includes(bm.key)) {
      if (draw.price > bestFromPreferred) bestFromPreferred = draw.price
    }
    if (draw.price > bestOdds) bestOdds = draw.price
  }

  return bestFromPreferred || bestOdds
}

/**
 * Derive naive xG estimates from league goal averages.
 * Better than nothing until you wire in a stats API.
 * xG ≈ expected goals = (team attack avg + opponent defence avg) / 2
 */
function estimateXg(
  homeGoalsAvg: number,
  awayConcedeAvg: number,
  awayGoalsAvg: number,
  homeConcedeAvg: number
): { xgHome: number; xgAway: number } {
  return {
    xgHome: Math.round(((homeGoalsAvg + awayConcedeAvg) / 2) * 100) / 100,
    xgAway: Math.round(((awayGoalsAvg + homeConcedeAvg) / 2) * 100) / 100,
  }
}

export function mapEventToMatch(event: OddsApiEvent): MappedMatch | null {
  const drawOdds = extractDrawOdds(event)
  if (drawOdds === 0) return null  // skip events with no odds

  const baseline = LEAGUE_BASELINES[event.sport_key] ?? {
    home_goals_avg: 1.5, away_goals_avg: 1.2,
    home_concede_avg: 1.2, away_concede_avg: 1.5,
    home_draw_rate: 0.27, away_draw_rate: 0.27, h2h_draw_rate: 0.27,
  }

  const { xgHome, xgAway } = estimateXg(
    baseline.home_goals_avg!,
    baseline.away_concede_avg!,
    baseline.away_goals_avg!,
    baseline.home_concede_avg!
  )

  const leagueInfo = SUPPORTED_SPORT_KEYS[event.sport_key]

  return {
    external_id:       event.id,
    league_name:       leagueInfo?.name    ?? event.sport_title,
    league_country:    leagueInfo?.country ?? '',
    home_team_name:    event.home_team,
    away_team_name:    event.away_team,
    match_date:        event.commence_time,
    draw_odds:         drawOdds,
    xg_home:           xgHome,
    xg_away:           xgAway,
    status:            'scheduled',
    ...baseline,
  } as MappedMatch
}