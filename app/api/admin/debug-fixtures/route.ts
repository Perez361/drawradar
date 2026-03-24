// app/api/admin/debug-fixtures/route.ts
//
// Diagnostic endpoint — shows exactly what the API returns and what gets
// filtered, so you can see where fixtures are being dropped.
// Only available in development.

import { NextResponse } from 'next/server'
import { fetchFixturesForDate, fetchOddsForFixture, LEAGUE_ID_TO_INFO } from '@/lib/api-football'

export async function GET() {
  if (process.env.NODE_ENV === 'production') {
    return NextResponse.json({ error: 'Not available in production' }, { status: 403 })
  }

  const apiKey = process.env.API_FOOTBALL_KEY
  if (!apiKey) {
    return NextResponse.json({ error: 'API_FOOTBALL_KEY not set' }, { status: 500 })
  }

  const now = new Date()
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  try {
    const allFixtures = await fetchFixturesForDate(apiKey, today)
    const tracked   = allFixtures.filter(f => LEAGUE_ID_TO_INFO[f.league.id])
    const untracked = allFixtures.filter(f => !LEAGUE_ID_TO_INFO[f.league.id])

    // Unique untracked leagues (for adding to LEAGUE_ID_TO_INFO)
    const untrackedLeaguesMap = new Map<number, { id: number; name: string; country: string; fixtureCount: number }>()
    for (const f of untracked) {
      const leagueId = f.league.id
      if (!untrackedLeaguesMap.has(leagueId)) {
        untrackedLeaguesMap.set(leagueId, {
          id: leagueId,
          name: f.league.name,
          country: f.league.country,
          fixtureCount: 0,
        })
      }
      untrackedLeaguesMap.get(leagueId)!.fixtureCount++
    }
    const untrackedLeagues = Array.from(untrackedLeaguesMap.values())

    // Country strings in tracked — lets you verify they match LEAGUE_ID_TO_INFO
    const apiCountryStrings = Array.from(new Set(tracked.map(f => f.league.country))).sort()
    const mapCountryStrings = Array.from(new Set(
      tracked.map(f => LEAGUE_ID_TO_INFO[f.league.id]?.country ?? 'MISSING')
    )).sort()

    // Sample odds check for first 3 tracked fixtures
    const oddsChecks: Array<{ fixtureId: number; home: string; away: string; drawOdds: number }> = []
    for (const f of tracked.slice(0, 3)) {
      const drawOdds = await fetchOddsForFixture(apiKey, f.fixture.id)
      oddsChecks.push({
        fixtureId: f.fixture.id,
        home: f.teams.home.name,
        away: f.teams.away.name,
        drawOdds,
      })
    }

    // Tracked league summary
    const trackedLeaguesMap = new Map<number, {
      id: number;
      apiName: string;
      apiCountry: string;
      mapName: string | undefined;
      mapCountry: string | undefined;
      countryMatch: boolean;
      fixtureCount: number;
    }>()
    for (const f of tracked) {
      const leagueId = f.league.id
      const info = LEAGUE_ID_TO_INFO[leagueId]
      if (!trackedLeaguesMap.has(leagueId)) {
        trackedLeaguesMap.set(leagueId, {
          id: leagueId,
          apiName: f.league.name,
          apiCountry: f.league.country,
          mapName: info?.name,
          mapCountry: info?.country,
          countryMatch: f.league.country === info?.country,
          fixtureCount: 0,
        })
      }
      trackedLeaguesMap.get(leagueId)!.fixtureCount++
    }
    const trackedLeagues = Array.from(trackedLeaguesMap.values())

    // Highlight country mismatches
    const countryMismatches = trackedLeagues.filter(l => !l.countryMatch)

    return NextResponse.json({
      date: today,
      summary: {
        totalFixtures: allFixtures.length,
        tracked: tracked.length,
        untracked: untracked.length,
        countryMismatches: countryMismatches.length,
      },
      countryMismatches,
      apiCountryStringsInTracked: apiCountryStrings,
      mapCountryStringsInTracked: mapCountryStrings,
      oddsCheckSample: oddsChecks,
      untrackedLeagues: untrackedLeagues
        .sort((a, b) => b.fixtureCount - a.fixtureCount)
        .slice(0, 20),
      trackedLeagues: trackedLeagues.slice(0, 20),
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[debug-fixtures]', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}