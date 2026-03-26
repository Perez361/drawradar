// app/api/admin/scrape-odds-snapshot/route.ts
//
// Snapshots current draw odds from The-Odds-API into raw_odds_snapshots.
// This lets you track line movement over time (opening vs current odds).
//
// Already called indirectly via allsports-fixtures which sets odds_open.
// This route adds granular per-bookmaker snapshots every 4 hours.
//
// Cron: every 4 hours to catch line movement before kick-off.

import { NextRequest, NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

const BASE_URL = 'https://api.the-odds-api.com/v4'

// Same sport keys as your existing odds-api.ts
const SPORT_KEYS = [
  'soccer_epl',
  'soccer_spain_la_liga',
  'soccer_italy_serie_a',
  'soccer_germany_bundesliga',
  'soccer_france_ligue_one',
  'soccer_netherlands_eredivisie',
  'soccer_portugal_primeira_liga',
  'soccer_turkey_super_league',
]

// Sharp bookmakers to track for line movement signal
const BOOKMAKERS = 'pinnacle,betfair_ex_eu,williamhill,bet365,unibet'

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

async function runOddsSnapshot(): Promise<NextResponse> {
  const apiKey = process.env.ODDS_API_KEY
  if (!apiKey) return NextResponse.json({ error: 'ODDS_API_KEY not set' }, { status: 500 })

  const runId = await logRun('odds_api', 'odds_snapshot', 'running')
  let totalSnapshots = 0
  const now = new Date().toISOString()

  try {
    for (const sportKey of SPORT_KEYS) {
      const url = new URL(`${BASE_URL}/sports/${sportKey}/odds`)
      url.searchParams.set('apiKey', apiKey)
      url.searchParams.set('regions', 'eu,uk')
      url.searchParams.set('markets', 'h2h')
      url.searchParams.set('oddsFormat', 'decimal')
      url.searchParams.set('bookmakers', BOOKMAKERS)

      let events: any[]
      try {
        const resp = await fetch(url.toString(), { cache: 'no-store' })
        const remaining = resp.headers.get('x-requests-remaining')
        console.log(`[odds-snapshot] ${sportKey} — remaining quota: ${remaining}`)
        if (resp.status === 422) { events = []; continue } // sport inactive
        if (!resp.ok) {
          console.warn(`[odds-snapshot] HTTP ${resp.status} for ${sportKey}`)
          continue
        }
        events = await resp.json()
      } catch (err) {
        console.warn(`[odds-snapshot] fetch error for ${sportKey}:`, err)
        continue
      }

      for (const event of events) {
        // Check if this match exists in our DB
        const { data: match } = await supabaseAdmin
          .from('matches')
          .select('id, odds_open, draw_odds')
          .eq('external_id', event.id)
          .maybeSingle()

        const snapshots: any[] = []
        let bestDraw: number | null = null
        let bestHome: number | null = null
        let bestAway: number | null = null

        for (const bm of event.bookmakers ?? []) {
          const h2h = bm.markets?.find((m: any) => m.key === 'h2h')
          if (!h2h) continue

          const home = h2h.outcomes.find((o: any) => o.name === event.home_team)?.price
          const away = h2h.outcomes.find((o: any) => o.name === event.away_team)?.price
          const draw = h2h.outcomes.find((o: any) => o.name === 'Draw')?.price

          if (draw) {
            snapshots.push({
              match_external_id: event.id,
              bookmaker: bm.key,
              home_odds: home ?? null,
              draw_odds: draw,
              away_odds: away ?? null,
              snapshotted_at: now,
            })
            if (!bestDraw || draw > bestDraw) {
              bestDraw = draw; bestHome = home; bestAway = away
            }
          }
        }

        // Upsert the match with updated odds + movement tracking
        if (match && bestDraw) {
          const oddsOpen = match.odds_open ?? bestDraw
          const movement = oddsOpen
            ? parseFloat(((bestDraw - oddsOpen) / oddsOpen * 100).toFixed(2))
            : null

          await supabaseAdmin.from('matches').update({
            draw_odds: bestDraw,
            odds_open: match.odds_open ?? bestDraw,
            odds_movement: movement,
          }).eq('id', match.id)
        } else if (!match && bestDraw) {
          // Stub entry for tracking
          await supabaseAdmin.from('matches').upsert({
            external_id: event.id,
            home_team_name: event.home_team,
            away_team_name: event.away_team,
            match_date: new Date(event.commence_time).toISOString(),
            draw_odds: bestDraw,
            odds_open: bestDraw,
            status: 'scheduled',
          }, { onConflict: 'external_id', ignoreDuplicates: false })
        }

        // Bulk insert snapshots
        if (snapshots.length) {
          const { error } = await supabaseAdmin
            .from('raw_odds_snapshots')
            .insert(snapshots)
          if (!error) totalSnapshots += snapshots.length
        }
      }
    }

    await logRun('odds_api', 'odds_snapshot', 'done', totalSnapshots, null, runId)
    return NextResponse.json({ success: true, snapshots: totalSnapshots })

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    await logRun('odds_api', 'odds_snapshot', 'error', 0, msg, runId)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}

export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }
  return runOddsSnapshot()
}

export async function POST(req: NextRequest) {
  if (req.headers.get('authorization') !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }
  return runOddsSnapshot()
}