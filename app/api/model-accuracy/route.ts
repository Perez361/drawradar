// app/api/model-accuracy/route.ts v2
//
// Extended accuracy report:
//   • Overall hit rate + high-conf hit rate (unchanged)
//   • Per-score-bucket reliability (for charting)
//   • Per-league hit rates (shows where model works best)
//   • H2H signal impact (real H2H vs blended estimate)
//   • Platt calibration status

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'

export async function GET() {
  try {
    // All evaluated predictions with their match data
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
          leagues ( name, country )
        )
      `)
      .not('was_correct', 'is', null)

    const { count: unevaluated } = await supabase
      .from('predictions')
      .select('*', { count: 'exact', head: true })
      .is('was_correct', null)

    const { data: calibrationRow } = await supabase
      .from('model_calibration')
      .select('platt_a, platt_b, sample_count, calibrated_at')
      .order('id', { ascending: false })
      .limit(1)
      .single()

    if (err1 || !evaluated) {
      return NextResponse.json({ error: 'Query failed' }, { status: 500 })
    }

    const total   = evaluated.length
    const correct = evaluated.filter((p) => p.was_correct).length
    const hitRate = total > 0 ? (correct / total) * 100 : 0

    // High-confidence (≥70%)
    const highConf = evaluated.filter((p) => p.confidence >= 70)
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
      const bucketHit = inBucket.filter((p) => p.was_correct).length
      const sigmoid = 1 / (1 + Math.exp(-(lo + 0.5 - 5) * 0.55))
      reliabilityBuckets.push({
        scoreRange: `${lo}–${lo + 1}`,
        count: inBucket.length,
        actualHitRate: Math.round((bucketHit / inBucket.length) * 1000) / 10,
        predictedHitRate: Math.round((0.15 + sigmoid * 0.70) * 1000) / 10,
      })
    }

    // ── Per-league breakdown ───────────────────────────────────────────────
    const leagueMap = new Map<string, { correct: number; total: number }>()
    for (const p of evaluated) {
      const match = p.matches as any
      const leagueName = match?.leagues?.name ?? 'Unknown'
      const country    = match?.leagues?.country ?? ''
      const key = `${leagueName} (${country})`
      const existing = leagueMap.get(key) ?? { correct: 0, total: 0 }
      leagueMap.set(key, {
        correct: existing.correct + (p.was_correct ? 1 : 0),
        total:   existing.total + 1,
      })
    }
    const perLeague = Array.from(leagueMap.entries())
      .filter(([, v]) => v.total >= 5)
      .map(([name, v]) => ({
        league: name,
        hitRate: Math.round((v.correct / v.total) * 1000) / 10,
        count: v.total,
      }))
      .sort((a, b) => b.hitRate - a.hitRate)

    // ── H2H signal impact ─────────────────────────────────────────────────
    const withRealH2H = evaluated.filter((p) => (p.matches as any)?.h2h_is_real)
    const withEstH2H  = evaluated.filter((p) => !(p.matches as any)?.h2h_is_real)
    const realH2HHit  = withRealH2H.filter((p) => p.was_correct).length
    const estH2HHit   = withEstH2H.filter((p) => p.was_correct).length

    // ── Form signal impact ────────────────────────────────────────────────
    const withForm  = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate !== null)
    const noForm    = evaluated.filter((p) => (p.matches as any)?.home_form_draw_rate === null)
    const formHit   = withForm.filter((p) => p.was_correct).length
    const noFormHit = noForm.filter((p) => p.was_correct).length

    // ── Odds sweet spot accuracy ──────────────────────────────────────────
    const sweetSpot = evaluated.filter(
      (p) => p.draw_odds >= 3.0 && p.draw_odds <= 3.4
    )
    const sweetHit = sweetSpot.filter((p) => p.was_correct).length

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
        isIdentity:   Number(calibrationRow.platt_a) === -1.0 && Number(calibrationRow.platt_b) === 0.0,
      } : null,

      // Signal impact
      signalImpact: {
        realH2H: {
          count:   withRealH2H.length,
          hitRate: withRealH2H.length > 0 ? Math.round((realH2HHit / withRealH2H.length) * 1000) / 10 : null,
        },
        estimatedH2H: {
          count:   withEstH2H.length,
          hitRate: withEstH2H.length > 0 ? Math.round((estH2HHit  / withEstH2H.length)  * 1000) / 10 : null,
        },
        withForm: {
          count:   withForm.length,
          hitRate: withForm.length > 0 ? Math.round((formHit   / withForm.length)   * 1000) / 10 : null,
        },
        withoutForm: {
          count:   noForm.length,
          hitRate: noForm.length > 0   ? Math.round((noFormHit / noForm.length)     * 1000) / 10 : null,
        },
        sweetSpotOdds: {
          range:   '3.0–3.4',
          count:   sweetSpot.length,
          hitRate: sweetSpot.length > 0 ? Math.round((sweetHit / sweetSpot.length) * 1000) / 10 : null,
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