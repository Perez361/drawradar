// ─── Draw Engine v4 ───────────────────────────────────────────────────────────
//
// Fixes over v3:
//   • Platt identity (a=-1, b=0) was WRONG — plattScale(0.5) = 0.38, not 0.5
//     Now: when uncalibrated, skip Platt entirely and use pure sigmoid
//   • Confidence formula simplified — no more confusing 70/30 blend pre-calibration
//   • lineMovementScore now actually fires (opening odds now preserved correctly
//     in trigger-predictions/route.ts fix)

// ─── Poisson helpers ──────────────────────────────────────────────────────────

function factorial(n: number): number {
  if (n <= 1) return 1
  if (n > 20) return 2.432902e18
  return n * factorial(n - 1)
}

function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k)
}

export function poissonDrawProbability(xgHome: number, xgAway: number): number {
  let prob = 0
  const maxGoals = Math.min(8, Math.ceil(Math.max(xgHome, xgAway) * 2.5 + 3))
  for (let k = 0; k <= maxGoals; k++) {
    prob += poisson(xgHome, k) * poisson(xgAway, k)
  }
  return Math.min(prob, 0.99)
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DrawFeatures {
  // Core xG model
  xgHome: number
  xgAway: number
  // Team stats
  homeGoalsAvg: number
  awayGoalsAvg: number
  homeConcedeAvg: number
  awayConcedeAvg: number
  // Draw history
  homeDrawRate: number
  awayDrawRate: number
  h2hDrawRate: number
  h2hIsReal: boolean
  // Market
  drawOdds: number
  homeOdds: number
  awayOdds: number
  oddsOpenDraw?: number
  oddsMovement?: number
  // Form
  homeFormDrawRate?: number
  awayFormDrawRate?: number
  homeFormGoalsAvg?: number
  awayFormGoalsAvg?: number
  // Fatigue
  homeGamesLast14?: number
  awayGamesLast14?: number
  // League context
  leagueAvgDrawRate: number
  leagueDrawBoost?: number
}

export interface DrawPrediction {
  poissonProb: number
  probability: number
  drawScore: number
  confidence: number
  edge: number
  breakdown: DrawBreakdown
}

export interface DrawBreakdown {
  poissonScore: number
  parityScore: number
  formScore: number
  h2hScore: number
  oddsScore: number
  fatigueScore: number
  lineMovementScore: number
  leagueScore: number
}

// ─── Platt scaling ────────────────────────────────────────────────────────────
// IMPORTANT: Default a=-1.0, b=0.0 is NOT the identity function.
// plattScale(x) = 1/(1+exp(-1*x+0)) = sigmoid(x) which is NOT x.
// We handle this by checking isCalibrated before using Platt at all.

let PLATT_A = -1.0
let PLATT_B = 0.0

export function setPlattParams(a: number, b: number) {
  PLATT_A = a
  PLATT_B = b
}

// True when user has run calibration with real was_correct data
function isCalibrated(): boolean {
  return !(PLATT_A === -1.0 && PLATT_B === 0.0)
}

function plattScale(rawScore: number): number {
  return 1 / (1 + Math.exp(PLATT_A * rawScore + PLATT_B))
}

// ─── Core scoring ─────────────────────────────────────────────────────────────

export function predictDraw(f: DrawFeatures): DrawPrediction {
  // ── 1. Poisson component ──────────────────────────────────────────────────
  const poissonProb = poissonDrawProbability(f.xgHome, f.xgAway)
  const poissonScore = poissonProb * 10

  // ── 2. Team parity ────────────────────────────────────────────────────────
  const goalsDiff = Math.abs(f.homeGoalsAvg - f.awayGoalsAvg)
  const parityScore = 2.0 * Math.exp(-goalsDiff / 0.25)

  // xG balance sub-component
  const xgDiff = Math.abs(f.xgHome - f.xgAway)
  const xgBalanceScore = 1.0 * Math.exp(-xgDiff / 0.3)

  // ── 3. Low-scoring tendency ───────────────────────────────────────────────
  const totalGoals = f.homeGoalsAvg + f.awayGoalsAvg
  const lowScoringScore = 2.0 * Math.exp(-totalGoals / 2.8)

  // ── 4. H2H draw rate — real data weighted higher ──────────────────────────
  const h2hWeight = f.h2hIsReal ? 1.0 : 0.4
  const h2hBase = (f.h2hDrawRate - 0.25) / 0.15
  const h2hScore = h2hWeight * Math.max(0, Math.min(1.5, h2hBase))

  // ── 5. Historical draw rates — per-team ───────────────────────────────────
  const teamDrawAvg = (f.homeDrawRate + f.awayDrawRate) / 2
  const teamDrawScore = 2.0 * Math.max(0, (teamDrawAvg - 0.22) / 0.18)

  // ── 6. Form streak ─────────────────────────────────────────────────────────
  let formScore = 0
  if (f.homeFormDrawRate !== undefined && f.awayFormDrawRate !== undefined) {
    const formDrawAvg = (f.homeFormDrawRate + f.awayFormDrawRate) / 2
    formScore = 1.5 * Math.max(0, (formDrawAvg - 0.20) / 0.25)
  }
  if (f.homeFormGoalsAvg !== undefined && f.awayFormGoalsAvg !== undefined) {
    const formGoals = f.homeFormGoalsAvg + f.awayFormGoalsAvg
    formScore += 0.5 * Math.exp(-formGoals / 2.5)
  }

  // ── 7. Draw odds sweet spot ───────────────────────────────────────────────
  const impliedProb = 1 / f.drawOdds
  const oddsScore = (() => {
    if (f.drawOdds >= 3.0 && f.drawOdds <= 3.4) return 2.0
    if (f.drawOdds >= 2.8 && f.drawOdds < 3.0)  return 1.4
    if (f.drawOdds > 3.4 && f.drawOdds <= 3.7)  return 1.0
    if (f.drawOdds > 3.7 && f.drawOdds <= 4.0)  return 0.4
    return 0
  })()

  // ── 8. Line movement ──────────────────────────────────────────────────────
  let lineMovementScore = 0
  if (f.oddsMovement !== undefined && f.oddsMovement !== null) {
    if (f.oddsMovement < -0.15)      lineMovementScore = 1.0   // odds shortened = sharp money on draw
    else if (f.oddsMovement < -0.05) lineMovementScore = 0.5
    else if (f.oddsMovement > 0.25)  lineMovementScore = -0.5  // drifted out = fade signal
  }

  // ── 9. Fatigue ────────────────────────────────────────────────────────────
  let fatigueScore = 0
  if (f.homeGamesLast14 !== undefined && f.awayGamesLast14 !== undefined) {
    const avgFatigue = (f.homeGamesLast14 + f.awayGamesLast14) / 2
    if (avgFatigue >= 4)      fatigueScore = 0.6
    else if (avgFatigue >= 3) fatigueScore = 0.3
  }

  // ── 10. League boost ──────────────────────────────────────────────────────
  const leagueBase = (f.leagueAvgDrawRate - 0.24) / 0.10
  const leagueScore = Math.max(0, Math.min(1.0, leagueBase))
    + (f.leagueDrawBoost ?? 0)

  // ── Raw draw score [0–10] ─────────────────────────────────────────────────
  const rawScore =
    poissonScore     * 0.20 +
    parityScore      * 1.0  +
    xgBalanceScore   * 0.5  +
    lowScoringScore  * 1.0  +
    h2hScore         * 1.0  +
    teamDrawScore    * 1.0  +
    formScore        * 0.8  +
    oddsScore        * 1.0  +
    lineMovementScore * 0.7 +
    fatigueScore     * 0.5  +
    leagueScore      * 0.5

  const drawScore = Math.min(10, Math.max(0, Math.round(rawScore * 10) / 10))

  // ── Probability — blend Poisson with league/market priors ─────────────────
  const marketProb = impliedProb
  const leaguePrior = f.leagueAvgDrawRate
  const blendedProb =
    0.50 * poissonProb +
    0.25 * marketProb +
    0.15 * (f.h2hIsReal ? f.h2hDrawRate : leaguePrior) +
    0.10 * ((f.homeDrawRate + f.awayDrawRate) / 2)

  const probability = Math.min(0.95, Math.max(0.05, blendedProb))
  const edge = probability - marketProb

  // ── FIXED: Confidence ─────────────────────────────────────────────────────
  // Pre-calibration: pure sigmoid over drawScore, mapped to 15–85% range.
  // Post-calibration: blend sigmoid (70%) with Platt-scaled probability (30%).
  // The old code used PLATT_A=-1, PLATT_B=0 as "identity" which is incorrect:
  //   plattScale(0.5) = sigmoid(-1*0.5+0) = sigmoid(-0.5) = 0.378 ≠ 0.5
  // So we now check isCalibrated() before using Platt.

  const sigmoidRaw = 1 / (1 + Math.exp(-(drawScore - 5) * 0.55))
  const sigmoidMapped = 15 + sigmoidRaw * 70  // maps [0,1] → [15,85]

  let confidence: number
  if (!isCalibrated()) {
    // Pure sigmoid — honest pre-calibration estimate
    confidence = Math.round(sigmoidMapped)
  } else {
    // Platt scaling applied to blended probability
    const plattAdj = plattScale(probability) * 100
    confidence = Math.round(0.70 * sigmoidMapped + 0.30 * plattAdj)
  }

  return {
    poissonProb,
    probability,
    drawScore,
    confidence: Math.min(85, Math.max(15, confidence)),
    edge,
    breakdown: {
      poissonScore:      Math.round(poissonScore * 100) / 100,
      parityScore:       Math.round((parityScore + xgBalanceScore) * 100) / 100,
      formScore:         Math.round(formScore * 100) / 100,
      h2hScore:          Math.round(h2hScore * 100) / 100,
      oddsScore:         Math.round(oddsScore * 100) / 100,
      fatigueScore:      Math.round(fatigueScore * 100) / 100,
      lineMovementScore: Math.round(lineMovementScore * 100) / 100,
      leagueScore:       Math.round(leagueScore * 100) / 100,
    },
  }
}

// ─── Platt scaling fitter ─────────────────────────────────────────────────────

export interface CalibrationSample {
  drawScore: number
  wasCorrect: boolean
}

export function fitPlattScaling(samples: CalibrationSample[]): { a: number; b: number } {
  if (samples.length < 20) {
    console.warn('[platt] insufficient samples for calibration, using defaults')
    return { a: -1.0, b: 0.0 }
  }

  let a = -1.0, b = 0.0
  const lr = 0.01
  const epochs = 500

  for (let epoch = 0; epoch < epochs; epoch++) {
    let dA = 0, dB = 0
    for (const s of samples) {
      const f = s.drawScore / 10
      const p = 1 / (1 + Math.exp(a * f + b))
      const y = s.wasCorrect ? 1 : 0
      const err = p - y
      dA += err * f
      dB += err
    }
    a -= lr * dA / samples.length
    b -= lr * dB / samples.length
  }

  return { a: Math.round(a * 1000) / 1000, b: Math.round(b * 1000) / 1000 }
}

// ─── Form streak computation ──────────────────────────────────────────────────

export interface FixtureResult {
  goalsScored: number
  isDraw: boolean
}

export function computeFormMetrics(
  recentGames: FixtureResult[]
): { formDrawRate: number; formGoalsAvg: number } {
  if (recentGames.length === 0) return { formDrawRate: 0.28, formGoalsAvg: 1.4 }

  const weights = [1.0, 0.9, 0.8, 0.7, 0.6]
  let weightedDraws = 0, weightedGoals = 0, totalWeight = 0

  recentGames.slice(0, 5).forEach((g, i) => {
    const w = weights[i]
    weightedDraws += w * (g.isDraw ? 1 : 0)
    weightedGoals += w * g.goalsScored
    totalWeight += w
  })

  return {
    formDrawRate: weightedDraws / totalWeight,
    formGoalsAvg: weightedGoals / totalWeight,
  }
}

// ─── H2H draw rate computation ────────────────────────────────────────────────

export interface H2HFixture {
  homeGoals: number
  awayGoals: number
  date: string
}

export function computeH2HDrawRate(fixtures: H2HFixture[]): {
  drawRate: number
  sampleSize: number
} {
  if (fixtures.length === 0) return { drawRate: 0.28, sampleSize: 0 }

  const sorted = [...fixtures]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10)

  let weightedDraws = 0, totalWeight = 0
  sorted.forEach((f, i) => {
    const w = i < 5 ? 2 : 1
    const isDraw = f.homeGoals === f.awayGoals
    weightedDraws += w * (isDraw ? 1 : 0)
    totalWeight += w
  })

  return {
    drawRate: Math.round((weightedDraws / totalWeight) * 1000) / 1000,
    sampleSize: sorted.length,
  }
}

// ─── Line movement computation ────────────────────────────────────────────────

export function computeOddsMovement(
  openingOdds: number,
  currentOdds: number
): number {
  return Math.round((currentOdds - openingOdds) * 100) / 100
}

// ─── Backward-compat shims ────────────────────────────────────────────────────

export function calculateDrawScore(match: {
  home_goals_avg: number
  away_goals_avg: number
  home_draw_rate: number
  away_draw_rate: number
  h2h_draw_rate: number
  xg_home: number
  xg_away: number
  draw_odds: number
  leagues?: { avg_draw_rate?: number; draw_boost?: number } | null
}): number {
  const result = predictDraw({
    xgHome:            match.xg_home,
    xgAway:            match.xg_away,
    homeGoalsAvg:      match.home_goals_avg,
    awayGoalsAvg:      match.away_goals_avg,
    homeConcedeAvg:    match.home_goals_avg,
    awayConcedeAvg:    match.away_goals_avg,
    homeDrawRate:      match.home_draw_rate,
    awayDrawRate:      match.away_draw_rate,
    h2hDrawRate:       match.h2h_draw_rate,
    h2hIsReal:         false,
    drawOdds:          match.draw_odds,
    homeOdds:          0,
    awayOdds:          0,
    leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
    leagueDrawBoost:   match.leagues?.draw_boost ?? 0,
  })
  return result.drawScore
}

export function scoreToConfidence(score: number): number {
  const sigmoid = 1 / (1 + Math.exp(-(score - 5) * 0.55))
  return Math.min(85, Math.max(15, Math.round(15 + sigmoid * 70)))
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  return poissonDrawProbability(xgHome, xgAway)
}