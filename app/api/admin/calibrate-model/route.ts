// app/api/admin/calibrate-model/route.ts
//
// Fits Platt scaling parameters from was_correct training data,
// saves them to model_calibration table, and returns a reliability report.
// Call this monthly (or whenever was_correct count crosses 50 new samples).

import { NextResponse } from 'next/server'
import { supabase } from '@/lib/supabase'
import { fitPlattScaling, setPlattParams } from '@/lib/drawEngine'
import { savePlattParams } from '@/lib/team-stats-cache'

interface ReliabilityBucket {
  scoreRange: string
  predicted: number   // avg draw_score in bucket
  actual: number      // actual hit rate in bucket
  count: number
  isCalibrated: boolean  // |predicted - actual| < 0.10
}

export async function POST() {
  try {
    // Fetch all evaluated predictions with their draw_score
    const { data: evaluated, error } = await supabase
      .from('predictions')
      .select('draw_score, was_correct, confidence')
      .not('was_correct', 'is', null)
      .order('draw_score', { ascending: true })

    if (error || !evaluated) {
      return NextResponse.json({ error: error?.message ?? 'Query failed' }, { status: 500 })
    }

    if (evaluated.length < 20) {
      return NextResponse.json({
        message: `Insufficient data for calibration (${evaluated.length} samples, need 20+)`,
        sampleCount: evaluated.length,
      })
    }

    // Fit Platt scaling
    const samples = evaluated.map((p) => ({
      drawScore: p.draw_score,
      wasCorrect: p.was_correct,
    }))
    const { a, b } = fitPlattScaling(samples)

    // Save to DB and update in-memory params
    await savePlattParams(a, b, evaluated.length)
    setPlattParams(a, b)

    console.log(`[calibration] Platt params fitted: a=${a}, b=${b} from ${evaluated.length} samples`)

    // Build reliability diagram (10 buckets by draw_score)
    const bucketSize = 1.0  // one bucket per score point 0–9
    const buckets: ReliabilityBucket[] = []

    for (let lo = 0; lo < 10; lo += bucketSize) {
      const hi = lo + bucketSize
      const inBucket = evaluated.filter(
        (p) => p.draw_score >= lo && p.draw_score < hi
      )
      if (inBucket.length < 3) continue

      const avgScore = inBucket.reduce((s, p) => s + p.draw_score, 0) / inBucket.length
      const hitRate  = inBucket.filter((p) => p.was_correct).length / inBucket.length

      // Map avg score to sigmoid-predicted probability
      const sigmoid = 1 / (1 + Math.exp(-(avgScore - 5) * 0.55))
      const predictedRate = 0.15 + sigmoid * 0.70  // same as confidence formula

      buckets.push({
        scoreRange:   `${lo.toFixed(0)}–${hi.toFixed(0)}`,
        predicted:    Math.round(predictedRate * 100) / 100,
        actual:       Math.round(hitRate * 100) / 100,
        count:        inBucket.length,
        isCalibrated: Math.abs(predictedRate - hitRate) < 0.10,
      })
    }

    // High-confidence breakdown
    const highConf = evaluated.filter((p) => p.confidence >= 70)
    const highConfHit = highConf.filter((p) => p.was_correct).length

    // Overall stats
    const totalCorrect = evaluated.filter((p) => p.was_correct).length
    const overallHitRate = totalCorrect / evaluated.length

    return NextResponse.json({
      success: true,
      plattA: a,
      plattB: b,
      sampleCount: evaluated.length,
      overallHitRate: Math.round(overallHitRate * 1000) / 10,
      highConfSamples: highConf.length,
      highConfHitRate: highConf.length > 0
        ? Math.round((highConfHit / highConf.length) * 1000) / 10
        : null,
      reliabilityBuckets: buckets,
      isWellCalibrated: buckets.filter((b) => b.isCalibrated).length >= buckets.length * 0.7,
    })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[calibrate-model] error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}