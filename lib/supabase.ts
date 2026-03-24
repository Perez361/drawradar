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
  result?: string | null
  home_team_ext_id?: number | null
  away_team_ext_id?: number | null
  league_ext_id?: number | null
  has_real_team_stats?: boolean
  // Form fields
  home_form_draw_rate?: number | null
  away_form_draw_rate?: number | null
  home_form_goals_avg?: number | null
  away_form_goals_avg?: number | null
  home_games_last14?: number | null
  away_games_last14?: number | null
  // Odds movement
  odds_open?: number | null
  odds_movement?: number | null
  leagues?: {
    name: string
    country: string
    avg_draw_rate: number
    draw_boost: number
  } | null
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
  matches: Match & { leagues: { name: string; country: string; avg_draw_rate: number; draw_boost: number } }
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

// ─── Market implied probability ───────────────────────────────────────────────

export function impliedProbability(odds: number): number {
  return Math.round((1 / odds) * 100)
}

// ─── Score → confidence percentage ───────────────────────────────────────────

export function scoreToConfidence(score: number): number {
  const rounded = Math.round(score)
  const map: Record<number, number> = {
    10: 85, 9: 80, 8: 75, 7: 68, 6: 60,
    5: 52,  4: 44, 3: 36, 2: 28, 1: 20, 0: 15,
  }
  return map[rounded] ?? 20
}