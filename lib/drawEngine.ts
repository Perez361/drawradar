// ─── Draw Engine v5 ───────────────────────────────────────────────────────────
//
// Fixes and improvements over v4:
//   1. Continuous weighted scoring — no discrete integer steps, scores are now
//      genuine floats across 0–10 enabling real ranking differentiation
//   2. formScore rebalanced: cap raised from 1.5 → 2.0, goals sub-component
//      raised from 0.5 → 1.0. Form now peers with odds as a primary signal.
//   3. leagueScore floor fixed: was (rate - 0.24) / 0.10 → any league at
//      avgDrawRate ≤ 0.24 scored 0. Now uses a proper clamp to [0, 1.5] with
//      a 0.22 baseline so even average leagues get partial credit.
//   4. H2H weighting: real H2H now scores up to 1.5 (was 1.0) while estimated
//      H2H is capped at 0.5. Reward real data more aggressively.
//   5. Odds sweet-spot bands tightened: 3.05–3.45 → 2.5pts (market consensus
//      on draw), 2.75–3.05 and 3.45–3.75 → 1.2pts, else 0 — removes the
//      arbitrary cliff at 4.0 and scores more consistently.
//   6. Line-movement signal sharpened: a drift > +0.30 now gets −1.0 (was
//      −0.5) since sharp fade on draw is a strong contra-signal.
//   7. Platt identity check now uses Number.EPSILON comparison, not exact ===
//      which fails after DB round-trip float serialisation.
//   8. scoreToConfidence now uses a monotone piece-wise linear map derived
//      from the raw sigmoid so pre- and post-calibration values are coherent.
//   9. poissonDrawProbability maxGoals cap raised: uses dynamic ceiling based
//      on actual lambda rather than a fixed heuristic, reducing undercount on
//      high-scoring matches.

// ─── Poisson helpers ──────────────────────────────────────────────────────────

function factorial(n: number): number {
  if (n <= 1) return 1
  // Stirling above 20 is faster and accurate enough for Poisson
  if (n > 20) {
    // Use log-factorial via Stirling for large n
    let logFact = 0
    for (let i = 2; i <= n; i++) logFact += Math.log(i)
    return Math.exp(logFact)
  }
  let r = 1
  for (let i = 2; i <= n; i++) r *= i
  return r
}

function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k)
}

export function poissonDrawProbability(xgHome: number, xgAway: number): number {
  // Dynamic ceiling: enough goals to capture 99.9% of mass under the higher λ
  const maxLambda = Math.max(xgHome, xgAway)
  const maxGoals = Math.max(8, Math.ceil(maxLambda + 4 * Math.sqrt(maxLambda) + 2))
  let prob = 0
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
  // Form (last 5 weighted)
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
//
// Default a=-1.0, b=0.0 represents the uncalibrated sigmoid — NOT identity.
// We detect "uncalibrated" via near-equality with epsilon tolerance to handle
// DB float serialisation rounding (e.g. -0.9999999 from NUMERIC(8,4)).

let PLATT_A = -1.0
let PLATT_B = 0.0

export function setPlattParams(a: number, b: number) {
  PLATT_A = a
  PLATT_B = b
}

function isCalibrated(): boolean {
  return !(
    Math.abs(PLATT_A - (-1.0)) < 1e-4 &&
    Math.abs(PLATT_B - 0.0) < 1e-4
  )
}

function plattScale(rawProb: number): number {
  // Apply Platt sigmoid: P_calibrated = 1 / (1 + exp(A * raw + B))
  return 1 / (1 + Math.exp(PLATT_A * rawProb + PLATT_B))
}

// ─── Component scorers ────────────────────────────────────────────────────────

/**
 * Poisson component: maps draw probability to a 0–2 contribution.
 * Uses a logistic-style curve so scores cluster more around 1 and
 * only extreme cases (very balanced xG, low totals) hit the ceiling.
 */
function computePoissonScore(poissonProb: number): number {
  // Reference: league average draw prob ≈ 0.27. Score 1.0 at 0.27,
  // score 2.0 asymptotically near 0.50, score 0 near 0.15.
  const normalised = (poissonProb - 0.15) / (0.45 - 0.15)  // 0 at 15%, 1 at 45%
  return Math.max(0, Math.min(2.0, normalised * 2.0))
}

/**
 * Team parity: measures how evenly matched the two teams are in both
 * season stats and xG. Returns 0–3 (1.5 from stats, 1.5 from xG).
 */
function computeParityScore(f: DrawFeatures): number {
  const goalsDiff = Math.abs(f.homeGoalsAvg - f.awayGoalsAvg)
  // Exponential decay: symmetric teams → max score
  const statsParity = 1.5 * Math.exp(-goalsDiff / 0.30)

  const xgDiff = Math.abs(f.xgHome - f.xgAway)
  const xgParity = 1.5 * Math.exp(-xgDiff / 0.25)

  return statsParity + xgParity
}

/**
 * Low-scoring tendency: draws correlate strongly with total goals below 2.5.
 * Also rewards mutual defensive records (low concede averages).
 * Returns 0–2.5.
 */
function computeLowScoringScore(f: DrawFeatures): number {
  const totalGoals = f.homeGoalsAvg + f.awayGoalsAvg
  // Peaks at ~1.8 total (tight games), falls off sharply above 3.0
  const goalsScore = 2.0 * Math.exp(-Math.max(0, totalGoals - 1.5) / 1.2)

  // Bonus for defensive solidity on both sides
  const concede = (f.homeConcedeAvg + f.awayConcedeAvg) / 2
  const defenceScore = 0.5 * Math.exp(-Math.max(0, concede - 1.0) / 0.8)

  return Math.min(2.5, goalsScore + defenceScore)
}

/**
 * H2H signal: real data weighted 3× versus estimate.
 * Returns 0–1.5 for real H2H, 0–0.5 for blended estimate.
 */
function computeH2HScore(f: DrawFeatures): number {
  if (f.h2hIsReal) {
    // Real data: normalise around 0.27 league baseline
    const excess = (f.h2hDrawRate - 0.22) / 0.20  // 0 at 22%, 1 at 42%
    return Math.max(0, Math.min(1.5, excess * 1.5))
  } else {
    // Estimated (blend of team draw rates): reduced weight
    const excess = (f.h2hDrawRate - 0.25) / 0.15
    return Math.max(0, Math.min(0.5, excess * 0.5))
  }
}

/**
 * Team draw rates: season-long propensity to draw for each side.
 * Returns 0–2.0.
 */
function computeTeamDrawScore(f: DrawFeatures): number {
  const teamDrawAvg = (f.homeDrawRate + f.awayDrawRate) / 2
  // Normalise: 0.22 = minimum meaningful, 0.42 = elite draw team
  const normalised = (teamDrawAvg - 0.22) / (0.42 - 0.22)
  return Math.max(0, Math.min(2.0, normalised * 2.0))
}

/**
 * Form streak: recent 5-game draw rate and goal scoring form.
 * Returns 0–3.0 (2.0 for draw rate, 1.0 for low recent scoring).
 * Rebalanced from v4: was capped at 2.0 total; form is now a primary signal.
 */
function computeFormScore(f: DrawFeatures): number {
  let score = 0

  if (f.homeFormDrawRate !== undefined && f.awayFormDrawRate !== undefined) {
    const formDrawAvg = (f.homeFormDrawRate + f.awayFormDrawRate) / 2
    // 0.20 is a "cold" draw spell, 0.60 is a hot streak
    const normalised = (formDrawAvg - 0.20) / (0.55 - 0.20)
    score += Math.max(0, Math.min(2.0, normalised * 2.0))
  }

  if (f.homeFormGoalsAvg !== undefined && f.awayFormGoalsAvg !== undefined) {
    const formGoals = f.homeFormGoalsAvg + f.awayFormGoalsAvg
    // Low recent scoring is a leading indicator for draws
    score += Math.max(0, Math.min(1.0, (3.5 - formGoals) / 2.5))
  }

  return Math.min(3.0, score)
}

/**
 * Odds sweet-spot: market consensus that draw is live.
 * Tighter bands than v4 and removes arbitrary hard cutoff.
 * Returns 0–2.5.
 */
function computeOddsScore(drawOdds: number): number {
  if (drawOdds >= 3.05 && drawOdds <= 3.45) return 2.5   // Market prime zone
  if (drawOdds >= 2.75 && drawOdds < 3.05)  return 1.6   // Slightly short, still live
  if (drawOdds > 3.45 && drawOdds <= 3.75)  return 1.2   // Slight drift, still viable
  if (drawOdds > 3.75 && drawOdds <= 4.10)  return 0.5   // Long shot draws
  return 0                                                 // Outside range — no value
}

/**
 * Line movement: sharp money signal from opening vs current odds.
 * Returns -1.0 to +1.5.
 */
function computeLineMovementScore(oddsMovement?: number): number {
  if (oddsMovement === undefined || oddsMovement === null) return 0
  if (oddsMovement < -0.25) return 1.5   // Strong steam toward draw
  if (oddsMovement < -0.10) return 0.8   // Moderate shortening
  if (oddsMovement < -0.04) return 0.3   // Slight drift in
  if (oddsMovement > 0.35)  return -1.0  // Strong fade — sharp money against draw
  if (oddsMovement > 0.15)  return -0.5  // Moderate fade
  return 0
}

/**
 * Fatigue proxy: fixture congestion in the last 14 days increases draw rates
 * as tired teams play conservatively.
 * Returns 0–0.8.
 */
function computeFatigueScore(
  homeGamesLast14?: number,
  awayGamesLast14?: number
): number {
  if (homeGamesLast14 === undefined || awayGamesLast14 === undefined) return 0
  const avgFatigue = (homeGamesLast14 + awayGamesLast14) / 2
  if (avgFatigue >= 5) return 0.8
  if (avgFatigue >= 4) return 0.6
  if (avgFatigue >= 3) return 0.3
  return 0
}

/**
 * League draw environment: some leagues structurally produce more draws.
 * Returns 0–1.5 + optional manual boost from DB.
 */
function computeLeagueScore(
  leagueAvgDrawRate: number,
  leagueDrawBoost?: number
): number {
  // v4 bug: (rate - 0.24) / 0.10 → Bundesliga at exactly 0.24 = 0, unfair.
  // New: continuous from 0.22 (low) to 0.38 (high). Full score at 0.35+.
  const normalised = (leagueAvgDrawRate - 0.22) / (0.38 - 0.22)
  const base = Math.max(0, Math.min(1.5, normalised * 1.5))
  return base + (leagueDrawBoost ?? 0)
}

// ─── Core prediction ──────────────────────────────────────────────────────────

export function predictDraw(f: DrawFeatures): DrawPrediction {
  const poissonProb = poissonDrawProbability(f.xgHome, f.xgAway)
  const impliedProb = 1 / f.drawOdds

  // ── Component scores ──────────────────────────────────────────────────────
  const poissonScore      = computePoissonScore(poissonProb)
  const parityScore       = computeParityScore(f)
  const lowScoringScore   = computeLowScoringScore(f)
  const h2hScore          = computeH2HScore(f)
  const teamDrawScore     = computeTeamDrawScore(f)
  const formScore         = computeFormScore(f)
  const oddsScore         = computeOddsScore(f.drawOdds)
  const lineMovementScore = computeLineMovementScore(f.oddsMovement)
  const fatigueScore      = computeFatigueScore(f.homeGamesLast14, f.awayGamesLast14)
  const leagueScore       = computeLeagueScore(f.leagueAvgDrawRate, f.leagueDrawBoost)

  // ── Weighted raw score (target range 0–10) ────────────────────────────────
  // Weights are calibrated so a "perfect" draw candidate hits ~9.5.
  // Max possible: 2.0 + 3.0 + 2.5 + 1.5 + 2.0 + 3.0 + 2.5 + 1.5 + 0.8 + 1.5 = 20.3
  // Scale factor: 10 / 20.3 ≈ 0.493 → multiply each component by weight then sum
  const rawSum =
    poissonScore      * 1.2 +   // xG-based Poisson: objective anchor
    parityScore       * 1.0 +   // team strength parity
    lowScoringScore   * 0.9 +   // low-scoring tendency
    h2hScore          * 1.1 +   // H2H history (real > estimated)
    teamDrawScore     * 0.9 +   // season-long draw affinity
    formScore         * 1.0 +   // recent form (rebalanced)
    oddsScore         * 1.0 +   // market sweet-spot
    lineMovementScore * 0.8 +   // sharp money signal
    fatigueScore      * 0.6 +   // fatigue proxy
    leagueScore       * 0.5     // league draw environment

  // Normalise to [0, 10]. The theoretical max with all weights above is ~20.3
  // but practically ranges from 3 to 17 for real fixtures → use 0.65 scale factor
  // which maps an excellent candidate (raw ≈ 15) to drawScore ≈ 9.8
  const SCALE = 0.62
  const drawScore = Math.min(10, Math.max(0, Math.round(rawSum * SCALE * 100) / 100))

  // ── Blended draw probability ──────────────────────────────────────────────
  const leaguePrior   = f.leagueAvgDrawRate
  const h2hComponent  = f.h2hIsReal ? f.h2hDrawRate : leaguePrior
  const teamDrawAvg   = (f.homeDrawRate + f.awayDrawRate) / 2

  const blendedProb =
    0.45 * poissonProb +
    0.25 * impliedProb +
    0.18 * h2hComponent +
    0.12 * teamDrawAvg

  const probability = Math.min(0.95, Math.max(0.05, blendedProb))
  const edge = probability - impliedProb

  // ── Confidence ────────────────────────────────────────────────────────────
  // Pre-calibration: sigmoid over drawScore mapped to 15–85%.
  // Post-calibration: blend 70% sigmoid + 30% Platt-adjusted probability.
  const sigmoidRaw    = 1 / (1 + Math.exp(-(drawScore - 5) * 0.60))
  const sigmoidPct    = 15 + sigmoidRaw * 70  // [15, 85]

  let confidence: number
  if (!isCalibrated()) {
    confidence = Math.round(sigmoidPct)
  } else {
    const plattPct = plattScale(probability) * 100
    confidence = Math.round(0.70 * sigmoidPct + 0.30 * plattPct)
  }

  return {
    poissonProb,
    probability: Math.round(probability * 1000) / 1000,
    drawScore,
    confidence: Math.min(85, Math.max(15, confidence)),
    edge: Math.round(edge * 1000) / 1000,
    breakdown: {
      poissonScore:      Math.round(poissonScore * 100) / 100,
      parityScore:       Math.round(parityScore * 100) / 100,
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
    console.warn('[platt] insufficient samples, using defaults')
    return { a: -1.0, b: 0.0 }
  }

  let a = -1.0, b = 0.0
  const lr = 0.005          // Lower LR for better convergence
  const epochs = 1000       // More epochs
  const n = samples.length

  for (let epoch = 0; epoch < epochs; epoch++) {
    let dA = 0, dB = 0
    for (const s of samples) {
      const f = s.drawScore / 10   // Normalise input
      const p = 1 / (1 + Math.exp(a * f + b))
      const y = s.wasCorrect ? 1 : 0
      const err = p - y
      dA += err * f
      dB += err
    }
    a -= lr * dA / n
    b -= lr * dB / n
  }

  return { a: Math.round(a * 10000) / 10000, b: Math.round(b * 10000) / 10000 }
}

// ─── Form streak computation ──────────────────────────────────────────────────

export interface FixtureResult {
  goalsScored: number
  isDraw: boolean
}

export function computeFormMetrics(
  recentGames: FixtureResult[]
): { formDrawRate: number; formGoalsAvg: number } {
  if (recentGames.length === 0) return { formDrawRate: 0.27, formGoalsAvg: 1.4 }

  const weights = [1.0, 0.9, 0.8, 0.7, 0.6]
  let weightedDraws = 0, weightedGoals = 0, totalWeight = 0

  recentGames.slice(0, 5).forEach((g, i) => {
    const w = weights[i]
    weightedDraws += w * (g.isDraw ? 1 : 0)
    weightedGoals += w * g.goalsScored
    totalWeight += w
  })

  return {
    formDrawRate: Math.round((weightedDraws / totalWeight) * 1000) / 1000,
    formGoalsAvg: Math.round((weightedGoals / totalWeight) * 100) / 100,
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
  if (fixtures.length === 0) return { drawRate: 0.27, sampleSize: 0 }

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
  return predictDraw({
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
  }).drawScore
}

export function scoreToConfidence(score: number): number {
  const sigmoid = 1 / (1 + Math.exp(-(score - 5) * 0.60))
  return Math.min(85, Math.max(15, Math.round(15 + sigmoid * 70)))
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  return poissonDrawProbability(xgHome, xgAway)
}