// ─── API-Football client v5 ───────────────────────────────────────────────────
//
// v5 changes over v4:
//   • Odds extraction: Pinnacle is now the definitive primary source — if
//     Pinnacle is unavailable we fall through a strict priority chain and
//     compute a CLIPPED median (drop top/bottom 15%) rather than a raw median,
//     which removes outlier soft books (BetBuilder, affiliate skins).
//   • Added ~50 additional league IDs covering Central America, Caribbean,
//     South-East Asia, Central Asia, and North/West Africa gap leagues.
//   • Country strings verified against API-Football /leagues endpoint naming
//     convention (hyphens for multi-word countries, exact case).
//   • avgDrawRate values updated using 3-season rolling averages where data
//     is available; previous values were best-guess or carried from v3.
//   • getLeagueGoalsAvg baseline table extended to match new leagues.
//   • fetchOddsForFixture returns 0 (no odds) rather than throwing when the
//     odds endpoint returns an empty bookmakers array, preventing pipeline
//     stalls on edge-case fixtures.

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
// Rules:
//  1. Every numeric key MUST be UNIQUE (TS error 1117 if duplicated)
//  2. `country` must match API-Football's exact string (hyphens for spaces:
//     "Czech-Republic", "South-Korea", "Saudi-Arabia", "Costa-Rica", etc.)
//  3. Leagues sharing identical names (e.g. "Primera División") MUST each
//     have their own unique numeric key
//  4. avgDrawRate is a 3-season rolling average from confirmed data where
//     available; plausible estimate where data is sparse

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
  435: { name: 'Primera División RFEF - Group 1',   country: 'Spain',              avgDrawRate: 0.30 },
  436: { name: 'Primera División RFEF - Group 2',   country: 'Spain',              avgDrawRate: 0.30 },
  437: { name: 'Primera División RFEF - Group 3',   country: 'Spain',              avgDrawRate: 0.30 },
  438: { name: 'Primera División RFEF - Group 4',   country: 'Spain',              avgDrawRate: 0.31 },


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
  97:  { name: 'Taça da Liga',              country: 'Portugal',           avgDrawRate: 0.31 },
  865: { name: 'Liga 3',                     country: 'Portugal',           avgDrawRate: 0.31 },

  // ── Turkey ───────────────────────────────────────────────────────────────────
  203: { name: 'Süper Lig',                  country: 'Turkey',             avgDrawRate: 0.28 },
  204: { name: 'TFF 1. Lig',                 country: 'Turkey',             avgDrawRate: 0.29 },
  205: { name: 'TFF 2. Lig',                 country: 'Turkey',             avgDrawRate: 0.30 },
  206: { name: 'Türkiye Kupası',             country: 'Turkey',             avgDrawRate: 0.30 },

  // ── Belgium ──────────────────────────────────────────────────────────────────
  144: { name: 'Pro League',                 country: 'Belgium',            avgDrawRate: 0.27 },
  145: { name: 'Challenger Pro League',      country: 'Belgium',            avgDrawRate: 0.29 },
  519: { name: 'Super Cup',                country: 'Belgium',            avgDrawRate: 0.30 },

  // ── Scotland ─────────────────────────────────────────────────────────────────
  179: { name: 'Premiership',                country: 'Scotland',           avgDrawRate: 0.26 },
  180: { name: 'Championship',               country: 'Scotland',           avgDrawRate: 0.28 },
  183: { name: 'League One',                 country: 'Scotland',           avgDrawRate: 0.27 },
  184: { name: 'League Two',                 country: 'Scotland',           avgDrawRate: 0.27 },
  182: { name: 'Challenge Cup',              country: 'Scotland',           avgDrawRate: 0.27 },
  181: { name: 'FA Cup',                    country: 'Scotland',           avgDrawRate: 0.28 },

  // ── Greece ───────────────────────────────────────────────────────────────────
  197: { name: 'Super League 1',             country: 'Greece',             avgDrawRate: 0.30 },
  198: { name: 'Football League',            country: 'Greece',             avgDrawRate: 0.30 },
  494: { name: 'Super League 2',             country: 'Greece',             avgDrawRate: 0.31 },

  // ── Russia ───────────────────────────────────────────────────────────────────
  235: { name: 'Premier League',             country: 'Russia',             avgDrawRate: 0.27 },
  236: { name: 'FNL',                        country: 'Russia',             avgDrawRate: 0.28 },
  237: { name: 'Russia Cup',                 country: 'Russia',             avgDrawRate: 0.29 },

  // ── Ukraine ──────────────────────────────────────────────────────────────────
  334: { name: 'Persha League',             country: 'Ukraine',            avgDrawRate: 0.26 },
  333: { name: 'Premier League',            country: 'Ukraine',            avgDrawRate: 0.28 },
  335: { name: 'Ukraine Cup',               country: 'Ukraine',            avgDrawRate: 0.28 },
  336: { name: 'Druha League',              country: 'Ukraine',            avgDrawRate: 0.29 },

  // ── Austria ──────────────────────────────────────────────────────────────────
  218: { name: 'Bundesliga',                 country: 'Austria',            avgDrawRate: 0.27 },
  219: { name: '2. Liga',                    country: 'Austria',            avgDrawRate: 0.28 },
  220: { name: 'Austrian Cup',              country: 'Austria',            avgDrawRate: 0.29 },

  // ── Switzerland ──────────────────────────────────────────────────────────────
  207: { name: 'Super League',               country: 'Switzerland',        avgDrawRate: 0.27 },
  208: { name: 'Challenge League',           country: 'Switzerland',        avgDrawRate: 0.28 },

  // ── Sweden ───────────────────────────────────────────────────────────────────
  113: { name: 'Allsvenskan',                country: 'Sweden',             avgDrawRate: 0.27 },
  114: { name: 'Superettan',                 country: 'Sweden',             avgDrawRate: 0.28 },
  115: { name: 'Svenska Cupen',              country: 'Sweden',             avgDrawRate: 0.29 },

  // ── Norway ───────────────────────────────────────────────────────────────────
  104: { name: 'OBOS-ligaen',                country: 'Norway',             avgDrawRate: 0.28 },
  103: { name: 'Eliteserien',            country: 'Norway',             avgDrawRate: 0.29 },
  105: { name: 'Norwegian Cup',              country: 'Norway',             avgDrawRate: 0.30 },
  

  // ── Denmark ──────────────────────────────────────────────────────────────────
  119: { name: 'Superliga',                  country: 'Denmark',            avgDrawRate: 0.27 },
  120: { name: '1st Division',               country: 'Denmark',            avgDrawRate: 0.29 },
  122: { name: '2nd Division',               country: 'Denmark',            avgDrawRate: 0.30 },
  123: { name: '2nd Division Group 2',       country: 'Denmark',            avgDrawRate: 0.30 },


  // ── Finland ──────────────────────────────────────────────────────────────────
  //244: { name: 'Veikkausliiga',              country: 'Finland',            avgDrawRate: 0.27 },
  //245: { name: 'Ykkönen',                    country: 'Finland',            avgDrawRate: 0.28 },

  // ── Poland ───────────────────────────────────────────────────────────────────
  106: { name: 'Ekstraklasa',                country: 'Poland',             avgDrawRate: 0.29 },
  107: { name: 'I Liga',                     country: 'Poland',             avgDrawRate: 0.30 },
   727: { name: 'Polish Cup',                 country: 'Poland',             avgDrawRate: 0.31 },

  // ── Czech Republic ─── API uses "Czech-Republic" ──────────────────────────
  345: { name: 'Czech Liga',                 country: 'Czech-Republic',     avgDrawRate: 0.28 },
  346: { name: 'FNL',                        country: 'Czech-Republic',     avgDrawRate: 0.29 },

  // ── Slovakia ─────────────────────────────────────────────────────────────────
  332: { name: 'Super Liga',                 country: 'Slovakia',           avgDrawRate: 0.28 },
  506: { name: '2. Liga',                    country: 'Slovakia',           avgDrawRate: 0.29 },

  // ── Hungary ──────────────────────────────────────────────────────────────────
  271: { name: 'NB 1',              country: 'Hungary',            avgDrawRate: 0.28 },
  272: { name: 'NB 2',              country: 'Hungary',            avgDrawRate: 0.29 },

  // ── Romania ──────────────────────────────────────────────────────────────────
  283: { name: 'Liga 1',                     country: 'Romania',            avgDrawRate: 0.30 },
  284: { name: 'Liga 2',                     country: 'Romania',            avgDrawRate: 0.31 },

  // ── Bulgaria ─────────────────────────────────────────────────────────────────
  172: { name: 'First Professional League',  country: 'Bulgaria',           avgDrawRate: 0.29 },
  173: { name: 'Second Professional League', country: 'Bulgaria',           avgDrawRate: 0.30 },

  // ── Serbia ───────────────────────────────────────────────────────────────────
  287: { name: 'Prva Liga',                  country: 'Serbia',             avgDrawRate: 0.28},
  286: { name: 'Super Liga',                  country: 'Serbia',             avgDrawRate: 0.29},

  // ── Croatia ──────────────────────────────────────────────────────────────────
  210: { name: 'HNL',                        country: 'Croatia',            avgDrawRate: 0.28 },
  211: { name: 'First NL',                      country: 'Croatia',            avgDrawRate: 0.29 },
  212: { name: 'Croatian Cup',              country: 'Croatia',            avgDrawRate: 0.30 },

  // ── Slovenia ─────────────────────────────────────────────────────────────────
  373: { name: '1. SNL',                     country: 'Slovenia',           avgDrawRate: 0.29 },
  374: { name: '2. SNL',                     country: 'Slovenia',           avgDrawRate: 0.30 },
  375: { name: 'Slovenian Cup',              country: 'Slovenia',           avgDrawRate: 0.30 },


  // ── Bosnia ───────────────────────────────────────────────────────────────────
  315: { name: 'Premier Liga',               country: 'Bosnia',             avgDrawRate: 0.30 },

  // ── North Macedonia ──────────────────────────────────────────────────────────
  371: { name: 'First League',             country: 'North-Macedonia',    avgDrawRate: 0.31 },
  756: { name: 'Macedonian Cup',            country: 'North-Macedonia',    avgDrawRate: 0.31 },

  // ── Albania ──────────────────────────────────────────────────────────────────
  311: { name: '1st Division',           country: 'Albania',            avgDrawRate: 0.30 },
  707: { name: 'Cup',          country: 'Albania',            avgDrawRate: 0.30 },
  310: { name: 'Superliga',        country: 'Albania',            avgDrawRate: 0.30 },


  // ── Kosovo ───────────────────────────────────────────────────────────────────
  664: { name: 'Football Superleague',       country: 'Kosovo',             avgDrawRate: 0.30 },

  // ── Montenegro ───────────────────────────────────────────────────────────────
  355: { name: 'First League',            country: 'Montenegro',         avgDrawRate: 0.30 },
  356: { name: 'Second League',                   country: 'Montenegro',         avgDrawRate: 0.30 },
  723: { name: 'Montenegrin Cup',                   country: 'Montenegro',         avgDrawRate: 0.30 },

  // ── Israel ───────────────────────────────────────────────────────────────────
  383: { name: "Ligat Ha'Al",                country: 'Israel',             avgDrawRate: 0.28 },
  496: { name: 'Liga Alef',                   country: 'Israel',            avgDrawRate: 0.29 }, 
  382: { name: 'Liga Leumit',                country: 'Israel',             avgDrawRate: 0.29 },
  384: { name: 'State Cup',                 country: 'Israel',             avgDrawRate: 0.30 },
  385: { name: 'Toto Cup',                country:  'Israel',             avgDrawRate: 0.30 },


  // ── Cyprus ───────────────────────────────────────────────────────────────────
  318: { name: 'First Division',             country: 'Cyprus',             avgDrawRate: 0.30 },
  319: { name: 'Second Division',            country: 'Cyprus',             avgDrawRate: 0.30 },
  320: { name: 'Third Division',              country: 'Cyprus',             avgDrawRate: 0.31 },


  // ── Belarus ──────────────────────────────────────────────────────────────────
  117: { name: 'First League',              country: 'Belarus',            avgDrawRate: 0.29 },
  118: { name: 'Belarus Cup',              country: 'Belarus',            avgDrawRate: 0.30 },
  116: { name: 'Premier League',             country: 'Belarus',            avgDrawRate: 0.30 },

  // ── Lithuania ────────────────────────────────────────────────────────────────
  361: { name: '1 Lyga',                     country: 'Lithuania',          avgDrawRate: 0.27 },
  362: { name: 'A Lyga',                     country: 'Lithuania',          avgDrawRate: 0.28 },

  // ── Latvia ───────────────────────────────────────────────────────────────────
  364: { name: '1. Liga',                   country: 'Latvia',             avgDrawRate: 0.27 },
  365: { name: 'Virslīga',                  country: 'Latvia',             avgDrawRate: 0.28 },

  // ── Estonia ──────────────────────────────────────────────────────────────────
  329: { name: 'Meistriliiga',               country: 'Estonia',            avgDrawRate: 0.28 },
  328: { name: 'Esiliiga',                   country: 'Estonia',            avgDrawRate: 0.29 },
  1126: { name: 'Esiliiga B',                country: 'Estonia',            avgDrawRate: 0.30 },
  657: { name: 'Estonian Cup',              country: 'Estonia',            avgDrawRate: 0.30 },


  // ── Iceland ──────────────────────────────────────────────────────────────────
  164: { name: 'Úrvalsdeild',                country: 'Iceland',            avgDrawRate: 0.26 },
  165: { name: '1. Deild',                   country: 'Iceland',            avgDrawRate: 0.27 },
  166: { name: '2. Deild',                   country: 'Iceland',            avgDrawRate: 0.28 },
  814: { name: 'Icelandic Cup',              country: 'Iceland',            avgDrawRate: 0.29 },

  // ── Ireland ──────────────────────────────────────────────────────────────────
  357: { name: 'Premier Division',           country: 'Ireland',            avgDrawRate: 0.28 },
  358: { name: 'First Division',             country: 'Ireland',            avgDrawRate: 0.29 },
  408: { name: 'Premiership',                country: 'Ireland',            avgDrawRate: 0.30 },

  // ── Wales ────────────────────────────────────────────────────────────────────
 // 720: { name: 'Cymru Premier',              country: 'Wales',              avgDrawRate: 0.27 },

  // ── Northern Ireland ─────────────────────────────────────────────────────────
  359: { name: 'NIFL Premiership',           country: 'Northern-Ireland',   avgDrawRate: 0.28 },
  407: { name: 'NIFL Championship',          country: 'Northern-Ireland',   avgDrawRate: 0.29 },

  // ── Georgia ──────────────────────────────────────────────────────────────────
  //632: { name: 'Erovnuli Liga',              country: 'Georgia',            avgDrawRate: 0.29 },

  // ── Armenia ──────────────────────────────────────────────────────────────────
  342: { name: 'Premier League',             country: 'Armenia',            avgDrawRate: 0.28 },
  709: { name: 'Armenian Cup',              country: 'Armenia',            avgDrawRate: 0.29 },
  343: { name: 'First League',             country: 'Armenia',            avgDrawRate: 0.29 },
  654: { name: 'Super Cup',                country: 'Armenia',            avgDrawRate: 0.30 },

  // ── Azerbaijan ───────────────────────────────────────────────────────────────
  418: { name: 'Birinci Dasta',             country: 'Azerbaijan',         avgDrawRate: 0.29 },
  419: { name: 'Premyer Liqa',             country: 'Azerbaijan',         avgDrawRate: 0.29 },
  420: { name: 'Cup',                country: 'Azerbaijan',         avgDrawRate: 0.30 },

  // ── Moldova ──────────────────────────────────────────────────────────────────
  395: { name: 'Liga 1',                 country: 'Moldova',            avgDrawRate: 0.30 },
  394: { name: 'Super Liga',              country: 'Moldova',            avgDrawRate: 0.31 },

  // ════════════════════════════════════════════════════════════════════════════
  // SOUTH AMERICA
  // ════════════════════════════════════════════════════════════════════════════

  128: { name: 'Liga Profesional',           country: 'Argentina',          avgDrawRate: 0.29 },
  129: { name: 'Primera Nacional',           country: 'Argentina',          avgDrawRate: 0.31 },
  132: { name: 'Primera  C',                 country: 'Argentina',          avgDrawRate: 0.28 },
  130: { name: 'Copa Argentina',             country: 'Argentina',          avgDrawRate: 0.29 },
  1032: { name: 'Supercopa Argentina',         country: 'Argentina',          avgDrawRate: 0.30 },
  131: { name: 'Primera B Metropolitana',     country: 'Argentina',          avgDrawRate: 0.30 },
  810: { name: 'Super Copa',             country: 'Argentina',          avgDrawRate: 0.31 },
  134: { name: 'Torneo Federal A',             country: 'Argentina',          avgDrawRate: 0.31 },
  517: { name: 'Trofeo de Campeones de la Superliga', country: 'Argentina',          avgDrawRate: 0.31 },


  71:  { name: 'Série A',                    country: 'Brazil',             avgDrawRate: 0.28 },
  72:  { name: 'Série B',                    country: 'Brazil',             avgDrawRate: 0.30 },
  75:  { name: 'Série C',                    country: 'Brazil',             avgDrawRate: 0.31 },
  76:  { name: 'Série D',                    country: 'Brazil',             avgDrawRate: 0.32 },
  610: { name: 'Brasiliense',                country: 'Brazil',             avgDrawRate: 0.30 },
  73:  { name: 'Copa do Brasil',             country: 'Brazil',             avgDrawRate: 0.30 },

  265: { name: 'Primera División',           country: 'Chile',              avgDrawRate: 0.28 },
  266: { name: 'Primera B',                  country: 'Chile',              avgDrawRate: 0.30 },
  711: { name: 'Segunda División',           country: 'Chile',              avgDrawRate: 0.31 },
  267: { name: 'Copa Chile',                 country: 'Chile',              avgDrawRate: 0.32 },
  527: { name: 'Supercopa de Chile',         country: 'Chile',              avgDrawRate: 0.31 },

  239: { name: 'Primera A',                  country: 'Colombia',           avgDrawRate: 0.28 },
  240: { name: 'Primera B',                  country: 'Colombia',           avgDrawRate: 0.29 },
  241: { name: 'Copa Colombia',              country: 'Colombia',           avgDrawRate: 0.30 },
  713: { name: 'Superliga',                  country: 'Colombia',           avgDrawRate: 0.31 },

  242: { name: 'Liga Pro',                   country: 'Ecuador',            avgDrawRate: 0.29 },
  243: { name: 'Liga Pro B',                 country: 'Ecuador',            avgDrawRate: 0.30 },
  917: { name: 'Copa Ecuador',               country: 'Ecuador',            avgDrawRate: 0.31 },

  268: { name: 'Primera División',           country: 'Uruguay',            avgDrawRate: 0.29 },
  270: { name: 'Primera División-Clausura',  country: 'Uruguay',            avgDrawRate: 0.30 },
  269: { name: 'Segunda División',           country: 'Uruguay',            avgDrawRate: 0.30 },
  842: { name: 'Supa Copa',                  country: 'Uruguay',            avgDrawRate: 0.31 },
  930: { name: 'Copa Uruguay',               country: 'Uruguay',            avgDrawRate: 0.30 },



  299: { name: 'Primera División',           country: 'Venezuela',          avgDrawRate: 0.31 },
  300: { name: 'Segunda División',           country: 'Venezuela',          avgDrawRate: 0.31 },
  1113: { name: 'Copa Venezuela',           country: 'Venezuela',          avgDrawRate: 0.31 },



  344: { name: 'Primera División',           country: 'Bolivia',           avgDrawRate: 0.29 },
  710: { name: 'Nacional B',                 country: 'Bolivia',           avgDrawRate: 0.30 },

  251: { name: 'División Intermedia',        country: 'Paraguay',           avgDrawRate: 0.31 },
  252: { name: 'División Profesional',       country: 'Paraguay',           avgDrawRate: 0.30 },
  501: { name: 'Copa Paraguay',              country: 'Paraguay',           avgDrawRate: 0.31 },
  961: { name: 'Super Copa Paraguay',        country: 'Paraguay',           avgDrawRate: 0.31 },

  281: { name: 'Liga 1',                     country: 'Peru',               avgDrawRate: 0.29 },
  282: { name: 'Liga 2',                     country: 'Peru',               avgDrawRate: 0.30 },

  // ════════════════════════════════════════════════════════════════════════════
  // NORTH & CENTRAL AMERICA / CARIBBEAN
  // ════════════════════════════════════════════════════════════════════════════

  262: { name: 'Liga MX',                    country: 'Mexico',             avgDrawRate: 0.27 },
  263: { name: 'Liga de Expansión MX',       country: 'Mexico',             avgDrawRate: 0.28 },
  722: { name: 'Liga Premier Serie A',       country: 'Mexico',             avgDrawRate: 0.29 },
  872: { name: 'Liga Premier Serie B',       country: 'Mexico',             avgDrawRate: 0.29 },

  253: { name: 'MLS',                        country: 'USA',                avgDrawRate: 0.27 },
  909: { name: 'MLS Next Pro',               country: 'USA',                avgDrawRate: 0.28 },
  257: { name: 'US Open Cup',                country: 'USA',                avgDrawRate: 0.27 },
  255: { name: 'USL Championship',           country: 'USA',                avgDrawRate: 0.26 },
  489: {name: 'USL League One',              country: 'USA',                avgDrawRate: 0.26 },
  256: { name: 'USL League Two',             country: 'USA',                avgDrawRate: 0.26 },

  479: { name: 'Canadian Premier League',     country: 'Canada',             avgDrawRate: 0.27 },

  163: { name: 'Liga de Ascenso',           country: 'Costa-Rica',         avgDrawRate: 0.28 },
  162: { name: 'Primera División',            country: 'Costa-Rica',         avgDrawRate: 0.29 },
  864: { name: 'Super Copa Costa Rica',       country: 'Costa-Rica',         avgDrawRate: 0.29 },

  // Guatemala
  339: { name: 'Liga Nacional',              country: 'Guatemala',          avgDrawRate: 0.27 },

  // Honduras
  234: { name: 'Liga Nacional',              country: 'Honduras',           avgDrawRate: 0.27 },

  // El Salvador
  370: { name: 'Primera División',           country: 'El-Salvador',        avgDrawRate: 0.29 },

  // Panama
  304: { name: 'Liga Panameña de Fútbol',    country: 'Panama',             avgDrawRate: 0.28 },

  // Jamaica
  322: { name: 'Premier League',             country: 'Jamaica',            avgDrawRate: 0.30 },

  // Trinidad & Tobago
  591: { name: 'Pro League',                 country: 'Trinidad-And-Tobago',avgDrawRate: 0.30 },

  // ════════════════════════════════════════════════════════════════════════════
  // MIDDLE EAST
  // ════════════════════════════════════════════════════════════════════════════

  307: { name: 'Saudi Professional League',  country: 'Saudi-Arabia',       avgDrawRate: 0.27 },
  308: { name: 'Division 1',                 country: 'Saudi-Arabia',       avgDrawRate: 0.28 },
  309: { name: 'Division 2',                 country: 'Saudi-Arabia',       avgDrawRate: 0.29 },
  504: { name: 'King Cup',                   country: 'Saudi-Arabia',       avgDrawRate: 0.30 },


  //188: { name: 'UAE Pro League',             country: 'UAE',                avgDrawRate: 0.28 },
  //189: { name: 'UAE Division 1',             country: 'UAE',                avgDrawRate: 0.29 },

  305: { name: 'Qatar Stars League',         country: 'Qatar',              avgDrawRate: 0.27 },
  677: { name: 'QSL CUP',                    country: 'Qatar',              avgDrawRate: 0.28 },
  306: { name: 'Qatar Second Division',      country: 'Qatar',              avgDrawRate: 0.28 },

  290: { name: 'Persian Gulf Pro League',    country: 'Iran',               avgDrawRate: 0.31 },
  291: { name: 'Azadegan League',            country: 'Iran',               avgDrawRate: 0.32 },
  495: { name: 'Hazfi Cup',                  country: 'Iran',               avgDrawRate: 0.32 },


  542: { name: 'Iraq Stars League',          country: 'Iraq',               avgDrawRate: 0.32 },

  387: { name: 'First Division',             country: 'Jordan',             avgDrawRate: 0.31 },

  390: { name: 'Premier League',             country: 'Lebanon',            avgDrawRate: 0.30 },

  425: { name: 'Premier League',             country: 'Syria',              avgDrawRate: 0.30 },

  330: { name: 'Kuwait Premier League',      country: 'Kuwait',             avgDrawRate: 0.31 },

  1049: { name: 'King Cup',                  country: 'Bahrain',            avgDrawRate: 0.31 },
  417: { name: 'Premier League',             country: 'Bahrain',            avgDrawRate: 0.31 },

  406: { name: 'Professional League',        country: 'Oman',               avgDrawRate: 0.31 },
  726: { name: 'Sultan Cup',                 country: 'Oman',               avgDrawRate: 0.31 },

  // ════════════════════════════════════════════════════════════════════════════
  // ASIA
  // ════════════════════════════════════════════════════════════════════════════

  98:  { name: 'J1 League',                  country: 'Japan',              avgDrawRate: 0.26 },
  99:  { name: 'J2 League',                  country: 'Japan',              avgDrawRate: 0.27 },
  100: { name: 'J3 League',                  country: 'Japan',              avgDrawRate: 0.28 },
  102: { name: 'Emperor\'s Cup',             country: 'Japan',              avgDrawRate: 0.29 },

  292: { name: 'K League 1',                 country: 'South-Korea',        avgDrawRate: 0.27 },
  293: { name: 'K League 2',                 country: 'South-Korea',        avgDrawRate: 0.27 },
  295: { name: 'K3 League',                 country: 'South-Korea',        avgDrawRate: 0.28 },

  169: { name: 'Super League',               country: 'China',              avgDrawRate: 0.26 },
  170: { name: 'China League One',           country: 'China',              avgDrawRate: 0.27 },
  171: { name: 'FA Cup',                     country: 'China',              avgDrawRate: 0.28 },
  929: { name: 'China League Two',           country: 'China',              avgDrawRate: 0.29 },
  972: { name: 'Super Cup',                  country: 'China',              avgDrawRate: 0.29 },

 
  // India
  323: { name: 'Indian Super League',        country: 'India',              avgDrawRate: 0.27 },
  324: { name: 'I-League',                   country: 'India',              avgDrawRate: 0.28 },

   
  // Indonesia
  274: { name: 'Liga 1',                     country: 'Indonesia',          avgDrawRate: 0.27 },
  275: { name: 'Liga 2',                     country: 'Indonesia',          avgDrawRate: 0.28 },

  // Thailand
  297: { name: 'Thai League 1',             country: 'Thailand',           avgDrawRate: 0.26 },
  298: { name: 'Thai FA Cup',               country: 'Thailand',           avgDrawRate: 0.27 },
  898: { name: 'Thai League Cup',           country: 'Thailand',           avgDrawRate: 0.27 },

  // Vietnam
  340: { name: 'V.League 1',                 country: 'Vietnam',            avgDrawRate: 0.27 },
  341: { name: 'Vietnam Cup',                 country: 'Vietnam',            avgDrawRate: 0.28 },
  637: { name: 'V.League 2',                 country: 'Vietnam',            avgDrawRate: 0.28 },

  // Malaysia
  278: { name: 'Super League',             country: 'Malaysia',           avgDrawRate: 0.28 },

  // Singapore
  368: { name: 'Premier League',             country: 'Singapore',          avgDrawRate: 0.26 },

  // Philippines
  765: { name: 'PFL',                        country: 'Philippines',        avgDrawRate: 0.28 },

  // Uzbekistan
  369: { name: 'Super League',               country: 'Uzbekistan',         avgDrawRate: 0.28 },
  1075: { name: 'Pro League A',               country: 'Uzbekistan',         avgDrawRate: 0.28 },

  // Kazakhstan
  388: { name: 'Premier League',             country: 'Kazakhstan',         avgDrawRate: 0.28 },
  389: { name: 'Premier League',             country: 'Kazakhstan',         avgDrawRate: 0.28 },

  // Australia
  188: { name: 'A-League Men',               country: 'Australia',          avgDrawRate: 0.25 },

  // New Zealand
  //433: { name: 'National League',            country: 'New-Zealand',        avgDrawRate: 0.26 },

  // ════════════════════════════════════════════════════════════════════════════
  // AFRICA
  // ════════════════════════════════════════════════════════════════════════════

  399: { name: 'NPFL',                       country: 'Nigeria',            avgDrawRate: 0.33 },

  233: { name: 'Egyptian Premier League',    country: 'Egypt',              avgDrawRate: 0.32 },
  714: { name: 'Egyptian Cup',               country: 'Egypt',              avgDrawRate: 0.33 },
  887: { name: 'Second League',              country: 'Egypt',              avgDrawRate: 0.33 },
  539: { name: 'Egyptian Super Cup',          country: 'Egypt',              avgDrawRate: 0.33 },


  200: { name: 'Botola Pro',                 country: 'Morocco',            avgDrawRate: 0.30 },
  201: { name: 'Botola 2',                   country: 'Morocco',            avgDrawRate: 0.31 },


  186: { name: 'Ligue 1',                    country: 'Algeria',            avgDrawRate: 0.31 },
  187: { name: 'Ligue 2',                    country: 'Algeria',            avgDrawRate: 0.31 },
  514: { name: 'Coupe Nationale',            country: 'Algeria',            avgDrawRate: 0.32 },


  202: { name: 'Ligue 1',                    country: 'Tunisia',            avgDrawRate: 0.31 },

  288: { name: 'Premier Soccer League',      country: 'South-Africa',       avgDrawRate: 0.29 },
  289: { name: 'National First Division',    country: 'South-Africa',       avgDrawRate: 0.30 },
  507: { name: 'Cup',                      country: 'South-Africa',       avgDrawRate: 0.30 },
  734: { name: 'Diski Challenge',            country: 'South-Africa',       avgDrawRate: 0.30 },
  509: { name: 'MTN 8 Cup',                country: 'South-Africa',       avgDrawRate: 0.30 },

  // Ghana
  966: { name: 'MTN Cup',                 country: 'Ghana',              avgDrawRate: 0.30 },
  1196: { name: 'Division 1 League',      country: 'Ghana',              avgDrawRate: 0.30 },
  570: { name: 'Premier League',          country: 'Ghana',              avgDrawRate: 0.30 },
  1144: { name: 'Super Cup',             country: 'Ghana',              avgDrawRate: 0.30 },


  // Kenya
  276: { name: 'Premier League',             country: 'Kenya',              avgDrawRate: 0.28 },
  277: { name: 'Super League',               country: 'Kenya',              avgDrawRate: 0.28 },
  // Ivory Coast — API uses "Ivory-Coast"
  386: { name: 'Ligue 1',                    country: 'Ivory-Coast',        avgDrawRate: 0.30 },

  // Senegal
  403: { name: 'Ligue 1',                    country: 'Senegal',            avgDrawRate: 0.30 },

  // Cameroon
  411: { name: 'Elite One',                  country: 'Cameroon',           avgDrawRate: 0.31 },

  // Tanzania
  567: { name: 'Premier League',             country: 'Tanzania',           avgDrawRate: 0.30 },

  // Uganda
  585: { name: 'Premier League',             country: 'Uganda',             avgDrawRate: 0.29 },

  // Zimbabwe
  401: { name: 'Premier Soccer League',      country: 'Zimbabwe',           avgDrawRate: 0.29 },

  // Zambia
  400: { name: 'Super League',               country: 'Zambia',             avgDrawRate: 0.30 },

  // Ethiopia
  363: { name: 'Ethiopian Premier League',   country: 'Ethiopia',           avgDrawRate: 0.29 },

  // Rwanda
  405: { name: 'Rwanda Premier League',      country: 'Rwanda',             avgDrawRate: 0.29 },

  // Libya
  584: { name: 'Premier League',             country: 'Libya',              avgDrawRate: 0.31 },

  // Sudan
  402: { name: 'Premier League',             country: 'Sudan',              avgDrawRate: 0.31 },

  // Angola
  397: { name: 'Girabola',                   country: 'Angola',             avgDrawRate: 0.31 },

  // DR Congo
  424: { name: 'Linafoot',                   country: 'DR-Congo',           avgDrawRate: 0.31 },

  // Mali
  598: { name: 'Première Division',          country: 'Mali',               avgDrawRate: 0.32 },

  // Burkina Faso
  423: { name: 'Première Division',          country: 'Burkina-Faso',       avgDrawRate: 0.31 },

  // Mozambique
  //585: { name: 'Moçambola',                  country: 'Mozambique',         avgDrawRate: 0.30 },

  // Namibia
  //587: { name: 'Premier League',             country: 'Namibia',            avgDrawRate: 0.29 },

  // Botswana
  412: { name: 'Premier League',             country: 'Botswana',           avgDrawRate: 0.29 },
}

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
  const used      = res.headers.get('x-ratelimit-requests-used')
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

// ─── Odds extraction — module scope ──────────────────────────────────────────

function extractDrawOddsFromBookmaker(
  bm: ApiFootballOdds['bookmakers'][0]
): number {
  const bet = bm.bets.find((b) => b.id === 1 || b.name === 'Match Winner')
  if (!bet) return 0
  const drawVal = bet.values.find((v) => v.value === 'Draw' || v.value === 'X')
  return drawVal ? parseFloat(drawVal.odd) : 0
}

/**
 * Strict bookmaker priority chain.
 * Pinnacle is the definitive sharp reference — if available, use it.
 * Otherwise walk down the chain to the first book with a valid draw price.
 * Fallback: clipped median (trim 15% tails) to neutralise soft/affiliate books.
 */
const PRIORITY_BOOKS: readonly string[] = [
  'pinnacle',
  'bet365',
  'williamhill',
  'william hill',
  'bwin',
  'unibet',
  'betfair exchange',
  'betfair',
  'marathonbet',
  'betsson',
  '1xbet',
  'nordicbet',
  'betway',
  'parimatch',
]

export async function fetchOddsForFixture(
  apiKey: string,
  fixtureId: number
): Promise<number> {
  try {
    const data = await apiFetch<ApiFootballOdds[]>(
      apiKey,
      `/odds?fixture=${fixtureId}&bet=1`
    )
    const bookmakers = data[0]?.bookmakers ?? []
    if (bookmakers.length === 0) return 0

    // 1. Walk strict priority chain — return first valid price
    for (const preferred of PRIORITY_BOOKS) {
      for (const bm of bookmakers) {
        if (bm.name.toLowerCase().includes(preferred)) {
          const odds = extractDrawOddsFromBookmaker(bm)
          if (odds > 0) {
            console.log(`[odds] fixture ${fixtureId} — using ${bm.name}: ${odds}`)
            return odds
          }
        }
      }
    }

    // 2. Clipped median fallback — trim bottom and top 15% of books
    const allOdds = bookmakers
      .map((bm) => extractDrawOddsFromBookmaker(bm))
      .filter((o) => o >= 1.20 && o <= 20.0)  // sanity bounds
      .sort((a, b) => a - b)

    if (allOdds.length === 0) return 0

    const trimCount = Math.floor(allOdds.length * 0.15)
    const trimmed = allOdds.slice(trimCount, allOdds.length - trimCount)
    if (trimmed.length === 0) return allOdds[Math.floor(allOdds.length / 2)]

    const mid = Math.floor(trimmed.length / 2)
    const median = trimmed.length % 2 !== 0
      ? trimmed[mid]
      : (trimmed[mid - 1] + trimmed[mid]) / 2

    console.log(`[odds] fixture ${fixtureId} — clipped median (${trimmed.length} books): ${median}`)
    return Math.round(median * 100) / 100
  } catch (err) {
    console.warn(`[odds] fixture ${fixtureId} fetch failed:`, err)
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
          date:          f.fixture.date,
          goalsScored:   isHome ? f.goals.home! : f.goals.away!,
          goalsConceded: isHome ? f.goals.away! : f.goals.home!,
          isDraw:        f.goals.home === f.goals.away,
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

  // H2H: require ≥3 completed results
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
    // Use verified map values — NOT raw API string (avoids DB name collisions)
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

function getLeagueGoalsAvg(leagueId: number, side: 'home' | 'away'): number {
  const baselines: Record<number, [number, number]> = {
    // [homeGoalsAvg, awayGoalsAvg]
    39: [1.53, 1.22], 40: [1.45, 1.15], 41: [1.42, 1.12], 42: [1.38, 1.10], 43: [1.40, 1.12],
    140: [1.55, 1.22], 141: [1.40, 1.10], 142: [1.38, 1.08], 143: [1.35, 1.06],
    78: [1.72, 1.38], 79: [1.60, 1.28], 80: [1.45, 1.15], 81: [1.40, 1.12],
    135: [1.49, 1.19], 136: [1.38, 1.08], 137: [1.32, 1.05],
    61: [1.51, 1.18], 62: [1.40, 1.10], 63: [1.38, 1.08], 64: [1.35, 1.06],
    88: [1.81, 1.44], 89: [1.65, 1.30],
    94: [1.48, 1.14], 95: [1.42, 1.12], 96: [1.38, 1.10],
    203: [1.56, 1.24], 204: [1.48, 1.18], 205: [1.42, 1.12], 206: [1.38, 1.10],
    144: [1.62, 1.28], 145: [1.50, 1.20],
    179: [1.55, 1.20], 180: [1.48, 1.18], 181: [1.42, 1.12], 182: [1.38, 1.10],
    197: [1.43, 1.10], 198: [1.38, 1.08],
    235: [1.50, 1.18], 236: [1.42, 1.12], 237: [1.38, 1.10],
    334: [1.48, 1.16], 335: [1.42, 1.12],
    361: [1.44, 1.12], 362: [1.40, 1.10],
    116: [1.55, 1.22], 117: [1.45, 1.14],
    207: [1.52, 1.20], 208: [1.44, 1.14],
    103: [1.55, 1.20], 104: [1.50, 1.18], 605: [1.45, 1.14],
    113: [1.60, 1.25], 114: [1.52, 1.20], 115: [1.45, 1.15],
    119: [1.58, 1.22], 120: [1.50, 1.18], 121: [1.44, 1.14],
    244: [1.48, 1.16], 245: [1.42, 1.12],
    106: [1.46, 1.14], 107: [1.40, 1.10], 108: [1.36, 1.08],
    345: [1.50, 1.16], 346: [1.45, 1.14],
    332: [1.44, 1.12], 333: [1.40, 1.10],
    271: [1.46, 1.14], 272: [1.40, 1.10],
    283: [1.42, 1.12], 284: [1.38, 1.08],
    172: [1.40, 1.10], 173: [1.36, 1.08],
    218: [1.46, 1.12], 219: [1.42, 1.10],
    210: [1.48, 1.14], 211: [1.42, 1.12],
    348: [1.42, 1.10], 349: [1.38, 1.08],
    400: [1.40, 1.10],
    401: [1.40, 1.10],
    402: [1.38, 1.08],
    405: [1.40, 1.10],
    363: [1.38, 1.08],
    966: [1.40, 1.10], 1196: [1.40, 1.10], 570: [1.40, 1.10], 1144: [1.40, 1.10],
    390: [1.40, 1.10],
    383: [1.44, 1.12], 384: [1.40, 1.10],
    304: [1.40, 1.10],
    261: [1.40, 1.10],
    276: [1.40, 1.10], 277: [1.38, 1.08],
    370: [1.38, 1.08],
    369: [1.42, 1.10],
    367: [1.40, 1.10],
    364: [1.38, 1.10],
    164: [1.52, 1.20],
    357: [1.44, 1.14],
    339: [1.40, 1.10],
    386: [1.40, 1.10],
    403: [1.40, 1.14],
    567: [1.40, 1.10],
    411: [1.42, 1.12],
    128: [1.50, 1.18], 129: [1.35, 1.05], 131: [1.28, 1.00], 132: [1.28, 1.00],
    71: [1.55, 1.20], 72: [1.40, 1.10], 75: [1.35, 1.05], 76: [1.28, 1.00],
    265: [1.45, 1.12], 266: [1.40, 1.10], 711: [1.38, 1.08], 267: [1.38, 1.08],
    239: [1.48, 1.15], 240: [1.45, 1.12], 241: [1.40, 1.10], 713: [1.38, 1.08],
    242: [1.40, 1.10], 243: [1.38, 1.08],
    268: [1.42, 1.12], 270: [1.40, 1.10], 269: [1.38, 1.08], 842: [1.38, 1.08], 930: [1.38, 1.08],
    299: [1.36, 1.06], 300: [1.32, 1.04], 1113: [1.30, 1.02],
    344: [1.30, 1.02], 710: [1.30, 1.02],
    251: [1.40, 1.10], 252: [1.38, 1.08], 501: [1.38, 1.08], 961: [1.38, 1.08],
    281: [1.40, 1.10], 282: [1.38, 1.08],
    262: [1.48, 1.15], 263: [1.40, 1.10], 722: [1.38, 1.08], 872: [1.38, 1.08],
    255: [1.42, 1.14], 256: [1.40, 1.12], 253: [1.40, 1.10], 909: [1.40, 1.10], 257: [1.38, 1.08], 489: [1.38, 1.08],
    479: [1.40, 1.10], 
    162: [1.38, 1.08], 163: [1.36, 1.06], 864: [1.36, 1.06],
    483: [1.35, 1.06], 474: [1.35, 1.06],
    315: [1.30, 1.02], 316: [1.30, 1.02],
    322: [1.30, 1.02], 321: [1.30, 1.02],
    307: [1.55, 1.22], 308: [1.45, 1.14], 309: [1.40, 1.12], 504: [1.38, 1.10],
    188: [1.40, 1.10], 189: [1.36, 1.08],
    305: [1.38, 1.08], 306: [1.36, 1.08], 677: [1.36, 1.08],
    290: [1.35, 1.05], 291: [1.30, 1.02], 495: [1.30, 1.02], 496: [1.30, 1.02],
    591: [1.30, 1.02], 592: [1.30, 1.02],
    967: [1.30, 1.02],
    425: [1.38, 1.08], 426: [1.36, 1.06],
    368: [1.38, 1.08],
    371: [1.33, 1.05],
    296: [1.32, 1.04], 330: [1.30, 1.02], 331: [1.30, 1.02],
    310: [1.30, 1.02], 312: [1.30, 1.02], 1049: [1.30, 1.02], 417: [1.30, 1.02],
    406: [1.30, 1.02], 407: [1.30, 1.02], 726: [1.30, 1.02],
    98: [1.50, 1.18], 99: [1.45, 1.14], 100: [1.40, 1.12], 102: [1.38, 1.10],
    292: [1.48, 1.15], 295: [1.42, 1.12], 293: [1.40, 1.10], 294: [1.38, 1.08],
    169: [1.45, 1.15], 170: [1.38, 1.08], 171: [1.33, 1.05], 929: [1.30, 1.02], 972: [1.30, 1.02],
    323: [1.42, 1.12], 324: [1.38, 1.10],
    234: [1.40, 1.10],
    274: [1.38, 1.08], 275: [1.34, 1.06],
    358: [1.35, 1.06], 359: [1.32, 1.05],
    297: [1.38, 1.08], 298: [1.34, 1.06], 898: [1.34, 1.06],
    340: [1.36, 1.06], 341: [1.32, 1.04], 637: [1.32, 1.04],
    166: [1.38, 1.08], 278: [1.34, 1.06],
    337: [1.30, 1.02], 765: [1.28, 1.00],
    686: [1.38, 1.08],
    683: [1.36, 1.06],
    433: [1.45, 1.15],
    336: [1.28, 1.00],
    233: [1.30, 1.02], 714: [1.28, 1.00], 887: [1.28, 1.00], 539: [1.28, 1.00],
    200: [1.33, 1.06], 201: [1.28, 1.02],
    196: [1.28, 1.00], 186: [1.28, 1.00], 187: [1.28, 1.00], 514: [1.28, 1.00],
    202: [1.32, 1.05],
    288: [1.38, 1.10], 289: [1.34, 1.08], 507: [1.30, 1.02], 734: [1.30, 1.02], 509: [1.30, 1.02],
    399: [1.30, 1.02],
    598: [1.26, 1.00], 596: [1.26, 1.00],
    580: [1.28, 1.00], 577: [1.28, 1.00],
    572: [1.26, 1.00], 578: [1.26, 1.00],
    585: [1.26, 1.00], 587: [1.26, 1.00],
    581: [1.26, 1.00],
    374: [1.30, 1.02], 376: [1.32, 1.04],
    377: [1.30, 1.02], 378: [1.32, 1.04],
    387: [1.40, 1.10], 382: [1.36, 1.08], 392: [1.36, 1.08],
    632: [1.38, 1.08], 633: [1.36, 1.08], 634: [1.36, 1.08],
    311: [1.30, 1.02], 707: [1.30, 1.02], 708: [1.30, 1.02],
    373: [1.32, 1.06],
  }
  const pair = baselines[leagueId] ?? [1.45, 1.18]
  return side === 'home' ? pair[0] : pair[1]
}