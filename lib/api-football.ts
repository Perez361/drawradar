// ─── API-Football client v7 ───────────────────────────────────────────────────
//
// Changes over v6:
//   1. Per-minute rate limiter — enforces 6.5s minimum gap between ALL API
//      calls (shared module-level state). The free plan is 10 req/min; the
//      `x-ratelimit-requests-remaining` header is daily quota, NOT per-minute,
//      so we cannot rely on it. 6.5s gap = ~9.2 calls/min, safely under the cap.
//   2. apiFetch no longer throws on RATE_LIMIT errors — returns null instead,
//      so callers (form/H2H batch) skip the team and continue with the rest
//      rather than aborting the entire batch.
//   3. fetchRecentFixtures now tries currentYear first, falls back to
//      currentYear-1 automatically, fixing leagues on split-year calendars
//      (Thai League, some African leagues, etc.) that returned 0 results.
//   4. Fetches full season FT fixtures (free plan compatible), sorts/slices top 10 recent — quota safe.

export const API_FOOTBALL_BASE = 'https://v3.football.api-sports.io'

// Free plan fixed season for team stats and form
const FREE_PLAN_SEASON = 2024
export { FREE_PLAN_SEASON }

// ─── Per-minute rate limiter ──────────────────────────────────────────────────
// Free plan: 10 req/min hard cap (NOT reflected in response headers — those
// show daily remaining). We enforce a 6.5s minimum gap between ALL API calls.
// Module-level so every caller shares the same queue.

let _lastApiFetch = 0
const API_MIN_GAP_MS = 6_500  // 6.5s → ~9.2 req/min, safely under 10/min

async function rateLimitWait(): Promise<void> {
  const now  = Date.now()
  const wait = API_MIN_GAP_MS - (now - _lastApiFetch)
  if (wait > 0) {
    await new Promise<void>((resolve) => setTimeout(resolve, wait))
  }
  _lastApiFetch = Date.now()
}

// ─── Normalise country string ─────────────────────────────────────────────────
export function normalizeCountry(raw: string): string {
  return raw.trim()
}

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

export const LEAGUE_ID_TO_INFO: Record<
  number,
  { name: string; country: string; avgDrawRate: number }
> = {
  // ── England ──────────────────────────────────────────────────────────────────
  39:  { name: 'Premier League',             country: 'England',            avgDrawRate: 0.26 },
  40:  { name: 'Championship',               country: 'England',            avgDrawRate: 0.28 },
  41:  { name: 'League One',                 country: 'England',            avgDrawRate: 0.27 },
  42:  { name: 'League Two',                 country: 'England',            avgDrawRate: 0.27 },
  43:  { name: 'National League',            country: 'England',            avgDrawRate: 0.28 },
  46:  { name: 'EFL Trophy',                 country: 'England',            avgDrawRate: 0.29 },
  47:  { name: 'FA Trophy',                  country: 'England',            avgDrawRate: 0.29 },
  // ── Spain ────────────────────────────────────────────────────────────────────
  140: { name: 'La Liga',                    country: 'Spain',              avgDrawRate: 0.27 },
  141: { name: 'Segunda División',           country: 'Spain',              avgDrawRate: 0.29 },
  142: { name: 'Primera RFEF',               country: 'Spain',              avgDrawRate: 0.30 },
  143: { name: 'Copa Del Rey',               country: 'Spain',              avgDrawRate: 0.31 },
  735: { name: 'Copa Federacion',            country: 'Spain',              avgDrawRate: 0.30 },
  435: { name: 'Primera División RFEF - Group 1', country: 'Spain',         avgDrawRate: 0.30 },
  436: { name: 'Primera División RFEF - Group 2', country: 'Spain',         avgDrawRate: 0.30 },
  437: { name: 'Primera División RFEF - Group 3', country: 'Spain',         avgDrawRate: 0.30 },
  438: { name: 'Primera División RFEF - Group 4', country: 'Spain',         avgDrawRate: 0.31 },
  // ── Germany ──────────────────────────────────────────────────────────────────
  78:  { name: 'Bundesliga',                 country: 'Germany',            avgDrawRate: 0.24 },
  79:  { name: '2. Bundesliga',              country: 'Germany',            avgDrawRate: 0.26 },
  80:  { name: '3. Liga',                    country: 'Germany',            avgDrawRate: 0.28 },
  81:  { name: 'Regionalliga',               country: 'Germany',            avgDrawRate: 0.29 },
  // ── Italy ────────────────────────────────────────────────────────────────────
  135: { name: 'Serie A',                    country: 'Italy',              avgDrawRate: 0.29 },
  136: { name: 'Serie B',                    country: 'Italy',              avgDrawRate: 0.30 },
  138: { name: 'Serie C',                    country: 'Italy',              avgDrawRate: 0.31 },
  426: { name: 'Serie D',                    country: 'Italy',              avgDrawRate: 0.30 },
  // ── France ───────────────────────────────────────────────────────────────────
  61:  { name: 'Ligue 1',                    country: 'France',             avgDrawRate: 0.28 },
  62:  { name: 'Ligue 2',                    country: 'France',             avgDrawRate: 0.29 },
  63:  { name: 'National 1',                 country: 'France',             avgDrawRate: 0.30 },
  67:  { name: 'National 2',                 country: 'France',             avgDrawRate: 0.31 },
  // ── Netherlands ──────────────────────────────────────────────────────────────
  88:  { name: 'Eredivisie',                 country: 'Netherlands',        avgDrawRate: 0.25 },
  89:  { name: 'Eerste Divisie',             country: 'Netherlands',        avgDrawRate: 0.27 },
  492: { name: 'Tweede Divisie',             country: 'Netherlands',        avgDrawRate: 0.28 },
  // ── Portugal ─────────────────────────────────────────────────────────────────
  94:  { name: 'Primeira Liga',              country: 'Portugal',           avgDrawRate: 0.28 },
  95:  { name: 'Liga Portugal 2',            country: 'Portugal',           avgDrawRate: 0.30 },
  96:  { name: 'Taça de Portugal',           country: 'Portugal',           avgDrawRate: 0.31 },
  97:  { name: 'Taça da Liga',               country: 'Portugal',           avgDrawRate: 0.31 },
  865: { name: 'Liga 3',                     country: 'Portugal',           avgDrawRate: 0.31 },
  // ── Turkey ───────────────────────────────────────────────────────────────────
  203: { name: 'Süper Lig',                  country: 'Turkey',             avgDrawRate: 0.28 },
  204: { name: 'TFF 1. Lig',                 country: 'Turkey',             avgDrawRate: 0.29 },
  205: { name: 'TFF 2. Lig',                 country: 'Turkey',             avgDrawRate: 0.30 },
  206: { name: 'Türkiye Kupası',             country: 'Turkey',             avgDrawRate: 0.30 },
  // ── Belgium ──────────────────────────────────────────────────────────────────
  144: { name: 'Pro League',                 country: 'Belgium',            avgDrawRate: 0.27 },
  145: { name: 'Challenger Pro League',      country: 'Belgium',            avgDrawRate: 0.29 },
  519: { name: 'Super Cup',                  country: 'Belgium',            avgDrawRate: 0.30 },
  // ── Scotland ─────────────────────────────────────────────────────────────────
  179: { name: 'Premiership',                country: 'Scotland',           avgDrawRate: 0.26 },
  180: { name: 'Championship',               country: 'Scotland',           avgDrawRate: 0.28 },
  183: { name: 'League One',                 country: 'Scotland',           avgDrawRate: 0.27 },
  184: { name: 'League Two',                 country: 'Scotland',           avgDrawRate: 0.27 },
  182: { name: 'Challenge Cup',              country: 'Scotland',           avgDrawRate: 0.27 },
  181: { name: 'FA Cup',                     country: 'Scotland',           avgDrawRate: 0.28 },
  // ── Greece ───────────────────────────────────────────────────────────────────
  197: { name: 'Super League 1',             country: 'Greece',             avgDrawRate: 0.30 },
  198: { name: 'Football League',            country: 'Greece',             avgDrawRate: 0.30 },
  494: { name: 'Super League 2',             country: 'Greece',             avgDrawRate: 0.31 },
  // ── Russia ───────────────────────────────────────────────────────────────────
  235: { name: 'Premier League',             country: 'Russia',             avgDrawRate: 0.27 },
  236: { name: 'FNL',                        country: 'Russia',             avgDrawRate: 0.28 },
  237: { name: 'Russia Cup',                 country: 'Russia',             avgDrawRate: 0.29 },
  // ── Ukraine ──────────────────────────────────────────────────────────────────
  334: { name: 'Persha League',              country: 'Ukraine',            avgDrawRate: 0.26 },
  333: { name: 'Premier League',             country: 'Ukraine',            avgDrawRate: 0.28 },
  335: { name: 'Ukraine Cup',                country: 'Ukraine',            avgDrawRate: 0.28 },
  336: { name: 'Druha League',               country: 'Ukraine',            avgDrawRate: 0.29 },
  // ── Austria ──────────────────────────────────────────────────────────────────
  218: { name: 'Bundesliga',                 country: 'Austria',            avgDrawRate: 0.27 },
  219: { name: '2. Liga',                    country: 'Austria',            avgDrawRate: 0.28 },
  220: { name: 'Austrian Cup',               country: 'Austria',            avgDrawRate: 0.29 },
  // ── Switzerland ──────────────────────────────────────────────────────────────
  207: { name: 'Super League',               country: 'Switzerland',        avgDrawRate: 0.27 },
  208: { name: 'Challenge League',           country: 'Switzerland',        avgDrawRate: 0.28 },
  // ── Sweden ───────────────────────────────────────────────────────────────────
  113: { name: 'Allsvenskan',                country: 'Sweden',             avgDrawRate: 0.27 },
  114: { name: 'Superettan',                 country: 'Sweden',             avgDrawRate: 0.28 },
  115: { name: 'Svenska Cupen',              country: 'Sweden',             avgDrawRate: 0.29 },
  // ── Norway ───────────────────────────────────────────────────────────────────
  104: { name: 'OBOS-ligaen',                country: 'Norway',             avgDrawRate: 0.28 },
  103: { name: 'Eliteserien',                country: 'Norway',             avgDrawRate: 0.29 },
  105: { name: 'Norwegian Cup',              country: 'Norway',             avgDrawRate: 0.30 },
  // ── Denmark ──────────────────────────────────────────────────────────────────
  119: { name: 'Superliga',                  country: 'Denmark',            avgDrawRate: 0.27 },
  120: { name: '1st Division',               country: 'Denmark',            avgDrawRate: 0.29 },
  122: { name: '2nd Division',               country: 'Denmark',            avgDrawRate: 0.30 },
  123: { name: '2nd Division Group 2',       country: 'Denmark',            avgDrawRate: 0.30 },
  // ── Poland ───────────────────────────────────────────────────────────────────
  106: { name: 'Ekstraklasa',                country: 'Poland',             avgDrawRate: 0.29 },
  107: { name: 'I Liga',                     country: 'Poland',             avgDrawRate: 0.30 },
  727: { name: 'Polish Cup',                 country: 'Poland',             avgDrawRate: 0.31 },
  // ── Czech Republic ───────────────────────────────────────────────────────────
  345: { name: 'Czech Liga',                 country: 'Czech Republic',     avgDrawRate: 0.28 },
  346: { name: 'FNL',                        country: 'Czech Republic',     avgDrawRate: 0.29 },
  // ── Slovakia ─────────────────────────────────────────────────────────────────
  332: { name: 'Super Liga',                 country: 'Slovakia',           avgDrawRate: 0.28 },
  506: { name: '2. Liga',                    country: 'Slovakia',           avgDrawRate: 0.29 },
  // ── Hungary ──────────────────────────────────────────────────────────────────
  271: { name: 'NB 1',                       country: 'Hungary',            avgDrawRate: 0.28 },
  272: { name: 'NB 2',                       country: 'Hungary',            avgDrawRate: 0.29 },
  // ── Romania ──────────────────────────────────────────────────────────────────
  283: { name: 'Liga 1',                     country: 'Romania',            avgDrawRate: 0.30 },
  284: { name: 'Liga 2',                     country: 'Romania',            avgDrawRate: 0.31 },
  // ── Bulgaria ─────────────────────────────────────────────────────────────────
  172: { name: 'First Professional League',  country: 'Bulgaria',           avgDrawRate: 0.29 },
  173: { name: 'Second Professional League', country: 'Bulgaria',           avgDrawRate: 0.30 },
  // ── Serbia ───────────────────────────────────────────────────────────────────
  287: { name: 'Prva Liga',                  country: 'Serbia',             avgDrawRate: 0.28 },
  286: { name: 'Super Liga',                 country: 'Serbia',             avgDrawRate: 0.29 },
  // ── Croatia ──────────────────────────────────────────────────────────────────
  210: { name: 'HNL',                        country: 'Croatia',            avgDrawRate: 0.28 },
  211: { name: 'First NL',                   country: 'Croatia',            avgDrawRate: 0.29 },
  212: { name: 'Croatian Cup',               country: 'Croatia',            avgDrawRate: 0.30 },
  // ── Slovenia ─────────────────────────────────────────────────────────────────
  373: { name: '1. SNL',                     country: 'Slovenia',           avgDrawRate: 0.29 },
  374: { name: '2. SNL',                     country: 'Slovenia',           avgDrawRate: 0.30 },
  375: { name: 'Slovenian Cup',              country: 'Slovenia',           avgDrawRate: 0.30 },
  // ── Bosnia ───────────────────────────────────────────────────────────────────
  315: { name: 'Premier Liga',               country: 'Bosnia',             avgDrawRate: 0.30 },
  // ── North Macedonia ──────────────────────────────────────────────────────────
  371: { name: 'First League',               country: 'North Macedonia',    avgDrawRate: 0.31 },
  756: { name: 'Macedonian Cup',             country: 'North Macedonia',    avgDrawRate: 0.31 },
  // ── Albania ──────────────────────────────────────────────────────────────────
  311: { name: '1st Division',               country: 'Albania',            avgDrawRate: 0.30 },
  707: { name: 'Cup',                        country: 'Albania',            avgDrawRate: 0.30 },
  310: { name: 'Superliga',                  country: 'Albania',            avgDrawRate: 0.30 },
  // ── Kosovo ───────────────────────────────────────────────────────────────────
  664: { name: 'Football Superleague',       country: 'Kosovo',             avgDrawRate: 0.30 },
  // ── Montenegro ───────────────────────────────────────────────────────────────
  355: { name: 'First League',               country: 'Montenegro',         avgDrawRate: 0.30 },
  356: { name: 'Second League',              country: 'Montenegro',         avgDrawRate: 0.30 },
  723: { name: 'Montenegrin Cup',            country: 'Montenegro',         avgDrawRate: 0.30 },
  // ── Israel ───────────────────────────────────────────────────────────────────
  383: { name: "Ligat Ha'Al",                country: 'Israel',             avgDrawRate: 0.28 },
  496: { name: 'Liga Alef',                  country: 'Israel',             avgDrawRate: 0.29 },
  382: { name: 'Liga Leumit',                country: 'Israel',             avgDrawRate: 0.29 },
  384: { name: 'State Cup',                  country: 'Israel',             avgDrawRate: 0.30 },
  385: { name: 'Toto Cup',                   country: 'Israel',             avgDrawRate: 0.30 },
  // ── Cyprus ───────────────────────────────────────────────────────────────────
  318: { name: 'First Division',             country: 'Cyprus',             avgDrawRate: 0.30 },
  319: { name: 'Second Division',            country: 'Cyprus',             avgDrawRate: 0.30 },
  320: { name: 'Third Division',             country: 'Cyprus',             avgDrawRate: 0.31 },
  // ── Belarus ──────────────────────────────────────────────────────────────────
  117: { name: 'First League',               country: 'Belarus',            avgDrawRate: 0.29 },
  118: { name: 'Belarus Cup',                country: 'Belarus',            avgDrawRate: 0.30 },
  116: { name: 'Premier League',             country: 'Belarus',            avgDrawRate: 0.30 },
  // ── Lithuania ────────────────────────────────────────────────────────────────
  361: { name: '1 Lyga',                     country: 'Lithuania',          avgDrawRate: 0.27 },
  362: { name: 'A Lyga',                     country: 'Lithuania',          avgDrawRate: 0.28 },
  // ── Latvia ───────────────────────────────────────────────────────────────────
  364: { name: '1. Liga',                    country: 'Latvia',             avgDrawRate: 0.27 },
  365: { name: 'Virslīga',                   country: 'Latvia',             avgDrawRate: 0.28 },
  // ── Estonia ──────────────────────────────────────────────────────────────────
  329: { name: 'Meistriliiga',               country: 'Estonia',            avgDrawRate: 0.28 },
  328: { name: 'Esiliiga',                   country: 'Estonia',            avgDrawRate: 0.29 },
  1126:{ name: 'Esiliiga B',                 country: 'Estonia',            avgDrawRate: 0.30 },
  657: { name: 'Estonian Cup',               country: 'Estonia',            avgDrawRate: 0.30 },
  // ── Iceland ──────────────────────────────────────────────────────────────────
  164: { name: 'Úrvalsdeild',                country: 'Iceland',            avgDrawRate: 0.26 },
  165: { name: '1. Deild',                   country: 'Iceland',            avgDrawRate: 0.27 },
  166: { name: '2. Deild',                   country: 'Iceland',            avgDrawRate: 0.28 },
  814: { name: 'Icelandic Cup',              country: 'Iceland',            avgDrawRate: 0.29 },
  // ── Ireland ──────────────────────────────────────────────────────────────────
  357: { name: 'Premier Division',           country: 'Ireland',            avgDrawRate: 0.28 },
  358: { name: 'First Division',             country: 'Ireland',            avgDrawRate: 0.29 },
  408: { name: 'Premiership',                country: 'Ireland',            avgDrawRate: 0.30 },
  // ── Northern Ireland ─────────────────────────────────────────────────────────
  359: { name: 'NIFL Premiership',           country: 'Northern Ireland',   avgDrawRate: 0.28 },
  407: { name: 'NIFL Championship',          country: 'Northern Ireland',   avgDrawRate: 0.29 },
  // ── Armenia ──────────────────────────────────────────────────────────────────
  342: { name: 'Premier League',             country: 'Armenia',            avgDrawRate: 0.28 },
  709: { name: 'Armenian Cup',               country: 'Armenia',            avgDrawRate: 0.29 },
  343: { name: 'First League',               country: 'Armenia',            avgDrawRate: 0.29 },
  654: { name: 'Super Cup',                  country: 'Armenia',            avgDrawRate: 0.30 },
  // ── Azerbaijan ───────────────────────────────────────────────────────────────
  418: { name: 'Birinci Dasta',              country: 'Azerbaijan',         avgDrawRate: 0.29 },
  419: { name: 'Premyer Liqa',               country: 'Azerbaijan',         avgDrawRate: 0.29 },
  420: { name: 'Cup',                        country: 'Azerbaijan',         avgDrawRate: 0.30 },
  // ── Moldova ──────────────────────────────────────────────────────────────────
  395: { name: 'Liga 1',                     country: 'Moldova',            avgDrawRate: 0.30 },
  394: { name: 'Super Liga',                 country: 'Moldova',            avgDrawRate: 0.31 },
  // ── South America ────────────────────────────────────────────────────────────
  128: { name: 'Liga Profesional',           country: 'Argentina',          avgDrawRate: 0.29 },
  129: { name: 'Primera Nacional',           country: 'Argentina',          avgDrawRate: 0.31 },
  130: { name: 'Copa Argentina',             country: 'Argentina',          avgDrawRate: 0.29 },
  131: { name: 'Primera B Metropolitana',    country: 'Argentina',          avgDrawRate: 0.30 },
  132: { name: 'Primera  C',                 country: 'Argentina',          avgDrawRate: 0.28 },
  134: { name: 'Torneo Federal A',           country: 'Argentina',          avgDrawRate: 0.31 },
  517: { name: 'Trofeo de Campeones de la Superliga', country: 'Argentina', avgDrawRate: 0.31 },
  810: { name: 'Super Copa',                 country: 'Argentina',          avgDrawRate: 0.31 },
  1032:{ name: 'Supercopa Argentina',        country: 'Argentina',          avgDrawRate: 0.30 },
  71:  { name: 'Série A',                    country: 'Brazil',             avgDrawRate: 0.28 },
  72:  { name: 'Série B',                    country: 'Brazil',             avgDrawRate: 0.30 },
  75:  { name: 'Série C',                    country: 'Brazil',             avgDrawRate: 0.31 },
  76:  { name: 'Série D',                    country: 'Brazil',             avgDrawRate: 0.32 },
  73:  { name: 'Copa do Brasil',             country: 'Brazil',             avgDrawRate: 0.30 },
  610: { name: 'Brasiliense',                country: 'Brazil',             avgDrawRate: 0.30 },
  265: { name: 'Primera División',           country: 'Chile',              avgDrawRate: 0.28 },
  266: { name: 'Primera B',                  country: 'Chile',              avgDrawRate: 0.30 },
  267: { name: 'Copa Chile',                 country: 'Chile',              avgDrawRate: 0.32 },
  527: { name: 'Supercopa de Chile',         country: 'Chile',              avgDrawRate: 0.31 },
  711: { name: 'Segunda División',           country: 'Chile',              avgDrawRate: 0.31 },
  239: { name: 'Primera A',                  country: 'Colombia',           avgDrawRate: 0.28 },
  240: { name: 'Primera B',                  country: 'Colombia',           avgDrawRate: 0.29 },
  241: { name: 'Copa Colombia',              country: 'Colombia',           avgDrawRate: 0.30 },
  713: { name: 'Superliga',                  country: 'Colombia',           avgDrawRate: 0.31 },
  242: { name: 'Liga Pro',                   country: 'Ecuador',            avgDrawRate: 0.29 },
  243: { name: 'Liga Pro B',                 country: 'Ecuador',            avgDrawRate: 0.30 },
  917: { name: 'Copa Ecuador',               country: 'Ecuador',            avgDrawRate: 0.31 },
  268: { name: 'Primera División',           country: 'Uruguay',            avgDrawRate: 0.29 },
  269: { name: 'Segunda División',           country: 'Uruguay',            avgDrawRate: 0.30 },
  270: { name: 'Primera División-Clausura',  country: 'Uruguay',            avgDrawRate: 0.30 },
  842: { name: 'Supa Copa',                  country: 'Uruguay',            avgDrawRate: 0.31 },
  930: { name: 'Copa Uruguay',               country: 'Uruguay',            avgDrawRate: 0.30 },
  299: { name: 'Primera División',           country: 'Venezuela',          avgDrawRate: 0.31 },
  300: { name: 'Segunda División',           country: 'Venezuela',          avgDrawRate: 0.31 },
  1113:{ name: 'Copa Venezuela',             country: 'Venezuela',          avgDrawRate: 0.31 },
  344: { name: 'Primera División',           country: 'Bolivia',            avgDrawRate: 0.29 },
  710: { name: 'Nacional B',                 country: 'Bolivia',            avgDrawRate: 0.30 },
  251: { name: 'División Intermedia',        country: 'Paraguay',           avgDrawRate: 0.31 },
  252: { name: 'División Profesional',       country: 'Paraguay',           avgDrawRate: 0.30 },
  501: { name: 'Copa Paraguay',              country: 'Paraguay',           avgDrawRate: 0.31 },
  961: { name: 'Super Copa Paraguay',        country: 'Paraguay',           avgDrawRate: 0.31 },
  281: { name: 'Liga 1',                     country: 'Peru',               avgDrawRate: 0.29 },
  282: { name: 'Liga 2',                     country: 'Peru',               avgDrawRate: 0.30 },
  // ── North & Central America ───────────────────────────────────────────────────
  262: { name: 'Liga MX',                    country: 'Mexico',             avgDrawRate: 0.27 },
  263: { name: 'Liga de Expansión MX',       country: 'Mexico',             avgDrawRate: 0.28 },
  722: { name: 'Liga Premier Serie A',       country: 'Mexico',             avgDrawRate: 0.29 },
  872: { name: 'Liga Premier Serie B',       country: 'Mexico',             avgDrawRate: 0.29 },
  253: { name: 'MLS',                        country: 'USA',                avgDrawRate: 0.27 },
  255: { name: 'USL Championship',           country: 'USA',                avgDrawRate: 0.26 },
  256: { name: 'USL League Two',             country: 'USA',                avgDrawRate: 0.26 },
  257: { name: 'US Open Cup',                country: 'USA',                avgDrawRate: 0.27 },
  489: { name: 'USL League One',             country: 'USA',                avgDrawRate: 0.26 },
  909: { name: 'MLS Next Pro',               country: 'USA',                avgDrawRate: 0.28 },
  479: { name: 'Canadian Premier League',    country: 'Canada',             avgDrawRate: 0.27 },
  162: { name: 'Primera División',           country: 'Costa Rica',         avgDrawRate: 0.29 },
  163: { name: 'Liga de Ascenso',            country: 'Costa Rica',         avgDrawRate: 0.28 },
  864: { name: 'Super Copa Costa Rica',      country: 'Costa Rica',         avgDrawRate: 0.29 },
  339: { name: 'Liga Nacional',              country: 'Guatemala',          avgDrawRate: 0.27 },
  234: { name: 'Liga Nacional',              country: 'Honduras',           avgDrawRate: 0.27 },
  370: { name: 'Primera División',           country: 'El Salvador',        avgDrawRate: 0.29 },
  304: { name: 'Liga Panameña de Fútbol',    country: 'Panama',             avgDrawRate: 0.28 },
  322: { name: 'Premier League',             country: 'Jamaica',            avgDrawRate: 0.30 },
  591: { name: 'Pro League',                 country: 'Trinidad and Tobago', avgDrawRate: 0.30 },
  // ── Middle East ───────────────────────────────────────────────────────────────
  307: { name: 'Saudi Professional League',  country: 'Saudi Arabia',       avgDrawRate: 0.27 },
  308: { name: 'Division 1',                 country: 'Saudi Arabia',       avgDrawRate: 0.28 },
  309: { name: 'Division 2',                 country: 'Saudi Arabia',       avgDrawRate: 0.29 },
  504: { name: 'King Cup',                   country: 'Saudi Arabia',       avgDrawRate: 0.30 },
  305: { name: 'Qatar Stars League',         country: 'Qatar',              avgDrawRate: 0.27 },
  306: { name: 'Qatar Second Division',      country: 'Qatar',              avgDrawRate: 0.28 },
  677: { name: 'QSL CUP',                    country: 'Qatar',              avgDrawRate: 0.28 },
  290: { name: 'Persian Gulf Pro League',    country: 'Iran',               avgDrawRate: 0.31 },
  291: { name: 'Azadegan League',            country: 'Iran',               avgDrawRate: 0.32 },
  495: { name: 'Hazfi Cup',                  country: 'Iran',               avgDrawRate: 0.32 },
  542: { name: 'Iraq Stars League',          country: 'Iraq',               avgDrawRate: 0.32 },
  387: { name: 'First Division',             country: 'Jordan',             avgDrawRate: 0.31 },
  390: { name: 'Premier League',             country: 'Lebanon',            avgDrawRate: 0.30 },
  425: { name: 'Premier League',             country: 'Syria',              avgDrawRate: 0.30 },
  330: { name: 'Kuwait Premier League',      country: 'Kuwait',             avgDrawRate: 0.31 },
  1049:{ name: 'King Cup',                   country: 'Bahrain',            avgDrawRate: 0.31 },
  417: { name: 'Premier League',             country: 'Bahrain',            avgDrawRate: 0.31 },
  406: { name: 'Professional League',        country: 'Oman',               avgDrawRate: 0.31 },
  726: { name: 'Sultan Cup',                 country: 'Oman',               avgDrawRate: 0.31 },
  // ── Asia ──────────────────────────────────────────────────────────────────────
  98:  { name: 'J1 League',                  country: 'Japan',              avgDrawRate: 0.26 },
  99:  { name: 'J2 League',                  country: 'Japan',              avgDrawRate: 0.27 },
  100: { name: 'J3 League',                  country: 'Japan',              avgDrawRate: 0.28 },
  102: { name: "Emperor's Cup",              country: 'Japan',              avgDrawRate: 0.29 },
  292: { name: 'K League 1',                 country: 'South Korea',        avgDrawRate: 0.27 },
  293: { name: 'K League 2',                 country: 'South Korea',        avgDrawRate: 0.27 },
  295: { name: 'K3 League',                  country: 'South Korea',        avgDrawRate: 0.28 },
  169: { name: 'Super League',               country: 'China',              avgDrawRate: 0.26 },
  170: { name: 'China League One',           country: 'China',              avgDrawRate: 0.27 },
  171: { name: 'FA Cup',                     country: 'China',              avgDrawRate: 0.28 },
  929: { name: 'China League Two',           country: 'China',              avgDrawRate: 0.29 },
  972: { name: 'Super Cup',                  country: 'China',              avgDrawRate: 0.29 },
  323: { name: 'Indian Super League',        country: 'India',              avgDrawRate: 0.27 },
  324: { name: 'I-League',                   country: 'India',              avgDrawRate: 0.28 },
  274: { name: 'Liga 1',                     country: 'Indonesia',          avgDrawRate: 0.27 },
  275: { name: 'Liga 2',                     country: 'Indonesia',          avgDrawRate: 0.28 },
  297: { name: 'Thai League 1',              country: 'Thailand',           avgDrawRate: 0.26 },
  298: { name: 'Thai FA Cup',                country: 'Thailand',           avgDrawRate: 0.27 },
  898: { name: 'Thai League Cup',            country: 'Thailand',           avgDrawRate: 0.27 },
  340: { name: 'V.League 1',                 country: 'Vietnam',            avgDrawRate: 0.27 },
  341: { name: 'Vietnam Cup',                country: 'Vietnam',            avgDrawRate: 0.28 },
  637: { name: 'V.League 2',                 country: 'Vietnam',            avgDrawRate: 0.28 },
  278: { name: 'Super League',               country: 'Malaysia',           avgDrawRate: 0.28 },
  368: { name: 'Premier League',             country: 'Singapore',          avgDrawRate: 0.26 },
  765: { name: 'PFL',                        country: 'Philippines',        avgDrawRate: 0.28 },
  369: { name: 'Super League',               country: 'Uzbekistan',         avgDrawRate: 0.28 },
  1075:{ name: 'Pro League A',               country: 'Uzbekistan',         avgDrawRate: 0.28 },
  388: { name: 'Premier League',             country: 'Kazakhstan',         avgDrawRate: 0.28 },
  188: { name: 'A-League Men',               country: 'Australia',          avgDrawRate: 0.25 },
  // ── Africa ───────────────────────────────────────────────────────────────────
  399: { name: 'NPFL',                       country: 'Nigeria',            avgDrawRate: 0.33 },
  233: { name: 'Egyptian Premier League',    country: 'Egypt',              avgDrawRate: 0.32 },
  714: { name: 'Egyptian Cup',               country: 'Egypt',              avgDrawRate: 0.33 },
  887: { name: 'Second League',              country: 'Egypt',              avgDrawRate: 0.33 },
  539: { name: 'Egyptian Super Cup',         country: 'Egypt',              avgDrawRate: 0.33 },
  200: { name: 'Botola Pro',                 country: 'Morocco',            avgDrawRate: 0.30 },
  201: { name: 'Botola 2',                   country: 'Morocco',            avgDrawRate: 0.31 },
  186: { name: 'Ligue 1',                    country: 'Algeria',            avgDrawRate: 0.31 },
  187: { name: 'Ligue 2',                    country: 'Algeria',            avgDrawRate: 0.31 },
  514: { name: 'Coupe Nationale',            country: 'Algeria',            avgDrawRate: 0.32 },
  202: { name: 'Ligue 1',                    country: 'Tunisia',            avgDrawRate: 0.31 },
  288: { name: 'Premier Soccer League',      country: 'South Africa',       avgDrawRate: 0.29 },
  289: { name: 'National First Division',    country: 'South Africa',       avgDrawRate: 0.30 },
  507: { name: 'Cup',                        country: 'South Africa',       avgDrawRate: 0.30 },
  509: { name: 'MTN 8 Cup',                  country: 'South Africa',       avgDrawRate: 0.30 },
  734: { name: 'Diski Challenge',            country: 'South Africa',       avgDrawRate: 0.30 },
  570: { name: 'Premier League',             country: 'Ghana',              avgDrawRate: 0.30 },
  966: { name: 'MTN Cup',                    country: 'Ghana',              avgDrawRate: 0.30 },
  1144:{ name: 'Super Cup',                  country: 'Ghana',              avgDrawRate: 0.30 },
  1196:{ name: 'Division 1 League',          country: 'Ghana',              avgDrawRate: 0.30 },
  276: { name: 'Premier League',             country: 'Kenya',              avgDrawRate: 0.28 },
  277: { name: 'Super League',               country: 'Kenya',              avgDrawRate: 0.28 },
  386: { name: 'Ligue 1',                    country: 'Ivory Coast',        avgDrawRate: 0.30 },
  403: { name: 'Ligue 1',                    country: 'Senegal',            avgDrawRate: 0.30 },
  411: { name: 'Elite One',                  country: 'Cameroon',           avgDrawRate: 0.31 },
  567: { name: 'Premier League',             country: 'Tanzania',           avgDrawRate: 0.30 },
  585: { name: 'Premier League',             country: 'Uganda',             avgDrawRate: 0.29 },
  401: { name: 'Premier Soccer League',      country: 'Zimbabwe',           avgDrawRate: 0.29 },
  400: { name: 'Super League',               country: 'Zambia',             avgDrawRate: 0.30 },
  363: { name: 'Ethiopian Premier League',   country: 'Ethiopia',           avgDrawRate: 0.29 },
  405: { name: 'Rwanda Premier League',      country: 'Rwanda',             avgDrawRate: 0.29 },
  584: { name: 'Premier League',             country: 'Libya',              avgDrawRate: 0.31 },
  402: { name: 'Premier League',             country: 'Sudan',              avgDrawRate: 0.31 },
  397: { name: 'Girabola',                   country: 'Angola',             avgDrawRate: 0.31 },
  424: { name: 'Linafoot',                   country: 'DR Congo',           avgDrawRate: 0.31 },
  598: { name: 'Première Division',          country: 'Mali',               avgDrawRate: 0.32 },
  423: { name: 'Première Division',          country: 'Burkina Faso',       avgDrawRate: 0.31 },
  412: { name: 'Premier League',             country: 'Botswana',           avgDrawRate: 0.29 },
}

// ─── Core fetch — rate-limited, null on any error ─────────────────────────────

async function apiFetch<T>(apiKey: string, path: string): Promise<T | null> {
  // Always wait for rate limit window before firing — MUST be first
  await rateLimitWait()

  const url = `${API_FOOTBALL_BASE}${path}`
  let res: Response
  try {
    res = await fetch(url, {
      headers: { 'x-apisports-key': apiKey },
      cache: 'no-store',
    })
  } catch (err) {
    console.error(`[API-Football] network error on ${path}:`, err)
    return null
  }

  const remaining = res.headers.get('x-ratelimit-requests-remaining') ?? 'n/a'
  const used      = res.headers.get('x-ratelimit-requests-used')      ?? 'n/a'
  console.log(`[API-Football] ${path} — HTTP ${res.status} | used: ${used}, remaining: ${remaining}`)

  if (!res.ok) {
    console.error(`[API-Football] HTTP ${res.status} on ${path}`)
    return null
  }

  let json: { response?: T; errors?: unknown; results?: number }
  try {
    json = await res.json()
  } catch {
    console.error(`[API-Football] JSON parse error on ${path}`)
    return null
  }

  // API-level errors (rate limit, plan restriction, etc.)
  if (json.errors && Object.keys(json.errors as object).length > 0) {
    const errStr = JSON.stringify(json.errors)
    console.error(`[API-Football] errors for ${path}:`, errStr)

    if (errStr.toLowerCase().includes('ratelimit') || errStr.toLowerCase().includes('rate limit')) {
      // Return null — do NOT throw. Callers handle null gracefully and continue.
      console.warn(`[API-Football] rate-limited on ${path} — skipping gracefully (not throwing)`)
      return null
    }
    if (errStr.toLowerCase().includes('plan')) {
      console.warn(`[API-Football] plan restriction on ${path} — skipping`)
      return null
    }
    return null
  }

  const results = (json.response as unknown[])?.length ?? json.results ?? 0
  console.log(`[API-Football] ${path} — results: ${results}`)
  return (json.response ?? null) as T | null
}

// ─── Fetch fixtures for a date ────────────────────────────────────────────────

export async function fetchFixturesForDate(
  apiKey: string,
  date: string
): Promise<ApiFootballFixture[]> {
  const data = await apiFetch<ApiFootballFixture[]>(apiKey, `/fixtures?date=${date}&timezone=UTC`)
  return data ?? []
}

// ─── Fetch upcoming NS fixtures over next N days (NEW) ─────────────────────────

/**
 * Fetches scheduled (NS) fixtures over next `days` days.
 * - Filters status.short === 'NS' only.
 * - Dedupes by league/team to respect budget.
 * - Stops early if too many tracked found.
 */
export async function fetchUpcomingFixtures(
  apiKey: string,
  days: number = 3,
  maxTracked: number = 20
): Promise<ApiFootballFixture[]> {
  const allUpcoming: ApiFootballFixture[] = []
  const seenLeagues = new Set<number>()
  const seenTeams = new Set<string>()  // 'leagueId:teamId'
  let trackedCount = 0

  const now = new Date()
  for (let i = 0; i <= days; i++) {
    const dateStr = new Date(now.getTime() + i * 24 * 60 * 60 * 1000)
      .toISOString().split('T')[0]
    
    console.log(`[upcoming] Scanning ${dateStr}…`)
    const fixtures = await fetchFixturesForDate(apiKey, dateStr)
    
    for (const f of fixtures) {
      if (f.fixture.status.short !== 'NS') continue  // Only Not Started

      const leagueId = f.league.id
      if (!LEAGUE_ID_TO_INFO[leagueId]) continue  // Tracked only

      const teamKeyHome = `${leagueId}:${f.teams.home.id}`
      const teamKeyAway = `${leagueId}:${f.teams.away.id}`
      
      if (seenTeams.has(teamKeyHome) || seenTeams.has(teamKeyAway)) continue
      if (seenLeagues.has(leagueId) && allUpcoming.length >= maxTracked) break

      seenTeams.add(teamKeyHome)
      seenTeams.add(teamKeyAway)
      seenLeagues.add(leagueId)
      allUpcoming.push(f)
      trackedCount++

      if (trackedCount >= maxTracked) break
    }

    if (trackedCount >= maxTracked) break
  }

  console.log(`[upcoming] Found ${allUpcoming.length} unique tracked NS fixtures over ${days} days`)
  return allUpcoming
}

// ─── Odds extraction ──────────────────────────────────────────────────────────

export interface FixtureOdds {
  drawOdds: number
  under25Odds: number   // 0 if not available
}
 
export async function fetchOddsForFixtures(
  apiKey: string,
  fixtureIds: number[]
): Promise<Map<number, FixtureOdds>> {
  const oddsMap = new Map<number, FixtureOdds>()
  for (const fixtureId of fixtureIds) {
    const odds = await fetchOddsForFixture(apiKey, fixtureId)
    oddsMap.set(fixtureId, odds)
  }
  return oddsMap
}
 
// Preferred bookmakers for Under 2.5 — same list as draw odds
const PRIORITY_BOOKS: readonly string[] = [
  '1xbet', 'betway', 'pinnacle', 'bet365', 'williamhill', 'william hill', 'bwin', 'unibet',
  'betfair exchange', 'betfair', 'marathonbet', 'betsson', 'nordicbet', 'parimatch',
]
 
function extractDrawOddsFromBookmaker(
  bm: ApiFootballOdds['bookmakers'][0]
): number {
  const bet = bm.bets.find((b) => b.id === 1 || b.name === 'Match Winner')
  if (!bet) return 0
  const drawVal = bet.values.find((v) => v.value === 'Draw' || v.value === 'X')
  return drawVal ? parseFloat(drawVal.odd) : 0
}
 
function extractUnder25OddsFromBookmaker(
  bm: ApiFootballOdds['bookmakers'][0]
): number {
  // API-Football: bet id=5 is "Goals Over/Under", values like "Over 2.5" / "Under 2.5"
  const bet = bm.bets.find(
    (b) => b.id === 5 ||
           b.name === 'Goals Over/Under' ||
           b.name === 'Over/Under'
  )
  if (!bet) return 0
  const under25 = bet.values.find(
    (v) => v.value === 'Under 2.5' || v.value === 'Under2.5' || v.value === 'u2.5'
  )
  return under25 ? parseFloat(under25.odd) : 0
}
 
export async function fetchOddsForFixture(
  apiKey: string,
  fixtureId: number
): Promise<FixtureOdds> {
  // Fetch both markets in parallel (uses 1 rate-limit slot each but saves wall time)
  // Note: API-Football free plan only allows 1 bet per request, so we fetch sequentially.
  // If you're on a paid plan, add &bet=1,5 to get both in one call.
 
  let drawOdds = 0
  let under25Odds = 0
 
  try {
    // ── Draw odds (bet id=1) ──────────────────────────────────────────────
    const drawData = await apiFetch<ApiFootballOdds[]>(
      apiKey, `/odds?fixture=${fixtureId}&bet=1`
    )
    if (drawData) {
      const bookmakers = drawData[0]?.bookmakers ?? []
 
      // Try priority bookmakers first
      for (const preferred of PRIORITY_BOOKS) {
        for (const bm of bookmakers) {
          if (bm.name.toLowerCase().includes(preferred)) {
            const o = extractDrawOddsFromBookmaker(bm)
            if (o > 0) { drawOdds = o; break }
          }
        }
        if (drawOdds > 0) break
      }
 
      // Fallback: trimmed median
      if (drawOdds === 0) {
        const allOdds = bookmakers
          .map((bm) => extractDrawOddsFromBookmaker(bm))
          .filter((o) => o >= 1.20 && o <= 20.0)
          .sort((a, b) => a - b)
 
        if (allOdds.length > 0) {
          const trimCount = Math.floor(allOdds.length * 0.15)
          const trimmed   = allOdds.slice(trimCount, allOdds.length - trimCount)
          const src       = trimmed.length > 0 ? trimmed : allOdds
          const mid       = Math.floor(src.length / 2)
          drawOdds = src.length % 2 !== 0
            ? src[mid]
            : (src[mid - 1] + src[mid]) / 2
          drawOdds = Math.round(drawOdds * 100) / 100
        }
      }
 
      console.log(`[odds] fixture ${fixtureId} — draw: ${drawOdds}`)
    }
 
    // ── Under 2.5 odds (bet id=5) ─────────────────────────────────────────
    // Costs 1 extra API request. On free plan (100/day) this doubles your odds
    // usage. Recommendation: only fetch u25 for the top-ranked candidates after
    // the first pass, or use The Odds API snapshot (already in your cron) which
    // includes totals for free.
    const totalsData = await apiFetch<ApiFootballOdds[]>(
      apiKey, `/odds?fixture=${fixtureId}&bet=5`
    )
    if (totalsData) {
      const bookmakers = totalsData[0]?.bookmakers ?? []
 
      // Try priority bookmakers first
      for (const preferred of PRIORITY_BOOKS) {
        for (const bm of bookmakers) {
          if (bm.name.toLowerCase().includes(preferred)) {
            const o = extractUnder25OddsFromBookmaker(bm)
            if (o > 0) { under25Odds = o; break }
          }
        }
        if (under25Odds > 0) break
      }
 
      // Fallback: trimmed median
      if (under25Odds === 0) {
        const allU25 = bookmakers
          .map((bm) => extractUnder25OddsFromBookmaker(bm))
          .filter((o) => o >= 1.05 && o <= 5.0)
          .sort((a, b) => a - b)
 
        if (allU25.length > 0) {
          const trimCount = Math.floor(allU25.length * 0.15)
          const trimmed   = allU25.slice(trimCount, allU25.length - trimCount)
          const src       = trimmed.length > 0 ? trimmed : allU25
          const mid       = Math.floor(src.length / 2)
          under25Odds = src.length % 2 !== 0
            ? src[mid]
            : (src[mid - 1] + src[mid]) / 2
          under25Odds = Math.round(under25Odds * 100) / 100
        }
      }
 
      console.log(`[odds] fixture ${fixtureId} — under 2.5: ${under25Odds}`)
    }
 
  } catch (err) {
    console.warn(`[odds] fixture ${fixtureId} fetch failed:`, err)
  }
 
  return { drawOdds, under25Odds }
}
// ─── H2H ─────────────────────────────────────────────────────────────────────

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
    if (!raw) return []
    return raw
      .filter(
        (f) =>
          f.goals.home !== null &&
          f.goals.away !== null &&
          !['NS', 'TBD', 'CANC', 'PST', 'ABD'].includes(f.fixture.status.short)
      )
      .map((f) => ({
        fixtureId:  f.fixture.id,
        date:       f.fixture.date,
        homeTeamId: f.teams.home.id,
        awayTeamId: f.teams.away.id,
        homeGoals:  f.goals.home!,
        awayGoals:  f.goals.away!,
        isDraw:     f.goals.home === f.goals.away,
      }))
  } catch (err) {
    console.warn(`[H2H] failed for ${homeTeamId}-${awayTeamId}:`, err)
    return []
  }
}

// ─── Recent fixtures for form — with season fallback ─────────────────────────
//
// Tries currentYear first. If 0 results (league uses different calendar, e.g.
// Thai League runs Jan-Oct, Filipino PFL, some African leagues), retries with
// currentYear-1. This silently fixes the "0 results" errors for those leagues.

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
  last = 10
): Promise<RecentFixture[]> {
  // Inner helper: fetch for a specific season year
async function fetchForSeason(seasonYear: number): Promise<RecentFixture[] | null> {
    const raw = await apiFetch<ApiFootballFixture[]>(
      apiKey,
      `/fixtures?team=${teamId}&league=${leagueId}&season=${seasonYear}&status=FT`
    )
    // null means rate-limited or error — propagate as null so caller can skip
    if (raw === null) return null
    // Empty array means no data for this season
    if (raw.length === 0) return []

    return raw
      .filter((f) => 
        f.fixture.status.short === 'FT' &&
        f.goals.home !== null && 
        f.goals.away !== null
      )
      .sort((a, b) => new Date(b.fixture.date).getTime() - new Date(a.fixture.date).getTime())
      .slice(0, 10)
      .map((f) => {
        const isHome = f.teams.home.id === teamId
        return {
          date:          f.fixture.date,
          goalsScored:   isHome ? f.goals.home! : f.goals.away!,
          goalsConceded: isHome ? f.goals.away! : f.goals.home!,
          isDraw:        f.goals.home === f.goals.away,
        }
      })
  }

  try {
    // 1. Try the requested season year
    const primary = await fetchForSeason(season)

    // null = rate-limited, empty = no data for this season year
    if (primary === null) {
      // Rate limited — return empty so caller logs and continues
      return []
    }
    if (primary.length > 0) return primary

    // 2. No results for the requested year → try year-1 (calendar-year leagues)
    const fallbackYear = season - 1
    console.log(
      `[recentFixtures] 0 results for team ${teamId} in season ${season}, ` +
      `trying ${fallbackYear}…`
    )
    const fallback = await fetchForSeason(fallbackYear)
    if (fallback === null || fallback.length === 0) {
      console.log(`[recentFixtures] no results for team ${teamId} in ${season} or ${fallbackYear}`)
      return []
    }
    return fallback
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
  if (!leagueInfo) {
    console.log(
      `[mapFixture] dropped ${fixture.fixture.id} — league ${fixture.league.id} ` +
      `(${fixture.league.name}, ${fixture.league.country}) not in tracking list`
    )
    return null
  }

  const status = fixture.fixture.status.short
  if (!['NS', 'TBD'].includes(status)) {
    console.log(`[mapFixture] dropped fixture ${fixture.fixture.id} — status '${status}' is not scheduled`)
    return null
  }

  if (drawOdds <= 0) {
    console.log(
      `[mapFixture] dropped fixture ${fixture.fixture.id} ` +
      `(${fixture.teams.home.name} vs ${fixture.teams.away.name}) — no draw odds`
    )
    return null
  }

  const avg = leagueInfo.avgDrawRate

  const homeGoalsFor  = homeStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const homeConcede   = homeStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const homeDrawRate  = homeStats?.drawRate        ?? avg
  const awayGoalsFor  = awayStats?.goalsForAvg     ?? getLeagueGoalsAvg(fixture.league.id, 'away')
  const awayConcede   = awayStats?.goalsAgainstAvg ?? getLeagueGoalsAvg(fixture.league.id, 'home')
  const awayDrawRate  = awayStats?.drawRate        ?? avg

  const xgHome = Math.round(((homeGoalsFor + awayConcede) / 2) * 100) / 100
  const xgAway = Math.round(((awayGoalsFor + homeConcede) / 2) * 100) / 100

  let h2hDrawRate = Math.round(((homeDrawRate + awayDrawRate) / 2) * 1000) / 1000
  let h2hIsReal   = false

  if (h2hResults && h2hResults.length >= 5) {
    const sorted = [...h2hResults].sort(
      (a, b) => new Date(b.date).getTime() - new Date(a.date).getTime()
    )
    let weightedDraws = 0
    let totalWeight   = 0
    sorted.slice(0, 10).forEach((r, i) => {
      const w = i < 5 ? 2 : 1
      weightedDraws += w * (r.isDraw ? 1 : 0)
      totalWeight   += w
    })
    h2hDrawRate = Math.round((weightedDraws / totalWeight) * 1000) / 1000
    h2hIsReal   = true
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

// Backward-compat shim
export function mapFixture(
  fixture: ApiFootballFixture,
  drawOdds: number
): MappedFixture | null {
  return mapFixtureWithStats(fixture, drawOdds, null, null)
}

// ─── League-level goal baselines ─────────────────────────────────────────────

function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    39: [1.53, 1.22], 40: [1.45, 1.15], 41: [1.42, 1.12], 42: [1.38, 1.10], 43: [1.40, 1.12],
    140: [1.55, 1.22], 141: [1.40, 1.10], 142: [1.38, 1.08], 143: [1.35, 1.06],
    78: [1.72, 1.38], 79: [1.60, 1.28], 80: [1.45, 1.15], 81: [1.40, 1.12],
    135: [1.49, 1.19], 136: [1.38, 1.08],
    61: [1.51, 1.18], 62: [1.40, 1.10], 63: [1.38, 1.08], 64: [1.35, 1.06],
    88: [1.81, 1.44], 89: [1.65, 1.30],
    94: [1.48, 1.14], 95: [1.42, 1.12], 96: [1.38, 1.10],
    203: [1.56, 1.24], 204: [1.48, 1.18], 205: [1.42, 1.12],
    144: [1.62, 1.28], 145: [1.50, 1.20],
    179: [1.55, 1.20], 180: [1.48, 1.18],
    197: [1.43, 1.10], 198: [1.38, 1.08],
    235: [1.50, 1.18], 236: [1.42, 1.12],
    113: [1.60, 1.25], 114: [1.52, 1.20],
    119: [1.58, 1.22], 120: [1.50, 1.18],
    103: [1.55, 1.20], 104: [1.50, 1.18],
    106: [1.46, 1.14], 107: [1.40, 1.10],
    345: [1.50, 1.16], 346: [1.45, 1.14],
    283: [1.42, 1.12], 284: [1.38, 1.08],
    172: [1.40, 1.10], 218: [1.46, 1.12],
    210: [1.48, 1.14], 211: [1.42, 1.12],
    128: [1.50, 1.18], 129: [1.35, 1.05], 131: [1.28, 1.00], 132: [1.28, 1.00],
    71: [1.55, 1.20], 72: [1.40, 1.10], 75: [1.35, 1.05], 76: [1.28, 1.00],
    265: [1.45, 1.12], 266: [1.40, 1.10],
    239: [1.48, 1.15], 240: [1.45, 1.12],
    242: [1.40, 1.10],
    268: [1.42, 1.12], 269: [1.38, 1.08],
    299: [1.36, 1.06],
    344: [1.30, 1.02],
    252: [1.38, 1.08],
    281: [1.40, 1.10],
    262: [1.48, 1.15],
    253: [1.40, 1.10],
    307: [1.55, 1.22], 308: [1.45, 1.14],
    305: [1.38, 1.08],
    290: [1.35, 1.05],
    98: [1.50, 1.18], 99: [1.45, 1.14], 100: [1.40, 1.12],
    292: [1.48, 1.15], 293: [1.40, 1.10],
    169: [1.45, 1.15], 170: [1.38, 1.08],
    323: [1.42, 1.12], 324: [1.38, 1.10],
    274: [1.38, 1.08],
    297: [1.38, 1.08],
    340: [1.36, 1.06],
    188: [1.40, 1.10],
    233: [1.30, 1.02],
    200: [1.33, 1.06],
    186: [1.28, 1.00],
    288: [1.38, 1.10], 289: [1.34, 1.08],
    399: [1.30, 1.02],
  }
  const pair = baselines[leagueId] ?? [1.45, 1.18]
  return side === 'home' ? pair[0] : pair[1]
}