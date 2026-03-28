// ─── Draw Engine v6 ───────────────────────────────────────────────────────────
//
// Philosophy: Weight signals by DATA QUALITY, not perceived importance.
//
// Previous versions scored 10+ components, but most fed on league baselines
// (fake xG, fake H2H, fake team draw rates). This created false precision —
// a confident-looking score built mostly on averages applied to every match.
//
// v6 is brutally honest about what we know vs. what we're guessing:
//
//   TIER 1 — Real data (always available):
//     • Market odds (what sharp money says)
//     • Poisson from xG (real when scraped, baseline when not)
//
//   TIER 2 — Sometimes real:
//     • Form draw rate (API-Football, when available)
//     • Real H2H (5+ matches, when available)
//     • Real team draw rates (TSDB-enriched, when available)
//
//   TIER 3 — Always fake (league baselines):
//     • Everything else: estimated H2H, league avg draw rate, etc.
//     → These get near-zero weight. They add noise, not signal.
//
// The score is now a weighted average of quality-gated signals.
// A match with only baseline data scores near the middle — honestly uncertain.
// A match with real H2H + real form + good odds scores confidently.
//
// This makes the model CALIBRATED: low confidence when data is sparse,
// high confidence only when multiple real signals align.

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DrawFeatures {
  // Core market signal
  drawOdds: number
  homeOdds?: number
  awayOdds?: number
  oddsOpenDraw?: number
  oddsMovement?: number

  // xG — real when scraped from Understat/FBref, estimated otherwise
  xgHome: number
  xgAway: number
  xgIsReal?: boolean          // true if from Understat/FBref scraper

  // Form — real when from API-Football recent fixtures
  homeFormDrawRate?: number   // undefined = no data
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
  hasRealTeamStats?: boolean  // true when TSDB enrichment succeeded

  // Goal averages — real when has_real_team_stats = true
  homeGoalsAvg: number
  awayGoalsAvg: number
  homeConcedeAvg: number
  awayConcedeAvg: number

  // League context (always a baseline — lowest weight tier)
  leagueAvgDrawRate: number
  leagueDrawBoost?: number
}

export interface DrawPrediction {
  poissonProb: number
  probability: number
  drawScore: number       // 0–10
  confidence: number      // 15–85%
  edge: number
  dataQuality: DataQuality
  breakdown: SignalBreakdown
}

export interface DataQuality {
  tier: 'high' | 'medium' | 'low'
  realSignalCount: number   // how many Tier 1/2 signals fired
  hasRealXg: boolean
  hasRealForm: boolean
  hasRealH2H: boolean
  hasRealTeamStats: boolean
  qualityScore: number      // 0–1, drives confidence range
}

export interface SignalBreakdown {
  marketSignal: number      // from odds — always present
  poissonSignal: number     // from xG
  formSignal: number | null // null if no real form data
  h2hSignal: number | null  // null if no real H2H
  teamDrawSignal: number | null // null if no real team stats
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

// ─── Poisson ──────────────────────────────────────────────────────────────────

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
// ─── Signal: Market (TIER 1 — always real) ────────────────────────────────────
//
// The market is the single most reliable draw signal we have.
// Sharp books like Pinnacle set odds based on vast data.
// We treat their implied probability as a prior, then look for edge.
//
// Signal interpretation:
//   odds 3.05–3.45 → market consensus "draw is live" (25–30% implied prob)
//   odds 2.75–3.05 → market slightly favors draw, may be worth taking
//   odds 3.45–3.75 → market less convinced, but not dead
//   outside range  → market doesn't see it; strong contra-signal
//
// Line movement adds information:
//   odds shortened → sharp money backing draw
//   odds drifted  → sharp money fading draw

function computeMarketSignal(drawOdds: number, oddsMovement?: number) {
  const impliedProb = 1 / drawOdds

  let baseSignal: number
  if (drawOdds >= 3.20 && drawOdds <= 3.60)      baseSignal = 0.85  // prime zone
  else if (drawOdds >= 2.95 && drawOdds < 3.20)   baseSignal = 0.70
  else if (drawOdds > 3.60 && drawOdds <= 3.90)   baseSignal = 0.60
  else if (drawOdds >= 2.70 && drawOdds < 2.95)   baseSignal = 0.40  // market disfavors draw
  else if (drawOdds > 3.90 && drawOdds <= 4.20)   baseSignal = 0.30
  else                                              baseSignal = 0.10

  let movementMod = 0
  if (oddsMovement !== undefined && oddsMovement !== null) {
    if (oddsMovement < -0.25)      movementMod = +0.10  // steam toward draw
    else if (oddsMovement < -0.10) movementMod = +0.05
    else if (oddsMovement > 0.35)  movementMod = -0.12  // sharp money fading
    else if (oddsMovement > 0.15)  movementMod = -0.06
  }

  return {
    signal: Math.max(0, Math.min(1, baseSignal + movementMod)),
    impliedProb,
  }
}

// ─── Signal: Poisson/xG (TIER 1 if real, TIER 3 if baseline) ─────────────────
//
// When xG is from Understat/FBref: high weight, reliable
// When xG is estimated from goals averages: medium weight if real team stats,
//   low weight if from league baselines
//
// Key insight: xG parity (|xgHome - xgAway| close to 0) predicts draws.
// Low total xG (under 2.0) also favors draws.

function computePoissonSignal(
  xgHome: number,
  xgAway: number
): number {
  const drawProb = poissonDrawProbability(xgHome, xgAway)
  // League draw rate baseline ≈ 0.27. Normalize around that.
  // A draw prob of 0.27 → signal 0.5 (neutral)
  // A draw prob of 0.35+ → signal near 1.0 (strongly positive)
  // A draw prob of 0.18  → signal near 0.1 (negative)
  const normalized = (drawProb - 0.15) / (0.40 - 0.15)
  return Math.max(0, Math.min(1, normalized))
}

// ─── Signal: Form (TIER 2 — real when from API-Football) ─────────────────────
//
// Recent form draw rate is a meaningful leading indicator.
// If both teams have been drawing a lot recently, that pattern tends to persist.
// Low recent scoring is a secondary form signal.
//
// Returns null if no real form data.

function computeFormSignal(
  homeFormDrawRate?: number,
  awayFormDrawRate?: number,
  homeFormGoalsAvg?: number,
  awayFormGoalsAvg?: number
): number | null {
  if (homeFormDrawRate === undefined || awayFormDrawRate === undefined) return null

  const avgFormDrawRate = (homeFormDrawRate + awayFormDrawRate) / 2
  // Normalize: 0.20 = cold spell, 0.55 = hot draw streak
  const drawRateSignal = Math.max(0, Math.min(1,
    (avgFormDrawRate - 0.18) / (0.55 - 0.18)
  ))

  // Goals signal (low recent scoring predicts draws)
  let goalsSignal = 0.5  // neutral if no data
  if (homeFormGoalsAvg !== undefined && awayFormGoalsAvg !== undefined) {
    const totalFormGoals = homeFormGoalsAvg + awayFormGoalsAvg
    // 1.8 total is "tight game" territory, 3.5+ is "open game"
    goalsSignal = Math.max(0, Math.min(1, (3.5 - totalFormGoals) / (3.5 - 1.8)))
  }

  // Blend: form draw rate is 2x more predictive than recent goals
  return (drawRateSignal * 2 + goalsSignal) / 3
}

// ─── Signal: H2H (TIER 2 if real, TIER 3 if estimated) ───────────────────────
//
// Real H2H (5+ matches) carries meaningful signal — some fixtures
// are structurally draw-prone regardless of form/league context.
// Estimated H2H (blend of team draw rates) has near-zero added value.
//
// Returns null if H2H is not real (caller handles the weight difference).

function computeH2HSignal(h2hDrawRate: number, h2hIsReal: boolean): number | null {
  if (!h2hIsReal) return null  // estimated H2H adds no value over baseline

  // Normalize: 0.20 = rarely draws, 0.50 = always draws
  return Math.max(0, Math.min(1, (h2hDrawRate - 0.18) / (0.48 - 0.18)))
}

// ─── Signal: Team draw rates (TIER 2 if TSDB-enriched, TIER 3 otherwise) ──────
//
// Real team draw rates from league standings are genuinely predictive.
// Estimated draw rates (league baseline applied to every team) are noise.
//
// Returns null if not real.

function computeTeamDrawSignal(
  homeDrawRate: number,
  awayDrawRate: number,
  hasRealTeamStats?: boolean
): number | null {
  if (!hasRealTeamStats) return null

  const avgTeamDrawRate = (homeDrawRate + awayDrawRate) / 2
  return Math.max(0, Math.min(1, (avgTeamDrawRate - 0.20) / (0.40 - 0.20)))
}

// ─── Data quality assessment ──────────────────────────────────────────────────

function assessDataQuality(f: DrawFeatures): DataQuality {
  const hasRealXg = f.xgIsReal === true
  const hasRealForm = f.homeFormDrawRate !== undefined && f.awayFormDrawRate !== undefined
  const hasRealH2H = f.h2hIsReal
  const hasRealTeamStats = f.hasRealTeamStats === true

  const realSignalCount = [hasRealXg, hasRealForm, hasRealH2H, hasRealTeamStats]
    .filter(Boolean).length

  // Quality score drives confidence range:
  // 0 real signals → quality 0.2 (we're basically guessing)
  // 1 real signal  → quality 0.4
  // 2 real signals → quality 0.6
  // 3 real signals → quality 0.8
  // 4 real signals → quality 1.0
  const qualityScore = 0.2 + (realSignalCount / 4) * 0.8

  const tier: 'high' | 'medium' | 'low' =
    realSignalCount >= 3 ? 'high' :
    realSignalCount >= 1 ? 'medium' : 'low'

  return {
    tier,
    realSignalCount,
    hasRealXg,
    hasRealForm,
    hasRealH2H,
    hasRealTeamStats,
    qualityScore,
  }
}

// ─── Core prediction ──────────────────────────────────────────────────────────
//
// Scoring approach:
//   1. Compute each signal (returns null if no real data for tier 2)
//   2. Build weighted average using quality-aware weights
//   3. Scale confidence range by data quality
//      → Low quality data = confidence capped at 50%
//      → High quality data = confidence can reach 80%
//   4. Apply Platt scaling when calibrated

export function predictDraw(f: DrawFeatures): DrawPrediction {
  // Sanitize inputs
  const xgHome = Math.max(0.1, Math.min(5, f.xgHome ?? 1.2))
  const xgAway = Math.max(0.1, Math.min(5, f.xgAway ?? 1.2))
  const drawOdds = Math.max(1.5, Math.min(15, f.drawOdds ?? 3.2))

  const poissonProb = poissonDrawProbability(xgHome, xgAway)

  // ── Compute all signals ──────────────────────────────────────────────────────
  const { signal: marketSignal, impliedProb } = computeMarketSignal(drawOdds, f.oddsMovement)
  const poissonSignal = computePoissonSignal(xgHome, xgAway)
  const formSignal = computeFormSignal(f.homeFormDrawRate, f.awayFormDrawRate, f.homeFormGoalsAvg, f.awayFormGoalsAvg)
  const h2hSignal = computeH2HSignal(f.h2hDrawRate, f.h2hIsReal)
  const teamDrawSignal = computeTeamDrawSignal(f.homeDrawRate, f.awayDrawRate, f.hasRealTeamStats)

  // ── Data quality ─────────────────────────────────────────────────────────────
  const dq = assessDataQuality(f)

  // ── Weighted combination ──────────────────────────────────────────────────────
  //
  // TIER 1 weights (always present):
  //   marketSignal:   0.45  — single most reliable signal
  //   poissonSignal:  0.25 if real xG, 0.15 if estimated
  //
  // TIER 2 weights (when real data available, else excluded):
  //   formSignal:     0.15 when real
  //   h2hSignal:      0.10 when real
  //   teamDrawSignal: 0.10 when real
  //
  // TIER 3 (league baseline fallback):
  //   When no tier 2 signals available, distribute remaining weight
  //   to market + poisson. This makes the model honest: "I only have
  //   odds and league averages, so I'm uncertain."

  let weightedSum = 0
  let totalWeight = 0

  // Market signal (TIER 1, always)
  const marketWeight = 0.45
  weightedSum += marketSignal * marketWeight
  totalWeight += marketWeight

  // Poisson signal (TIER 1 if real xG, reduced if estimated)
  const poissonWeight = dq.hasRealXg ? 0.25 : 0.15
  weightedSum += poissonSignal * poissonWeight
  totalWeight += poissonWeight

  // Form signal (TIER 2, only if real)
  if (formSignal !== null) {
    const formWeight = 0.15
    weightedSum += formSignal * formWeight
    totalWeight += formWeight
  }

  // H2H signal (TIER 2, only if real)
  if (h2hSignal !== null) {
    const h2hWeight = 0.10
    weightedSum += h2hSignal * h2hWeight
    totalWeight += h2hWeight
  }

  // Team draw rate signal (TIER 2, only if real)
  if (teamDrawSignal !== null) {
    const teamWeight = 0.10
    weightedSum += teamDrawSignal * teamWeight
    totalWeight += teamWeight
  }

  // Normalize to 0–1 (handles missing tier 2 signals cleanly)
  const combinedSignal = totalWeight > 0 ? weightedSum / totalWeight : 0.5

  // Convert to 0–10 draw score
  const drawScore = Math.round(combinedSignal * 10 * 100) / 100

  // ── Blended draw probability ──────────────────────────────────────────────────
  // Use the market as anchor (it's the best single predictor),
  // blend in Poisson, and add real signals when available
  // Market is the anchor, blended with Poisson
let blendedProb = 0.45 * impliedProb + 0.40 * poissonProb + 0.15 * f.leagueAvgDrawRate

// Only adjust if we have real Tier 2 signals
const realSignalProbs: number[] = []
if (formSignal !== null) {
  realSignalProbs.push(0.18 + formSignal * 0.28)
}
if (h2hSignal !== null) {
  realSignalProbs.push(0.18 + h2hSignal * 0.32)
}
if (teamDrawSignal !== null) {
  realSignalProbs.push(0.18 + teamDrawSignal * 0.28)
}

if (realSignalProbs.length > 0) {
  const avgReal = realSignalProbs.reduce((a, b) => a + b) / realSignalProbs.length
  // Blend: Tier 1 anchor stays dominant
  blendedProb = blendedProb * 0.75 + avgReal * 0.25
}

const probability = Math.min(0.95, Math.max(0.10, blendedProb))
const edge = probability - impliedProb  // both are 0–1 floats — correct
  // ── Confidence: quality-gated ─────────────────────────────────────────────────
  //
  // Key design: confidence range is CAPPED by data quality.
  // With no real data:  confidence ∈ [20%, 50%]  — "I'm not sure"
  // With some real data: confidence ∈ [20%, 65%]
  // With good real data: confidence ∈ [20%, 80%]
  //
  // Within that range, the draw score determines where we land.
  // This prevents the model from expressing 75% confidence
  // when it's just reading league baselines.

 // Market always earns some confidence on its own
const marketConfBonus = marketSignal >= 0.70 ? 15 : marketSignal >= 0.45 ? 8 : 0
const maxConf = Math.round(40 + dq.qualityScore * 40 + marketConfBonus)  // 40–95
const minConf = 22

let confidence: number;

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
    poissonProb: Math.round(poissonProb * 1000) / 1000,
    probability: Math.round(probability * 1000) / 1000,
    drawScore,
    confidence,
    edge: Math.round(edge * 1000) / 1000,
    dataQuality: dq,
    breakdown: {
      marketSignal: Math.round(marketSignal * 100) / 100,
      poissonSignal: Math.round(poissonSignal * 100) / 100,
      formSignal: formSignal !== null ? Math.round(formSignal * 100) / 100 : null,
      h2hSignal: h2hSignal !== null ? Math.round(h2hSignal * 100) / 100 : null,
      teamDrawSignal: teamDrawSignal !== null ? Math.round(teamDrawSignal * 100) / 100 : null,
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
      const f = s.drawScore / 10
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

// ─── Form computation helpers ─────────────────────────────────────────────────

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

  let wDraws = 0, totalW = 0
  sorted.forEach((f, i) => {
    const w = i < 5 ? 2 : 1
    wDraws += w * (f.homeGoals === f.awayGoals ? 1 : 0)
    totalW += w
  })

  return {
    drawRate: Math.round((wDraws / totalW) * 1000) / 1000,
    sampleSize: sorted.length,
  }
}

// ─── Backward-compat shims ────────────────────────────────────────────────────
// Keep existing callers working during migration

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
    xgHome: match.xg_home,
    xgAway: match.xg_away,
    homeGoalsAvg: match.home_goals_avg,
    awayGoalsAvg: match.away_goals_avg,
    homeConcedeAvg: match.home_goals_avg,
    awayConcedeAvg: match.away_goals_avg,
    homeDrawRate: match.home_draw_rate,
    awayDrawRate: match.away_draw_rate,
    h2hDrawRate: match.h2h_draw_rate,
    h2hIsReal: false,
    drawOdds: match.draw_odds,
    leagueAvgDrawRate: match.leagues?.avg_draw_rate ?? 0.27,
    leagueDrawBoost: match.leagues?.draw_boost ?? 0,
    hasRealTeamStats: false,
  }).drawScore
}

export function scoreToConfidence(score: number): number {
  const sigmoid = 1 / (1 + Math.exp(-(score - 5) * 0.60))
  return Math.min(80, Math.max(20, Math.round(20 + sigmoid * 60)))
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  return poissonDrawProbability(xgHome, xgAway)
}