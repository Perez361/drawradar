// ==============================
// DRAW ENGINE (v2 - Probabilistic)
// ==============================

type MatchInput = {
  home_xg: number
  away_xg: number
  home_odds: number
  draw_odds: number
  away_odds: number
  league_avg_draw_rate?: number
}

type PredictionOutput = {
  probability: number
  confidence: number
  edge: number
  score: number
}

// ------------------------------
// Utilities
// ------------------------------

function factorial(n: number): number {
  if (n === 0 || n === 1) return 1
  let res = 1
  for (let i = 2; i <= n; i++) res *= i
  return res
}

function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k)
}

// ------------------------------
// Core: Draw Probability
// ------------------------------

function poissonDrawProbability(homeXG: number, awayXG: number): number {
  let prob = 0

  for (let k = 0; k <= 6; k++) {
    prob += poisson(homeXG, k) * poisson(awayXG, k)
  }

  return prob
}

// ------------------------------
// Market Probability (Bookmakers)
// ------------------------------

function marketProbability(drawOdds: number): number {
  return 1 / drawOdds
}

// ------------------------------
// Team Parity (closeness)
// ------------------------------

function parity(homeOdds: number, awayOdds: number): number {
  return 1 - Math.abs(homeOdds - awayOdds) / Math.max(homeOdds, awayOdds)
}

// ------------------------------
// Main Engine
// ------------------------------

export function predictDraw(match: MatchInput): PredictionOutput {
  const {
    home_xg,
    away_xg,
    home_odds,
    draw_odds,
    away_odds,
    league_avg_draw_rate = 0.3
  } = match

  // 1. Base probability (Poisson)
  const baseProb = poissonDrawProbability(home_xg, away_xg)

  // 2. Market probability
  const marketProb = marketProbability(draw_odds)

  // 3. Edge (VALUE)
  const edge = baseProb - marketProb

  // 4. Parity boost
  const parityScore = parity(home_odds, away_odds)
  const parityBoost = parityScore * 0.05

  // 5. League boost
  let leagueBoost = 0
  if (league_avg_draw_rate >= 0.40) leagueBoost = 0.06
  else if (league_avg_draw_rate >= 0.35) leagueBoost = 0.04
  else if (league_avg_draw_rate >= 0.32) leagueBoost = 0.02

  // 6. Low scoring boost (IMPORTANT)
  const totalXG = home_xg + away_xg
  let lowScoreBoost = 0
  if (totalXG <= 2.2) lowScoreBoost = 0.05
  else if (totalXG <= 2.6) lowScoreBoost = 0.03

  // 7. Odds sweet spot boost
  let oddsBoost = 0
  if (draw_odds >= 2.8 && draw_odds <= 3.6) oddsBoost = 0.04

  // ------------------------------
  // FINAL PROBABILITY
  // ------------------------------

  let finalProb =
    baseProb +
    parityBoost +
    leagueBoost +
    lowScoreBoost +
    oddsBoost

  // clamp
  finalProb = Math.min(Math.max(finalProb, 0), 0.95)

  // ------------------------------
  // CONFIDENCE (0–100)
  // ------------------------------

  let confidence = finalProb * 100

  // edge boost (VERY IMPORTANT)
  if (edge > 0.05) confidence += 5
  if (edge > 0.08) confidence += 8

  confidence = Math.min(confidence, 99)

  // ------------------------------
  // SCORE (0–10)
  // ------------------------------

  let score = 0

  if (baseProb >= 0.25) score += 3
  if (parityScore >= 0.7) score += 2
  if (league_avg_draw_rate >= 0.35) score += 2
  if (totalXG <= 2.5) score += 2
  if (draw_odds >= 2.8 && draw_odds <= 3.6) score += 1

  score = Math.min(score, 10)

  return {
    probability: finalProb,
    confidence: Math.round(confidence),
    edge,
    score
  }
}