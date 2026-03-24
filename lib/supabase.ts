import { createClient } from '@supabase/supabase-js'

const supabaseUrl      = process.env.NEXT_PUBLIC_SUPABASE_URL!
const supabaseAnonKey  = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY!

// Public client — reads, frontend safe
export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// Admin client — bypasses RLS, server-side only
export const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey)

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
  // Per-team stats provenance — added by team-stats-cache migration
  home_team_ext_id?: number | null
  away_team_ext_id?: number | null
  league_ext_id?: number | null
  has_real_team_stats?: boolean
  leagues?: {
    name: string
    country: string
    avg_draw_rate: number
    draw_boost: number
  }
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
//
// With team-stats caching live, home_draw_rate, away_draw_rate, home_goals_avg,
// away_goals_avg, xg_home, and xg_away are now per-team rather than league-wide
// baselines, making scores meaningfully different between matches in the same league.

export function calculateDrawScore(match: Match): number {
  let score = 0

  // 1. Team strength parity — how close their scoring averages are (2 pts)
  const goalsDiff = Math.abs(match.home_goals_avg - match.away_goals_avg)
  if (goalsDiff < 0.3)      score += 2
  else if (goalsDiff < 0.6) score += 1

  // 2. Low-scoring tendency — draws happen more in tight, low-goal games (2 pts)
  if (match.home_goals_avg < 1.5 && match.away_goals_avg < 1.5)      score += 2
  else if (match.home_goals_avg < 1.8 && match.away_goals_avg < 1.8) score += 1

  // 3. Historical draw rate for each team (2 pts)
  if (match.home_draw_rate > 0.35 && match.away_draw_rate > 0.35)      score += 2
  else if (match.home_draw_rate > 0.28 && match.away_draw_rate > 0.28) score += 1

  // 4. Head-to-head draw rate (1 pt)
  // With team-stats caching: this is the blend of both teams' draw rates.
  // When H2H endpoint is wired: replace with actual H2H draw rate.
  if (match.h2h_draw_rate > 0.38)      score += 1
  else if (match.h2h_draw_rate > 0.28) score += 0.5

  // 5. xG balance — evenly-matched expected goals = more likely draw (1 pt)
  const xgDiff = Math.abs(match.xg_home - match.xg_away)
  if (xgDiff < 0.2)      score += 1
  else if (xgDiff < 0.4) score += 0.5

  // 6. Draw odds sweet spot (2 pts) — bookmakers agree draw is plausible
  if (match.draw_odds >= 2.8 && match.draw_odds <= 3.6)     score += 2
  else if (match.draw_odds > 3.6 && match.draw_odds <= 4.0) score += 1

  // 7. Manual league boost from DB (default 0)
  if (match.leagues?.draw_boost) score += match.leagues.draw_boost

  return Math.min(10, Math.round(score * 10) / 10)
}

// ─── Score → confidence percentage ───────────────────────────────────────────

export function scoreToConfidence(score: number): number {
  // Round to nearest integer before lookup — score can be fractional (0.5 steps)
  const rounded = Math.round(score)
  const map: Record<number, number> = {
    10: 85,
     9: 80,
     8: 75,
     7: 68,
     6: 60,
     5: 52,
     4: 44,
     3: 36,
     2: 28,
     1: 20,
     0: 15,
  }
  return map[rounded] ?? 20
}

// ─── Market implied probability ───────────────────────────────────────────────

export function impliedProbability(odds: number): number {
  return Math.round((1 / odds) * 100)
}