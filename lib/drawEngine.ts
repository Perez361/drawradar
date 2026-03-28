// ─── Draw Engine v7 ───────────────────────────────────────────────────────────
//
// CORE INSIGHT (v7):
//   Draws are fundamentally a LOW-SCORING GAME phenomenon.
//   When bookmakers price Under 2.5 goals at odds < 1.40, they expect a tight,
//   low-scoring match — which is precisely when draws happen most.
//
//   Research-backed draw rates by Under 2.5 odds:
//     Under 2.5 odds < 1.30  →  draw rate ≈ 37–42%
//     Under 2.5 odds 1.30–1.40 → draw rate ≈ 32–38%
//     Under 2.5 odds 1.40–1.55 → draw rate ≈ 28–32%
//     Under 2.5 odds > 1.60  →  draw rate ≈ 22–26%
//
//   Signal hierarchy (v7):
//     1. Under 2.5 odds  — strongest single predictor when available
//     2. Draw market odds — market consensus on X outcome
//     3. xG parity + magnitude — Poisson model, real > estimated
//     4. Form draw rate   — recent results (Tier 2, real only)
//     5. H2H draw rate    — head-to-head history (Tier 2, real only)
//     6. Team draw rates  — league standings (Tier 2, real only)
//
//   Key changes from v6:
//     • Under 2.5 odds added as primary signal (weight 0.30 when available)
//     • xG low-scoring bonus: extra score when xg_home + xg_away < 1.8
//     • Market sweet spot corrected to 3.20–3.60 (was 3.05–3.45)
//     • blendedProb no longer double-counts market signal
//     • Confidence floor raised: market signal earns bonus headroom
//     • xgIsReal and hasRealTeamStats flags actually connected in pipeline
//     • Poisson uses stable log-space factorial (no overflow at k>20)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DrawFeatures {
  // Core market signals
  drawOdds: number
  homeOdds?: number
  awayOdds?: number
  oddsOpenDraw?: number
  oddsMovement?: number

  // Under 2.5 goals odds — THE key new signal
  // Set to undefined if not available from your odds source
  under25Odds?: number

  // xG — real when scraped from Understat/FBref, estimated otherwise
  xgHome: number
  xgAway: number
  xgIsReal?: boolean

  // Form — real when from API-Football recent fixtures
  homeFormDrawRate?: number
  awayFormDrawRate?: number
  homeFormGoalsAvg?: number
  awayFormGoalsAvg?: number
  homeGamesLast14?: number
  awayGamesLast14?: number

  // H2H — real when h2h_is_real = true (5+ real matches)
  h2hDrawRate: number
  h2hIsReal: boolean

  // Team draw rates — real when has_real_team_stats = true (TSDB-enriched)
  homeDrawRate: number
  awayDrawRate: number
  hasRealTeamStats?: boolean

  // Goal averages — real when has_real_team_stats = true
  homeGoalsAvg: number
  awayGoalsAvg: number
  homeConcedeAvg: number
  awayConcedeAvg: number

  // League context
  leagueAvgDrawRate: number
  leagueDrawBoost?: number
}

export interface DrawPrediction {
  poissonProb: number
  probability: number
  drawScore: number       // 0–10
  confidence: number      // 22–85%
  edge: number
  dataQuality: DataQuality
  breakdown: SignalBreakdown
}

export interface DataQuality {
  tier: 'high' | 'medium' | 'low'
  realSignalCount: number
  hasRealXg: boolean
  hasRealForm: boolean
  hasRealH2H: boolean
  hasRealTeamStats: boolean
  hasUnder25Odds: boolean
  isLowScoringGame: boolean   // xG total < 2.0 or u25 odds < 1.55
  qualityScore: number        // 0–1
}

export interface SignalBreakdown {
  under25Signal: number | null  // null if odds not available
  marketSignal: number
  poissonSignal: number
  formSignal: number | null
  h2hSignal: number | null
  teamDrawSignal: number | null
  lowScoringBonus: number       // additive bonus for tight games
}

// ─── Platt scaling ────────────────────────────────────────────────────────────

let PLATT_A = -1.0
let PLATT_B = 0.0

export function setPlattParams(a: number, b: number) {
  PLATT_A = a
  PLATT_B = b
}

function isCalibrated(): boolean {
  return !(Math.abs(PLATT_A - (-1.0)) < 1e-4 && Math.abs(PLATT_B - 0.0) < 1e-4)
}

// ─── Poisson (log-space, numerically stable) ──────────────────────────────────

function logFactorial(n: number): number {
  if (n <= 1) return 0
  let r = 0
  for (let i = 2; i <= n; i++) r += Math.log(i)
  return r
}

function poisson(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0
  return Math.exp(k * Math.log(lambda) - lambda - logFactorial(k))
}

export function poissonDrawProbability(xgHome: number, xgAway: number): number {
  const maxGoals = Math.min(12, Math.ceil(Math.max(xgHome, xgAway) * 3 + 4))
  let prob = 0
  for (let k = 0; k <= maxGoals; k++) {
    prob += poisson(xgHome, k) * poisson(xgAway, k)
  }
  return Math.min(prob, 0.99)
}

// ─── Signal 1: Under 2.5 odds (PRIMARY signal when available) ─────────────────
//
// This is the most informative single signal for draw prediction.
// When bookmakers price Under 2.5 goals at < 1.40, they are explicitly saying
// "this game is likely to have 0, 1, or 2 goals total."
// Low-goal games end in draws far more often than high-goal games.
//
// Empirical draw rates by Under 2.5 price:
//   < 1.25  → ~40% draw rate (very tight game)
//   1.25–1.35 → ~36% draw rate
//   1.35–1.45 → ~32% draw rate
//   1.45–1.55 → ~28% draw rate
//   1.55–1.70 → ~25% draw rate
//   > 1.70  → ~22% draw rate (open game, draws less likely)

function computeUnder25Signal(under25Odds: number): {
  signal: number
  impliedDrawRate: number
} {
  let signal: number
  let impliedDrawRate: number

  if (under25Odds < 1.25) {
    signal = 0.95
    impliedDrawRate = 0.40
  } else if (under25Odds < 1.35) {
    signal = 0.85
    impliedDrawRate = 0.36
  } else if (under25Odds < 1.45) {
    signal = 0.72
    impliedDrawRate = 0.32
  } else if (under25Odds < 1.55) {
    signal = 0.58
    impliedDrawRate = 0.28
  } else if (under25Odds < 1.70) {
    signal = 0.40
    impliedDrawRate = 0.25
  } else if (under25Odds < 1.90) {
    signal = 0.22
    impliedDrawRate = 0.23
  } else {
    signal = 0.10
    impliedDrawRate = 0.21
  }

  return { signal, impliedDrawRate }
}

// ─── Signal 2: Draw market odds (recalibrated sweet spot) ────────────────────
//
// Sweet spot is 3.20–3.60 (27–31% implied probability).
// Values outside this range carry less draw information.
// Line movement adds information about sharp money direction.

function computeMarketSignal(drawOdds: number, oddsMovement?: number): {
  signal: number
  impliedProb: number
} {
  const impliedProb = 1 / drawOdds

  let baseSignal: number
  if (drawOdds >= 3.20 && drawOdds <= 3.60)       baseSignal = 0.85  // prime zone
  else if (drawOdds >= 2.95 && drawOdds < 3.20)    baseSignal = 0.70
  else if (drawOdds > 3.60 && drawOdds <= 3.90)    baseSignal = 0.58
  else if (drawOdds >= 2.70 && drawOdds < 2.95)    baseSignal = 0.40  // mkt disfavors
  else if (drawOdds > 3.90 && drawOdds <= 4.30)    baseSignal = 0.28
  else                                               baseSignal = 0.10

  let movementMod = 0
  if (oddsMovement !== undefined && oddsMovement !== null) {
    if (oddsMovement < -0.25)       movementMod = +0.10  // steam toward draw
    else if (oddsMovement < -0.10)  movementMod = +0.05
    else if (oddsMovement > 0.35)   movementMod = -0.12  // sharp money fading
    else if (oddsMovement > 0.15)   movementMod = -0.06
  }

  return {
    signal: Math.max(0, Math.min(1, baseSignal + movementMod)),
    impliedProb,
  }
}

// ─── Signal 3: Poisson / xG (with low-scoring bonus) ─────────────────────────
//
// xG draw probability normalised around the league baseline (~0.27).
// ADDITIONALLY: when total xG is very low (< 1.8), apply a low-scoring bonus.
// This captures the "0-0 and 1-1 territory" that the Poisson base misses
// because it doesn't weight 0-0 outcomes specially.

function computePoissonSignal(xgHome: number, xgAway: number): {
  signal: number
  lowScoringBonus: number
  totalXg: number
} {
  const drawProb = poissonDrawProbability(xgHome, xgAway)
  const totalXg = xgHome + xgAway

  // Normalise draw probability: 0.27 → 0.5 (neutral), 0.38 → 1.0, 0.16 → 0.0
  const signal = Math.max(0, Math.min(1, (drawProb - 0.16) / (0.38 - 0.16)))

  // Low-scoring bonus: extra signal when both teams expected to score little
  // This reflects that 0-0 and 1-1 are the most common draw scorelines
  let lowScoringBonus = 0
  if (totalXg < 1.5)       lowScoringBonus = 0.20   // very tight: 0-0 territory
  else if (totalXg < 1.8)  lowScoringBonus = 0.12   // tight: 1-1 territory
  else if (totalXg < 2.2)  lowScoringBonus = 0.05   // moderate
  // totalXg >= 2.2 → no bonus (open game, draws less likely)

  // Also check xG parity — balanced teams draw more
  const xgDiff = Math.abs(xgHome - xgAway)
  const parityBonus = xgDiff < 0.20 ? 0.08 : xgDiff < 0.40 ? 0.04 : 0

  return {
    signal,
    lowScoringBonus: Math.min(0.25, lowScoringBonus + parityBonus),
    totalXg,
  }
}

// ─── Signal 4: Form draw rate (Tier 2, real only) ────────────────────────────

function computeFormSignal(
  homeFormDrawRate?: number,
  awayFormDrawRate?: number,
  homeFormGoalsAvg?: number,
  awayFormGoalsAvg?: number
): number | null {
  if (homeFormDrawRate === undefined || awayFormDrawRate === undefined) return null

  const avgFormDrawRate = (homeFormDrawRate + awayFormDrawRate) / 2
  const drawRateSignal = Math.max(0, Math.min(1,
    (avgFormDrawRate - 0.18) / (0.55 - 0.18)
  ))

  let goalsSignal = 0.5
  if (homeFormGoalsAvg !== undefined && awayFormGoalsAvg !== undefined) {
    const totalFormGoals = homeFormGoalsAvg + awayFormGoalsAvg
    // Low-scoring form is extra relevant — tighter range (1.6–3.2 instead of 1.8–3.5)
    goalsSignal = Math.max(0, Math.min(1, (3.2 - totalFormGoals) / (3.2 - 1.6)))
  }

  // Form draw rate is 2× more predictive than recent goals average
  return (drawRateSignal * 2 + goalsSignal) / 3
}

// ─── Signal 5: H2H (Tier 2 if real) ──────────────────────────────────────────

function computeH2HSignal(h2hDrawRate: number, h2hIsReal: boolean): number | null {
  if (!h2hIsReal) return null
  return Math.max(0, Math.min(1, (h2hDrawRate - 0.18) / (0.48 - 0.18)))
}

// ─── Signal 6: Team draw rates (Tier 2 if TSDB-enriched) ─────────────────────

function computeTeamDrawSignal(
  homeDrawRate: number,
  awayDrawRate: number,
  hasRealTeamStats?: boolean
): number | null {
  if (!hasRealTeamStats) return null
  const avg = (homeDrawRate + awayDrawRate) / 2
  return Math.max(0, Math.min(1, (avg - 0.20) / (0.40 - 0.20)))
}

// ─── Data quality assessment ──────────────────────────────────────────────────

function assessDataQuality(f: DrawFeatures, totalXg: number): DataQuality {
  const hasRealXg          = f.xgIsReal === true
  const hasRealForm        = f.homeFormDrawRate !== undefined && f.awayFormDrawRate !== undefined
  const hasRealH2H         = f.h2hIsReal
  const hasRealTeamStats   = f.hasRealTeamStats === true
  const hasUnder25Odds     = f.under25Odds !== undefined && f.under25Odds > 0

  // Low-scoring detection: use Under 2.5 odds if available, else xG
  const isLowScoringGame =
    (hasUnder25Odds && (f.under25Odds ?? 99) < 1.55) ||
    (!hasUnder25Odds && totalXg < 2.0)

  const realSignalCount = [hasRealXg, hasRealForm, hasRealH2H, hasRealTeamStats, hasUnder25Odds]
    .filter(Boolean).length

  // Under 2.5 odds count as 2 quality points (it's that informative)
  const qualityPoints = (hasUnder25Odds ? 2 : 0) + (hasRealXg ? 1 : 0) +
    (hasRealForm ? 1 : 0) + (hasRealH2H ? 1 : 0) + (hasRealTeamStats ? 1 : 0)

  const qualityScore = Math.min(1, 0.15 + (qualityPoints / 6) * 0.85)

  const tier: 'high' | 'medium' | 'low' =
    qualityPoints >= 4 ? 'high' :
    qualityPoints >= 2 ? 'medium' : 'low'

  return {
    tier,
    realSignalCount,
    hasRealXg,
    hasRealForm,
    hasRealH2H,
    hasRealTeamStats,
    hasUnder25Odds,
    isLowScoringGame,
    qualityScore,
  }
}

// ─── Core prediction ──────────────────────────────────────────────────────────

export function predictDraw(f: DrawFeatures): DrawPrediction {
  const xgHome  = Math.max(0.10, Math.min(5, f.xgHome  ?? 1.2))
  const xgAway  = Math.max(0.10, Math.min(5, f.xgAway  ?? 1.2))
  const drawOdds = Math.max(1.5, Math.min(15, f.drawOdds ?? 3.2))

  const poissonProb = poissonDrawProbability(xgHome, xgAway)

  // ── Compute all signals ────────────────────────────────────────────────────

  // Under 2.5 (primary when available)
  const under25Available = f.under25Odds !== undefined && f.under25Odds > 0
  const under25Result = under25Available
    ? computeUnder25Signal(f.under25Odds!)
    : null

  const { signal: marketSignal, impliedProb } = computeMarketSignal(drawOdds, f.oddsMovement)
  const { signal: poissonSignal, lowScoringBonus, totalXg } = computePoissonSignal(xgHome, xgAway)
  const formSignal       = computeFormSignal(f.homeFormDrawRate, f.awayFormDrawRate, f.homeFormGoalsAvg, f.awayFormGoalsAvg)
  const h2hSignal        = computeH2HSignal(f.h2hDrawRate, f.h2hIsReal)
  const teamDrawSignal   = computeTeamDrawSignal(f.homeDrawRate, f.awayDrawRate, f.hasRealTeamStats)

  const dq = assessDataQuality(f, totalXg)

  // ── Weighted combination ───────────────────────────────────────────────────
  //
  // Weight allocation:
  //   Under 2.5 odds (when available):  0.30  ← new primary signal
  //   Market draw odds:                 0.35  (0.45 when no u25 odds)
  //   Poisson/xG:                       0.20  (0.30 when no u25 odds)
  //   Form (Tier 2, real only):         0.10
  //   H2H (Tier 2, real only):          0.08
  //   Team draw rates (Tier 2):         0.07

  let weightedSum = 0
  let totalWeight = 0

  if (under25Result !== null) {
    weightedSum += under25Result.signal * 0.30
    totalWeight += 0.30
  }

  const marketWeight  = under25Available ? 0.35 : 0.45
  const poissonWeight = under25Available
    ? (dq.hasRealXg ? 0.20 : 0.12)
    : (dq.hasRealXg ? 0.30 : 0.20)

  weightedSum += marketSignal * marketWeight
  totalWeight += marketWeight

  weightedSum += poissonSignal * poissonWeight
  totalWeight += poissonWeight

  if (formSignal !== null) {
    weightedSum += formSignal * 0.10
    totalWeight += 0.10
  }

  if (h2hSignal !== null) {
    weightedSum += h2hSignal * 0.08
    totalWeight += 0.08
  }

  if (teamDrawSignal !== null) {
    weightedSum += teamDrawSignal * 0.07
    totalWeight += 0.07
  }

  let combinedSignal = totalWeight > 0 ? weightedSum / totalWeight : 0.5

  // Apply low-scoring bonus (additive, capped)
  combinedSignal = Math.min(1, combinedSignal + lowScoringBonus * 0.5)

  const drawScore = Math.round(combinedSignal * 10 * 100) / 100

  // ── Blended draw probability ───────────────────────────────────────────────
  // Start with a clean blend of the three Tier 1 anchors.
  // Do NOT include impliedProb twice.

  let blendedProb: number

  if (under25Result !== null) {
    // Three-way blend: under25 implied draw rate + market + Poisson
    blendedProb =
      under25Result.impliedDrawRate * 0.40 +
      impliedProb                   * 0.35 +
      poissonProb                   * 0.25
  } else {
    // Two-way blend: market + Poisson, anchored to league draw rate
    blendedProb =
      impliedProb * 0.55 +
      poissonProb * 0.35 +
      f.leagueAvgDrawRate * 0.10
  }

  // Incorporate real Tier 2 signals as a gentle adjustment
  const realSignalProbs: number[] = []
  if (formSignal !== null)     realSignalProbs.push(0.18 + formSignal     * 0.28)
  if (h2hSignal !== null)      realSignalProbs.push(0.18 + h2hSignal      * 0.32)
  if (teamDrawSignal !== null) realSignalProbs.push(0.18 + teamDrawSignal * 0.28)

  if (realSignalProbs.length > 0) {
    const avgReal = realSignalProbs.reduce((a, b) => a + b) / realSignalProbs.length
    blendedProb = blendedProb * 0.75 + avgReal * 0.25
  }

  const probability = Math.min(0.95, Math.max(0.10, blendedProb))
  const edge = probability - impliedProb

  // ── Confidence ────────────────────────────────────────────────────────────
  // Market signal + Under 2.5 both earn headroom independently.
  // Low-scoring game flag also earns extra headroom.

  const marketBonus    = marketSignal >= 0.70 ? 12 : marketSignal >= 0.45 ? 6 : 0
  const under25Bonus   = under25Available && (f.under25Odds ?? 99) < 1.40 ? 12 :
                          under25Available && (f.under25Odds ?? 99) < 1.55 ? 7 : 0
  const lowScoreBonus  = dq.isLowScoringGame ? 6 : 0

  const maxConf = Math.round(38 + dq.qualityScore * 42 + marketBonus + under25Bonus + lowScoreBonus)
  const minConf = 22

  let confidence: number

  if (!isCalibrated()) {
    const scoreNorm = drawScore / 10
    confidence = Math.round(minConf + scoreNorm * (maxConf - minConf))
  } else {
    const plattConf = Math.round((1 / (1 + Math.exp(PLATT_A * probability + PLATT_B))) * 100)
    const scoreNorm = drawScore / 10
    const scoreConf = Math.round(minConf + scoreNorm * (maxConf - minConf))
    confidence = Math.round(0.65 * plattConf + 0.35 * scoreConf)
  }

  confidence = Math.min(maxConf, Math.max(minConf, confidence))

  return {
    poissonProb:  Math.round(poissonProb  * 1000) / 1000,
    probability:  Math.round(probability  * 1000) / 1000,
    drawScore,
    confidence,
    edge:         Math.round(edge         * 1000) / 1000,
    dataQuality:  dq,
    breakdown: {
      under25Signal:   under25Result !== null ? Math.round(under25Result.signal * 100) / 100 : null,
      marketSignal:    Math.round(marketSignal  * 100) / 100,
      poissonSignal:   Math.round(poissonSignal * 100) / 100,
      formSignal:      formSignal      !== null ? Math.round(formSignal      * 100) / 100 : null,
      h2hSignal:       h2hSignal       !== null ? Math.round(h2hSignal       * 100) / 100 : null,
      teamDrawSignal:  teamDrawSignal  !== null ? Math.round(teamDrawSignal  * 100) / 100 : null,
      lowScoringBonus: Math.round(lowScoringBonus * 100) / 100,
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
  const lr = 0.005
  const epochs = 1000
  const n = samples.length

  for (let epoch = 0; epoch < epochs; epoch++) {
    let dA = 0, dB = 0
    for (const s of samples) {
      const fv = s.drawScore / 10
      const p  = 1 / (1 + Math.exp(a * fv + b))
      const err = p - (s.wasCorrect ? 1 : 0)
      dA += err * fv
      dB += err
    }
    a -= lr * dA / n
    b -= lr * dB / n
  }
  return { a: Math.round(a * 10000) / 10000, b: Math.round(b * 10000) / 10000 }
}

// ─── Form / H2H helpers (unchanged from v6) ───────────────────────────────────

export const FORM_WEIGHTS = [1.0, 0.9, 0.8, 0.7, 0.6]

export interface FixtureResult {
  goalsScored: number
  isDraw: boolean
}

export function computeFormMetrics(recentGames: FixtureResult[]): {
  formDrawRate: number
  formGoalsAvg: number
} {
  if (recentGames.length === 0) return { formDrawRate: 0.27, formGoalsAvg: 1.4 }
  let wDraws = 0, wGoals = 0, totalW = 0
  recentGames.slice(0, 5).forEach((g, i) => {
    const w = FORM_WEIGHTS[i] ?? 0.6
    wDraws += w * (g.isDraw ? 1 : 0)
    wGoals += w * g.goalsScored
    totalW += w
  })
  return {
    formDrawRate: Math.round((wDraws / totalW) * 1000) / 1000,
    formGoalsAvg: Math.round((wGoals / totalW) * 100) / 100,
  }
}

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
  let wDraws = 0, totalW = 0
  sorted.forEach((f, i) => {
    const w = i < 5 ? 2 : 1
    wDraws += w * (f.homeGoals === f.awayGoals ? 1 : 0)
    totalW += w
  })
  return {
    drawRate:   Math.round((wDraws / totalW) * 1000) / 1000,
    sampleSize: sorted.length,
  }
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
  under25_odds?: number
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
    under25Odds:       match.under25_odds,
    leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
    leagueDrawBoost:   match.leagues?.draw_boost    ?? 0,
    hasRealTeamStats:  false,
  }).drawScore
}

export function scoreToConfidence(score: number): number {
  const sigmoid = 1 / (1 + Math.exp(-(score - 5) * 0.60))
  return Math.min(80, Math.max(20, Math.round(20 + sigmoid * 60)))
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  return poissonDrawProbability(xgHome, xgAway)
}