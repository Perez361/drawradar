// app/api/model-accuracy/route.ts v4
//
// Changes over v3:
//   • All Supabase reads now use supabaseAdmin (service role key) instead of
//     the anon client. This fixes silent empty results when RLS is enabled on
//     predictions / matches / model_calibration tables.
//   • unevaluated count uses supabaseAdmin too for the same reason.
//   • Added error detail logging so failures are visible in server logs.
//   • perLeague filter kept at ≥3 minimum count.
//   • sweetSpotOdds range kept at 3.05–3.45 matching engine v5.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function GET() {
  try {
    // ── All evaluated predictions with match context ───────────────────────
    const { data: evaluated, error: err1 } = await supabaseAdmin
      .from('predictions')
      .select(`
        id,
        was_correct,
        confidence,
        draw_score,
        draw_odds,
        matches (
          h2h_is_real,
          has_real_team_stats,
          home_form_draw_rate,
          away_form_draw_rate,
          home_games_last14,
          away_games_last14,
          leagues ( name, country )
        )
      `)
      .not('was_correct', 'is', null)

    if (err1) {
      console.error('[model-accuracy] predictions query failed:', err1.message)
      return NextResponse.json({ error: err1.message }, { status: 500 })
    }

    if (!evaluated) {
      return NextResponse.json({ error: 'No data returned' }, { status: 500 })
    }

    // ── Unevaluated count — last 90 days only ─────────────────────────────
    const cutoff90 = new Date()
    cutoff90.setDate(cutoff90.getDate() - 90)

    const { count: unevaluated, error: err2 } = await supabaseAdmin
      .from('predictions')
      .select('*', { count: 'exact', head: true })
      .is('was_correct', null)
      .gte('prediction_date', cutoff90.toISOString().split('T')[0])

    if (err2) {
      console.warn('[model-accuracy] unevaluated count failed:', err2.message)
    }

    // ── Latest calibration row ────────────────────────────────────────────
    const { data: calibrationRow, error: err3 } = await supabaseAdmin
      .from('model_calibration')
      .select('platt_a, platt_b, sample_count, calibrated_at')
      .order('id', { ascending: false })
      .limit(1)
      .single()

    if (err3 && err3.code !== 'PGRST116') {
      // PGRST116 = no rows found, that's fine — just means not calibrated yet
      console.warn('[model-accuracy] calibration row fetch failed:', err3.message)
    }

    const total   = evaluated.length
    const correct = evaluated.filter((p) => p.was_correct).length
    const hitRate = total > 0 ? (correct / total) * 100 : 0

    // ── High-confidence breakdown (≥70%) ─────────────────────────────────
    const highConf    = evaluated.filter((p) => p.confidence >= 70)
    const highConfHit = highConf.filter((p) => p.was_correct).length
    const highConfHitRate = highConf.length > 0
      ? (highConfHit / highConf.length) * 100
      : 0

    // ── Reliability buckets (score 0–10, 1-point buckets) ─────────────────
    const reliabilityBuckets = []
    for (let lo = 0; lo < 10; lo++) {
      const inBucket = evaluated.filter(
        (p) => p.draw_score >= lo && p.draw_score < lo + 1
      )
      if (inBucket.length < 3) continue
      const bucketHit  = inBucket.filter((p) => p.was_correct).length
      const sigmoid    = 1 / (1 + Math.exp(-(lo + 0.5 - 5) * 0.60))
      const predicted  = 0.15 + sigmoid * 0.70
      reliabilityBuckets.push({
        scoreRange:       `${lo}–${lo + 1}`,
        count:            inBucket.length,
        actualHitRate:    Math.round((bucketHit / inBucket.length) * 1000) / 10,
        predictedHitRate: Math.round(predicted * 1000) / 10,
      })
    }

    // ── Per-league breakdown ──────────────────────────────────────────────
    const leagueMap = new Map<string, { correct: number; total: number }>()
    for (const p of evaluated) {
      const match      = p.matches as any
      const leagueName = match?.leagues?.name    ?? 'Unknown'
      const country    = match?.leagues?.country ?? ''
      const key        = `${leagueName} (${country})`
      const existing   = leagueMap.get(key) ?? { correct: 0, total: 0 }
      leagueMap.set(key, {
        correct: existing.correct + (p.was_correct ? 1 : 0),
        total:   existing.total + 1,
      })
    }
    const perLeague = Array.from(leagueMap.entries())
      .filter(([, v]) => v.total >= 3)
      .map(([name, v]) => ({
        league:  name,
        hitRate: Math.round((v.correct / v.total) * 1000) / 10,
        count:   v.total,
      }))
      .sort((a, b) => b.hitRate - a.hitRate)

    // ── Signal impact ─────────────────────────────────────────────────────

    const withRealH2H = evaluated.filter((p) => (p.matches as any)?.h2h_is_real)
    const withEstH2H  = evaluated.filter((p) => !(p.matches as any)?.h2h_is_real)
    const realH2HHit  = withRealH2H.filter((p) => p.was_correct).length
    const estH2HHit   = withEstH2H.filter((p) => p.was_correct).length

    const withForm    = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate !== null)
    const noForm      = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate === null)
    const formHit     = withForm.filter((p) => p.was_correct).length
    const noFormHit   = noForm.filter((p) => p.was_correct).length

    const withFatigue = evaluated.filter((p) => {
      const m = p.matches as any
      return m?.home_games_last14 !== null && m?.away_games_last14 !== null
    })
    const fatigueHighAvg = withFatigue.filter((p) => {
      const m = p.matches as any
      return ((m?.home_games_last14 ?? 0) + (m?.away_games_last14 ?? 0)) / 2 >= 3
    })
    const fatigueHit = fatigueHighAvg.filter((p) => p.was_correct).length

    const sweetSpot    = evaluated.filter(
      (p) => p.draw_odds >= 3.05 && p.draw_odds <= 3.45
    )
    const sweetHit     = sweetSpot.filter((p) => p.was_correct).length

    const midOdds      = evaluated.filter(
      (p) =>
        (p.draw_odds >= 2.75 && p.draw_odds < 3.05) ||
        (p.draw_odds > 3.45 && p.draw_odds <= 3.75)
    )
    const midOddsHit   = midOdds.filter((p) => p.was_correct).length

    const withRealStats = evaluated.filter((p) => (p.matches as any)?.has_real_team_stats)
    const realStatsHit  = withRealStats.filter((p) => p.was_correct).length

    return NextResponse.json({
      hitRate:         Math.round(hitRate * 100) / 100,
      highConfHitRate: Math.round(highConfHitRate * 100) / 100,
      totalEvaluated:  total,
      correct,
      highConfTotal:   highConf.length,
      highConfCorrect: highConfHit,
      unevaluated:     unevaluated ?? 0,

      calibration: calibrationRow ? {
        plattA:       Number(calibrationRow.platt_a),
        plattB:       Number(calibrationRow.platt_b),
        sampleCount:  calibrationRow.sample_count,
        calibratedAt: calibrationRow.calibrated_at,
        isIdentity:
          Math.abs(Number(calibrationRow.platt_a) - (-1.0)) < 1e-4 &&
          Math.abs(Number(calibrationRow.platt_b) - 0.0)   < 1e-4,
      } : null,

      signalImpact: {
        realH2H: {
          count:   withRealH2H.length,
          hitRate: withRealH2H.length > 0
            ? Math.round((realH2HHit / withRealH2H.length) * 1000) / 10
            : null,
        },
        estimatedH2H: {
          count:   withEstH2H.length,
          hitRate: withEstH2H.length > 0
            ? Math.round((estH2HHit / withEstH2H.length) * 1000) / 10
            : null,
        },
        withForm: {
          count:   withForm.length,
          hitRate: withForm.length > 0
            ? Math.round((formHit / withForm.length) * 1000) / 10
            : null,
        },
        withoutForm: {
          count:   noForm.length,
          hitRate: noForm.length > 0
            ? Math.round((noFormHit / noForm.length) * 1000) / 10
            : null,
        },
        fatigueHigh: {
          count:   fatigueHighAvg.length,
          hitRate: fatigueHighAvg.length > 0
            ? Math.round((fatigueHit / fatigueHighAvg.length) * 1000) / 10
            : null,
          label: 'Avg ≥3 games/14d',
        },
        sweetSpotOdds: {
          range:   '3.05–3.45',
          count:   sweetSpot.length,
          hitRate: sweetSpot.length > 0
            ? Math.round((sweetHit / sweetSpot.length) * 1000) / 10
            : null,
        },
        midRangeOdds: {
          range:   '2.75–3.05 | 3.45–3.75',
          count:   midOdds.length,
          hitRate: midOdds.length > 0
            ? Math.round((midOddsHit / midOdds.length) * 1000) / 10
            : null,
        },
        realTeamStats: {
          count:   withRealStats.length,
          hitRate: withRealStats.length > 0
            ? Math.round((realStatsHit / withRealStats.length) * 1000) / 10
            : null,
        },
      },

      reliabilityBuckets,
      perLeague,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[model-accuracy] unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}