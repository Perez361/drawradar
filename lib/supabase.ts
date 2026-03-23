import { createClient } from '@supabase/supabase-js'

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Match {
  id: number
  league_id: number
  home_team_name: string
  away_team_name: string
  match_date: string
  home_goals_avg: number
  away_goals_avg: number
  home_concede_avg: number
  away_concede_avg: number
  home_draw_rate: number
  away_draw_rate: number
  h2h_draw_rate: number
  draw_odds: number
  xg_home: number
  xg_away: number
  draw_score: number
  draw_probability: number
  confidence: number
  status: string
  result?: string
  leagues?: { name: string; country: string; avg_draw_rate: number; draw_boost: number }
}

export interface Prediction {
  id: number
  match_id: number
  prediction_date: string
  rank: number
  draw_score: number
  draw_probability: number
  confidence: number
  draw_odds: number
  was_correct: boolean | null
  matches: Match & { leagues: { name: string; country: string } }
}

// ─── Poisson model ────────────────────────────────────────────────────────────

function factorial(n: number): number {
  if (n <= 1) return 1
  return n * factorial(n - 1)
}

function poisson(lambda: number, k: number): number {
  return (Math.pow(lambda, k) * Math.exp(-lambda)) / factorial(k)
}

export function calculateDrawProbability(xgHome: number, xgAway: number): number {
  let drawProb = 0
  for (let g = 0; g <= 5; g++) {
    drawProb += poisson(xgHome, g) * poisson(xgAway, g)
  }
  return Math.round(drawProb * 100) / 100
}

// ─── Draw scoring algorithm (0–10) ───────────────────────────────────────────

export function calculateDrawScore(match: Match): number {
  let score = 0

  // Team strength similarity (based on goals avg difference)
  const goalsDiff = Math.abs(match.home_goals_avg - match.away_goals_avg)
  if (goalsDiff < 0.3) score += 2
  else if (goalsDiff < 0.6) score += 1

  // Low-scoring teams (under 1.5 goals avg each)
  if (match.home_goals_avg < 1.5 && match.away_goals_avg < 1.5) score += 2
  else if (match.home_goals_avg < 1.8 && match.away_goals_avg < 1.8) score += 1

  // High draw rate for both teams
  if (match.home_draw_rate > 0.35 && match.away_draw_rate > 0.35) score += 2
  else if (match.home_draw_rate > 0.28 && match.away_draw_rate > 0.28) score += 1

  // Head-to-head draw rate
  if (match.h2h_draw_rate > 0.38) score += 1
  else if (match.h2h_draw_rate > 0.28) score += 0.5

  // Similar xG (evenly-matched attack)
  const xgDiff = Math.abs(match.xg_home - match.xg_away)
  if (xgDiff < 0.2) score += 1
  else if (xgDiff < 0.4) score += 0.5

  // Draw odds in the sweet spot (2.80–3.60)
  if (match.draw_odds >= 2.8 && match.draw_odds <= 3.6) score += 2
  else if (match.draw_odds >= 3.6 && match.draw_odds <= 4.0) score += 1

  // League draw bias bonus
  if (match.leagues?.draw_boost) score += match.leagues.draw_boost

  return Math.min(10, Math.round(score * 10) / 10)
}

// ─── Score → confidence percentage ───────────────────────────────────────────

export function scoreToConfidence(score: number): number {
  const map: Record<number, number> = {
    10: 85, 9: 80, 8: 75, 7: 68, 6: 60, 5: 52, 4: 44, 3: 36, 2: 28, 1: 20
  }
  return map[Math.round(score)] ?? 20
}

// ─── Market implied probability ───────────────────────────────────────────────

export function impliedProbability(odds: number): number {
  return Math.round((1 / odds) * 100)
}
