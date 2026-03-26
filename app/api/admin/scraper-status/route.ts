// app/api/admin/scraper-status/route.ts
//
// Returns latest run status for each scraper source.
// Powers the admin dashboard scraper health panel.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    // Latest run per source/type
    const { data: runs, error } = await supabaseAdmin
      .from('scraper_runs')
      .select('*')
      .order('started_at', { ascending: false })
      .limit(50)

    if (error) return NextResponse.json({ error: error.message }, { status: 500 })

    // Deduplicate: latest per source+run_type
    const seen = new Set<string>()
    const latest = (runs ?? []).filter(r => {
      const key = `${r.source}:${r.run_type}`
      if (seen.has(key)) return false
      seen.add(key)
      return true
    })

    // Raw xG coverage stats
    const { count: xgCount } = await supabaseAdmin
      .from('raw_xg_data')
      .select('*', { count: 'exact', head: true })

    const { count: linkedXg } = await supabaseAdmin
      .from('raw_xg_data')
      .select('*', { count: 'exact', head: true })
      .not('matched_match_id', 'is', null)

    // Odds snapshot count
    const { count: snapshotCount } = await supabaseAdmin
      .from('raw_odds_snapshots')
      .select('*', { count: 'exact', head: true })

    // Matches with real xG
    const { count: matchesWithXg } = await supabaseAdmin
      .from('matches')
      .select('*', { count: 'exact', head: true })
      .gt('xg_home', 0)

    return NextResponse.json({
      scraperRuns: latest,
      stats: {
        rawXgTotal: xgCount ?? 0,
        rawXgLinked: linkedXg ?? 0,
        oddsSnapshots: snapshotCount ?? 0,
        matchesWithXg: matchesWithXg ?? 0,
      },
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}