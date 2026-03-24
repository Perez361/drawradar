// ─── Draw Engine v3 — Unified, Continuous Scoring ─────────────────────────────
//
// Replaces both `calculateDrawScore` (0–10 stepped) in supabase.ts and
// `predictDraw` in drawEngine.ts with a single probabilistic pipeline.
//
// Key improvements over v2:
//   • Smooth exponential decays instead of hard threshold steps
//   • Real H2H draw rate (from /fixtures/headtohead) when available
//   • Line movement signal (odds drift = sharp money indicator)
//   • Form streak feature (weighted W/D/L last 5)
//   • Fatigue proxy (games played in last 14 days)
//   • Sigmoid confidence — no cliff between adjacent scores
//   • Platt-scaling hook for post-hoc calibration
//   • Single source of truth — one function for ranking AND display

// ─── Poisson helpers ──────────────────────────────────────────────────────────

function factorial(n: number): number {
  if (n <= 1) return 1
  // cap to avoid Infinity for large n
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
  homeDrawRate: number       // per-team historical draw rate
  awayDrawRate: number
  h2hDrawRate: number        // REAL h2h draw rate (not blended avg)
  h2hIsReal: boolean         // true when from actual H2H API data

  // Market
  drawOdds: number
  homeOdds: number
  awayOdds: number
  oddsOpenDraw?: number      // opening draw odds — for line movement
  oddsMovement?: number      // negative = odds shortened (sharp money on draw)

  // Form (weighted: most recent = 1.0, oldest = 0.6)
  homeFormDrawRate?: number  // draws/games weighted last 5
  awayFormDrawRate?: number
  homeFormGoalsAvg?: number  // goals scored per game last 5 (weighted)
  awayFormGoalsAvg?: number

  // Fatigue (games in last 14 days — proxy for tiredness)
  homeGamesLast14?: number
  awayGamesLast14?: number

  // League context
  leagueAvgDrawRate: number
  leagueDrawBoost?: number
}

export interface DrawPrediction {
  // Raw Poisson probability
  poissonProb: number
  // Final blended probability [0, 1]
  probability: number
  // Continuous draw score [0, 10] — used for ranking
  drawScore: number
  // Calibrated confidence % [0, 100]
  confidence: number
  // Edge vs market implied probability
  edge: number
  // Feature breakdown for transparency
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

// ─── Platt scaling calibration ────────────────────────────────────────────────
// After accumulating was_correct data, fit A and B via MLE on the training set.
// Defaults (A=-1.0, B=0.0) are identity — no-op until calibrated.
// Update these monthly using fitPlattScaling() below.

let PLATT_A = -1.0
let PLATT_B = 0.0

export function setPlattParams(a: number, b: number) {
  PLATT_A = a
  PLATT_B = b
}

function plattScale(rawScore: number): number {
  // Sigmoid with learned A, B
  return 1 / (1 + Math.exp(PLATT_A * rawScore + PLATT_B))
}

// ─── Core scoring ─────────────────────────────────────────────────────────────

export function predictDraw(f: DrawFeatures): DrawPrediction {
  // ── 1. Poisson component (xG-based draw probability) ──────────────────────
  const poissonProb = poissonDrawProbability(f.xgHome, f.xgAway)
  const poissonScore = poissonProb * 10 // normalised to 0–10 scale internally

  // ── 2. Team parity — smooth decay (was: hard 0.3/0.6 threshold) ───────────
  const goalsDiff = Math.abs(f.homeGoalsAvg - f.awayGoalsAvg)
  const parityScore = 2.0 * Math.exp(-goalsDiff / 0.25)

  // xG balance sub-component
  const xgDiff = Math.abs(f.xgHome - f.xgAway)
  const xgBalanceScore = 1.0 * Math.exp(-xgDiff / 0.3)

  // ── 3. Low-scoring tendency ────────────────────────────────────────────────
  const totalGoals = f.homeGoalsAvg + f.awayGoalsAvg
  const lowScoringScore = 2.0 * Math.exp(-totalGoals / 2.8)

  // ── 4. H2H draw rate — real data weighted higher ──────────────────────────
  const h2hWeight = f.h2hIsReal ? 1.0 : 0.4  // penalise blended proxy
  const h2hBase = (f.h2hDrawRate - 0.25) / 0.15  // normalise around 25% avg
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

  // ── 7. Draw odds sweet spot — tighter window (3.0–3.4 is peak value) ──────
  const impliedProb = 1 / f.drawOdds
  const oddsScore = (() => {
    if (f.drawOdds >= 3.0 && f.drawOdds <= 3.4) return 2.0
    if (f.drawOdds >= 2.8 && f.drawOdds < 3.0)  return 1.4
    if (f.drawOdds > 3.4 && f.drawOdds <= 3.7)  return 1.0
    if (f.drawOdds > 3.7 && f.drawOdds <= 4.0)  return 0.4
    return 0
  })()

  // ── 8. Line movement — negative drift = sharps backing draw ───────────────
  let lineMovementScore = 0
  if (f.oddsMovement !== undefined) {
    // oddsMovement = currentOdds - openingOdds
    // Negative = odds shortened = sharp money came in = bullish signal
    if (f.oddsMovement < -0.15) lineMovementScore = 1.0
    else if (f.oddsMovement < -0.05) lineMovementScore = 0.5
    else if (f.oddsMovement > 0.25) lineMovementScore = -0.5  // drift out = fade
  }

  // ── 9. Fatigue — both teams fatigued = more draws ─────────────────────────
  let fatigueScore = 0
  if (f.homeGamesLast14 !== undefined && f.awayGamesLast14 !== undefined) {
    const avgFatigue = (f.homeGamesLast14 + f.awayGamesLast14) / 2
    if (avgFatigue >= 4) fatigueScore = 0.6
    else if (avgFatigue >= 3) fatigueScore = 0.3
  }

  // ── 10. League boost ───────────────────────────────────────────────────────
  const leagueBase = (f.leagueAvgDrawRate - 0.24) / 0.10
  const leagueScore = Math.max(0, Math.min(1.0, leagueBase))
    + (f.leagueDrawBoost ?? 0)

  // ── Raw draw score [0–10] ─────────────────────────────────────────────────
  const rawScore =
    poissonScore * 0.20 +
    parityScore  * 1.0 +
    xgBalanceScore * 0.5 +
    lowScoringScore * 1.0 +
    h2hScore     * 1.0 +
    teamDrawScore * 1.0 +
    formScore    * 0.8 +
    oddsScore    * 1.0 +
    lineMovementScore * 0.7 +
    fatigueScore * 0.5 +
    leagueScore  * 0.5

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

  // ── Confidence — sigmoid over drawScore, then Platt-scaled ───────────────
  // Sigmoid centres at score=5, spreads across the 0–10 range
  const sigmoidRaw = 1 / (1 + Math.exp(-(drawScore - 5) * 0.55))
  // Map to 15–85% range (honest — we never claim >85%)
  const sigmoidMapped = 15 + sigmoidRaw * 70
  // Apply Platt scaling (identity until calibrated with real data)
  const plattInput = drawScore / 10  // normalise to [0,1] for scaling
  const plattAdj = plattScale(plattInput) * 100
  // Blend 70% sigmoid, 30% Platt (Platt dominates once calibrated)
  const confidence = Math.round(
    PLATT_A === -1.0 && PLATT_B === 0.0
      ? sigmoidMapped  // pre-calibration: pure sigmoid
      : 0.70 * sigmoidMapped + 0.30 * plattAdj
  )

  return {
    poissonProb,
    probability,
    drawScore,
    confidence: Math.min(85, Math.max(15, confidence)),
    edge,
    breakdown: {
      poissonScore: Math.round(poissonScore * 100) / 100,
      parityScore:  Math.round((parityScore + xgBalanceScore) * 100) / 100,
      formScore:    Math.round(formScore * 100) / 100,
      h2hScore:     Math.round(h2hScore * 100) / 100,
      oddsScore:    Math.round(oddsScore * 100) / 100,
      fatigueScore: Math.round(fatigueScore * 100) / 100,
      lineMovementScore: Math.round(lineMovementScore * 100) / 100,
      leagueScore:  Math.round(leagueScore * 100) / 100,
    },
  }
}

// ─── Platt scaling fitter ─────────────────────────────────────────────────────
// Call this offline with your was_correct training data.
// Returns {a, b} — pass to setPlattParams() and persist in DB or env.

export interface CalibrationSample {
  drawScore: number    // the raw draw score at prediction time
  wasCorrect: boolean  // did the draw actually happen
}

export function fitPlattScaling(samples: CalibrationSample[]): { a: number; b: number } {
  if (samples.length < 20) {
    console.warn('[platt] insufficient samples for calibration, using defaults')
    return { a: -1.0, b: 0.0 }
  }

  // Gradient descent on cross-entropy loss
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
// Weights: most recent game = 1.0, 5th most recent = 0.6
// Returns weighted draw rate and weighted goals scored avg.

export interface FixtureResult {
  goalsScored: number
  isDraw: boolean
}

export function computeFormMetrics(
  recentGames: FixtureResult[]  // ordered most-recent first, max 5
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
// Pass raw H2H fixture results.  Cap to last 10 meetings,
// weight recent 2× over older ones.

export interface H2HFixture {
  homeGoals: number
  awayGoals: number
  date: string  // ISO string — used for recency weighting
}

export function computeH2HDrawRate(fixtures: H2HFixture[]): {
  drawRate: number
  sampleSize: number
} {
  if (fixtures.length === 0) return { drawRate: 0.28, sampleSize: 0 }

  // Sort most recent first, cap to 10
  const sorted = [...fixtures]
    .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime())
    .slice(0, 10)

  // Weight: top 5 get weight 2, older 5 get weight 1
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
// Pass the stored opening odds and the current odds.
// Returns the movement (negative = odds shortened = sharp money on draw).

export function computeOddsMovement(
  openingOdds: number,
  currentOdds: number
): number {
  return Math.round((currentOdds - openingOdds) * 100) / 100
}

// ─── Backward-compat shims ────────────────────────────────────────────────────
// Keep existing callers compiling while migration is in progress.

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
    xgHome: match.xg_home,
    xgAway: match.xg_away,
    homeGoalsAvg: match.home_goals_avg,
    awayGoalsAvg: match.away_goals_avg,
    homeConcedeAvg: match.home_goals_avg,  // fallback — same as goals avg
    awayConcedeAvg: match.away_goals_avg,
    homeDrawRate: match.home_draw_rate,
    awayDrawRate: match.away_draw_rate,
    h2hDrawRate: match.h2h_draw_rate,
    h2hIsReal: false,  // legacy matches never had real H2H
    drawOdds: match.draw_odds,
    homeOdds: 0,
    awayOdds: 0,
    leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
    leagueDrawBoost: match.leagues?.draw_boost ?? 0,
  })
  return result.drawScore
}

export function scoreToConfidence(score: number): number {
  const result = predictDraw({
    xgHome: 1.4,
    xgAway: 1.4,
    homeGoalsAvg: 1.4,
    awayGoalsAvg: 1.4,
    homeConcedeAvg: 1.4,
    awayConcedeAvg: 1.4,
    homeDrawRate: 0.28,
    awayDrawRate: 0.28,
    h2hDrawRate: 0.28,
    h2hIsReal: false,
    drawOdds: 3.2,
    homeOdds: 0,
    awayOdds: 0,
    leagueAvgDrawRate: 0.27,
  })
  // Override with the actual score to get the right confidence
  const sigmoid = 1 / (1 + Math.exp(-(score - 5) * 0.55))
  return Math.min(85, Math.max(15, Math.round(15 + sigmoid * 70)))
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  return poissonDrawProbability(xgHome, xgAway)
}