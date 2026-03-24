// app/api/model-accuracy/route.ts v3
//
// Changes over v2:
//   • unevaluated count is now date-scoped (last 90 days) rather than all-time,
//     preventing the count from growing unboundedly with historical seeded data.
//   • sweetSpotOdds range updated to 3.05–3.45 matching the engine v5 prime band.
//   • reliabilityBuckets now emit the sigmoid formula aligned with the new
//     drawEngine v5 scoring scale (0.60 steepness, not 0.55).
//   • perLeague filter lowered from ≥5 to ≥3 so small leagues appear sooner.
//   • Added per-feature correlation table: for each signal (real H2H, form,
//     odds sweet spot, fatigue) it now returns a counts + hit-rate breakdown
//     so the admin panel can spot which signals are actually predictive.

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // ── All evaluated predictions with match context ───────────────────────
    const { data: evaluated, error: err1 } = await supabase
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

    if (err1 || !evaluated) {
      return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }

    // ── Unevaluated count — last 90 days only ─────────────────────────────
    const cutoff90 = new Date()
    cutoff90.setDate(cutoff90.getDate() - 90)
    const { count: unevaluated } = await supabase
      .from('predictions')
      .select('*', { count: 'exact', head: true })
      .is('was_correct', null)
      .gte('prediction_date', cutoff90.toISOString().split('T')[0])

    // ── Latest calibration row ────────────────────────────────────────────
    const { data: calibrationRow } = await supabase
      .from('model_calibration')
      .select('platt_a, platt_b, sample_count, calibrated_at')
      .order('id', { ascending: false })
      .limit(1)
      .single()

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
    // Uses v5 sigmoid steepness (0.60) for predicted probability
    const reliabilityBuckets = []
    for (let lo = 0; lo < 10; lo++) {
      const inBucket = evaluated.filter(
        (p) => p.draw_score >= lo && p.draw_score < lo + 1
      )
      if (inBucket.length < 3) continue
      const bucketHit  = inBucket.filter((p) => p.was_correct).length
      // v5 sigmoid: steepness 0.60, midpoint 5
      const sigmoid    = 1 / (1 + Math.exp(-(lo + 0.5 - 5) * 0.60))
      const predicted  = 0.15 + sigmoid * 0.70  // maps to [15%, 85%]
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
      .filter(([, v]) => v.total >= 3)   // lowered from 5 → 3
      .map(([name, v]) => ({
        league:  name,
        hitRate: Math.round((v.correct / v.total) * 1000) / 10,
        count:   v.total,
      }))
      .sort((a, b) => b.hitRate - a.hitRate)

    // ── Signal impact ─────────────────────────────────────────────────────

    // H2H signal
    const withRealH2H = evaluated.filter((p) => (p.matches as any)?.h2h_is_real)
    const withEstH2H  = evaluated.filter((p) => !(p.matches as any)?.h2h_is_real)
    const realH2HHit  = withRealH2H.filter((p) => p.was_correct).length
    const estH2HHit   = withEstH2H.filter((p) => p.was_correct).length

    // Form signal
    const withForm    = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate !== null)
    const noForm      = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate === null)
    const formHit     = withForm.filter((p) => p.was_correct).length
    const noFormHit   = noForm.filter((p) => p.was_correct).length

    // Fatigue signal
    const withFatigue = evaluated.filter((p) => {
      const m = p.matches as any
      return m?.home_games_last14 !== null && m?.away_games_last14 !== null
    })
    const fatigueHighAvg = withFatigue.filter((p) => {
      const m = p.matches as any
      return ((m?.home_games_last14 ?? 0) + (m?.away_games_last14 ?? 0)) / 2 >= 3
    })
    const fatigueHit = fatigueHighAvg.filter((p) => p.was_correct).length

    // Odds sweet spot — updated to v5 prime band (3.05–3.45)
    const sweetSpot    = evaluated.filter(
      (p) => p.draw_odds >= 3.05 && p.draw_odds <= 3.45
    )
    const sweetHit     = sweetSpot.filter((p) => p.was_correct).length

    // Mid odds (2.75–3.05 and 3.45–3.75 combined)
    const midOdds      = evaluated.filter(
      (p) =>
        (p.draw_odds >= 2.75 && p.draw_odds < 3.05) ||
        (p.draw_odds > 3.45 && p.draw_odds <= 3.75)
    )
    const midOddsHit   = midOdds.filter((p) => p.was_correct).length

    // Team stats quality
    const withRealStats = evaluated.filter((p) => (p.matches as any)?.has_real_team_stats)
    const realStatsHit  = withRealStats.filter((p) => p.was_correct).length

    return NextResponse.json({
      // Core
      hitRate:         Math.round(hitRate * 100) / 100,
      highConfHitRate: Math.round(highConfHitRate * 100) / 100,
      totalEvaluated:  total,
      correct,
      highConfTotal:   highConf.length,
      highConfCorrect: highConfHit,
      unevaluated:     unevaluated ?? 0,

      // Calibration
      calibration: calibrationRow ? {
        plattA:       Number(calibrationRow.platt_a),
        plattB:       Number(calibrationRow.platt_b),
        sampleCount:  calibrationRow.sample_count,
        calibratedAt: calibrationRow.calibrated_at,
        isIdentity:
          Math.abs(Number(calibrationRow.platt_a) - (-1.0)) < 1e-4 &&
          Math.abs(Number(calibrationRow.platt_b) - 0.0)   < 1e-4,
      } : null,

      // Signal impact
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

      // Reliability & league breakdown
      reliabilityBuckets,
      perLeague,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}