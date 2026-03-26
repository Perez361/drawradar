// app/api/admin/scrape-xg/route.ts
//
// Fetches xG data from Understat (top 5 leagues) and FBref (extra leagues).
// Understat embeds JSON in <script> tags — no JS challenge, no key needed.
// FBref is static HTML — cheerio parse, 3s polite delay between pages.
//
// Writes to: raw_xg_data (source of truth)
// Updates:   matches.xg_home / xg_away where match can be linked by date + team names
//
// Called by: Vercel cron at 06:00 UTC (before main pipeline)
// Also callable from admin panel for manual refresh.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

// ─── Config ──────────────────────────────────────────────────────────────────

const UNDERSTAT_LEAGUES: Record<string, string> = {
  'Premier League': 'https://understat.com/league/EPL/2024',
  'La Liga':        'https://understat.com/league/La_liga/2024',
  'Serie A':        'https://understat.com/league/Serie_A/2024',
  'Bundesliga':     'https://understat.com/league/Bundesliga/2024',
  'Ligue 1':        'https://understat.com/league/Ligue_1/2024',
}

// FBref: extra leagues not on Understat
const FBREF_LEAGUES: Record<string, string> = {
  'Primeira Liga': 'https://fbref.com/en/comps/32/schedule/Primeira-Liga-Scores-and-Fixtures',
  'Eredivisie':    'https://fbref.com/en/comps/23/schedule/Eredivisie-Scores-and-Fixtures',
  'Süper Lig':     'https://fbref.com/en/comps/26/schedule/Super-Lig-Scores-and-Fixtures',
  'Liga Profesional Argentina': 'https://fbref.com/en/comps/21/schedule/Liga-Profesional-Scores-and-Fixtures',
  'Brazil Serie A':    'https://fbref.com/en/comps/24/schedule/Brazil-Serie-A-Scores-and-Fixtures',
  'Liga de Primera': 'https://fbref.com/en/comps/35/schedule/Liga-de-Primera-Scores-and-Fixtures',
  'Primera A': 'https://fbref.com/en/comps/35/schedule/Liga-de-Primera-Scores-and-Fixtures',
  'Ecuadorian Serie A': 'https://fbref.com/en/comps/58/schedule/Ecuadorian-Serie-A-Scores-and-Fixtures',

}

const USER_AGENTS = [
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
]
let uaIdx = 0
const nextUA = () => USER_AGENTS[uaIdx++ % USER_AGENTS.length]

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

// ─── HTTP helpers ─────────────────────────────────────────────────────────────

async function politeGet(url: string, retries = 3): Promise<string | null> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      const resp = await fetch(url, {
        headers: {
          'User-Agent': nextUA(),
          'Accept': 'text/html,application/xhtml+xml,*/*;q=0.8',
          'Accept-Language': 'en-US,en;q=0.9',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
      })
      if (resp.status === 429) { await sleep(60_000 * attempt); continue }
      if (!resp.ok) { console.warn(`[xg] HTTP ${resp.status} for ${url}`); return null }
      return resp.text()
    } catch (err) {
      console.warn(`[xg] attempt ${attempt} failed for ${url}:`, err)
      if (attempt < retries) await sleep(5_000 * attempt)
    }
  }
  return null
}

// ─── Team name fuzzy matching ─────────────────────────────────────────────────

function normalizeTeam(name: string): string {
  return name.toLowerCase()
    .replace(/\bfc\b|\bafc\b|\bcf\b|\bsc\b|\bsk\b|\bfk\b|\bac\b|\bas\b|\bsv\b/g, '')
    .replace(/[^\w\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function bigramSim(a: string, b: string): number {
  if (a === b) return 1
  if (a.length < 2 || b.length < 2) return 0
  const bigrams = (s: string) => {
    const set = new Set<string>()
    for (let i = 0; i < s.length - 1; i++) set.add(s.slice(i, i + 2))
    return set
  }
  const sa = bigrams(a), sb = bigrams(b)
  let inter = 0
  for (const bi of sa) if (sb.has(bi)) inter++
  return (2 * inter) / (sa.size + sb.size)
}

function fuzzyMatch(nameA: string, nameB: string): number {
  return bigramSim(normalizeTeam(nameA), normalizeTeam(nameB))
}

// ─── Link raw xG to existing match in DB ─────────────────────────────────────

async function linkToMatch(
  homeName: string, awayName: string, dateStr: string
): Promise<number | null> {
  const dateFrom = new Date(dateStr); dateFrom.setHours(0, 0, 0, 0)
  const dateTo   = new Date(dateStr); dateTo.setHours(23, 59, 59, 999)

  const { data: candidates } = await supabaseAdmin
    .from('matches')
    .select('id, home_team_name, away_team_name')
    .gte('match_date', dateFrom.toISOString())
    .lte('match_date', dateTo.toISOString())

  if (!candidates?.length) return null

  for (const c of candidates) {
    if (fuzzyMatch(homeName, c.home_team_name) > 0.75 &&
        fuzzyMatch(awayName, c.away_team_name) > 0.75) return c.id
  }
  return null
}

// ─── Understat scraper ────────────────────────────────────────────────────────

function extractUnderstatJson(html: string, varName: string): any[] | null {
  const regex = new RegExp(`var ${varName}\\s*=\\s*JSON\\.parse\\('(.*?)'\\)`, 's')
  const match = html.match(regex)
  if (!match) return null
  try {
    const raw = match[1]
      .replace(/\\x([0-9A-Fa-f]{2})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\u([0-9A-Fa-f]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16)))
      .replace(/\\"/g, '"').replace(/\\\\/g, '\\')
    return JSON.parse(raw)
  } catch { return null }
}

async function scrapeUnderstat(): Promise<number> {
  let total = 0
  for (const [leagueName, url] of Object.entries(UNDERSTAT_LEAGUES)) {
    console.log(`[understat] ${leagueName}`)
    const html = await politeGet(url)
    if (!html) continue

    const matches = extractUnderstatJson(html, 'datesData')
    if (!matches) { console.warn(`[understat] No datesData for ${leagueName}`); continue }

    for (const m of matches) {
      if (m.isResult !== '1') continue

      const xgHome  = parseFloat(m.xG?.h ?? 0)
      const xgAway  = parseFloat(m.xG?.a ?? 0)
      const dateStr = m.datetime?.split(' ')[0]
      if (!dateStr) continue

      const matchId = await linkToMatch(m.h?.title ?? '', m.a?.title ?? '', dateStr)

      const row = {
        source: 'understat',
        home_team_name: m.h?.title ?? '',
        away_team_name: m.a?.title ?? '',
        match_date: dateStr,
        league_name: leagueName,
        xg_home: xgHome,
        xg_away: xgAway,
        goals_home: parseInt(m.goals?.h ?? 0),
        goals_away: parseInt(m.goals?.a ?? 0),
        matched_match_id: matchId,
      }

      const { error } = await supabaseAdmin
        .from('raw_xg_data')
        .upsert(row, { onConflict: 'source,home_team_name,away_team_name,match_date' })

      if (!error) {
        total++
        if (matchId) {
          await supabaseAdmin
            .from('matches')
            .update({ xg_home: xgHome, xg_away: xgAway })
            .eq('id', matchId)
        }
      }
    }
    await sleep(2_000)
  }
  return total
}

// ─── FBref scraper ────────────────────────────────────────────────────────────

async function scrapeFBref(): Promise<number> {
  let total = 0

  for (const [leagueName, url] of Object.entries(FBREF_LEAGUES)) {
    console.log(`[fbref] ${leagueName}`)
    const html = await politeGet(url)
    if (!html) continue

    // Parse schedule table rows — FBref uses data-stat attributes
    const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/g
    let rowMatch: RegExpExecArray | null
    const rows: Array<{
      homeName: string; awayName: string; dateStr: string
      xgHome: number | null; xgAway: number | null
      goalsHome: number | null; goalsAway: number | null
    }> = []

    while ((rowMatch = rowRegex.exec(html)) !== null) {
      const row = rowMatch[1]

      const getCell = (stat: string) => {
        const m = row.match(new RegExp(`data-stat="${stat}"[^>]*>(<a[^>]*>)?([^<]*)<`))
        return m ? m[2].trim() : ''
      }

      const dateStr  = getCell('date')
      const homeTeam = getCell('home_team')
      const awayTeam = getCell('away_team')
      const score    = getCell('score')
      const xgH      = getCell('home_xg')
      const xgA      = getCell('away_xg')

      if (!homeTeam || !awayTeam || !dateStr || !score || !/\d/.test(score)) continue

      const [gh, ga] = score.split('–').map(s => parseInt(s.trim()))
      rows.push({
        homeName: homeTeam, awayName: awayTeam, dateStr,
        xgHome: xgH ? parseFloat(xgH) : null,
        xgAway: xgA ? parseFloat(xgA) : null,
        goalsHome: isNaN(gh) ? null : gh,
        goalsAway: isNaN(ga) ? null : ga,
      })
    }

    console.log(`[fbref] ${leagueName}: ${rows.length} completed matches`)

    for (const r of rows) {
      const matchId = await linkToMatch(r.homeName, r.awayName, r.dateStr)

      const { error } = await supabaseAdmin
        .from('raw_xg_data')
        .upsert({
          source: 'fbref',
          home_team_name: r.homeName,
          away_team_name: r.awayName,
          match_date: r.dateStr,
          league_name: leagueName,
          xg_home: r.xgHome,
          xg_away: r.xgAway,
          goals_home: r.goalsHome,
          goals_away: r.goalsAway,
          matched_match_id: matchId,
        }, { onConflict: 'source,home_team_name,away_team_name,match_date' })

      if (!error) {
        total++
        if (matchId && r.xgHome !== null) {
          // Only fill in xG if not already set by Understat (higher quality)
          await supabaseAdmin
            .from('matches')
            .update({ xg_home: r.xgHome, xg_away: r.xgAway })
            .eq('id', matchId)
            .eq('xg_home', 0)
        }
      }
    }

    await sleep(3_000) // polite delay between FBref pages
  }
  return total
}

// ─── Scraper run logger ───────────────────────────────────────────────────────

async function logRun(
  source: string, runType: string, status: string,
  count = 0, error: string | null = null, id: number | null = null
): Promise<number> {
  if (id) {
    await supabaseAdmin.from('scraper_runs').update({
      status, records_upserted: count, error_message: error,
      finished_at: new Date().toISOString(),
    }).eq('id', id)
    return id
  }
  const { data } = await supabaseAdmin
    .from('scraper_runs')
    .insert({ source, run_type: runType, status })
    .select('id').single()
  return data?.id ?? 0
}

// ─── Main handler ─────────────────────────────────────────────────────────────

async function runXgScraper(): Promise<NextResponse> {
  const results: Record<string, number> = {}
  let totalErrors = 0

  // Understat
  const us_id = await logRun('understat', 'xg', 'running')
  try {
    const count = await scrapeUnderstat()
    results.understat = count
    await logRun('understat', 'xg', 'done', count, null, us_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[scrape-xg] understat error:', msg)
    await logRun('understat', 'xg', 'error', 0, msg, us_id)
    totalErrors++
  }

  // FBref
  const fb_id = await logRun('fbref', 'xg', 'running')
  try {
    const count = await scrapeFBref()
    results.fbref = count
    await logRun('fbref', 'xg', 'done', count, null, fb_id)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[scrape-xg] fbref error:', msg)
    await logRun('fbref', 'xg', 'error', 0, msg, fb_id)
    totalErrors++
  }

  return NextResponse.json({
    success: totalErrors === 0,
    results,
    totalRecords: Object.values(results).reduce((a, b) => a + b, 0),
    errors: totalErrors,
  })
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runXgScraper()
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runXgScraper()
}