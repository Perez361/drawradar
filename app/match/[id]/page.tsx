import { supabase, calculateDrawProbability, impliedProbability } from '@/lib/supabase'
import Link from 'next/link'
import { notFound } from 'next/navigation'

export default async function MatchPage({ params }: { params: { id: string } }) {
  const { data: match } = await supabase
    .from('matches')
    .select('*, leagues(name, country, avg_draw_rate, draw_boost)')
    .eq('id', params.id)
    .single()

  if (!match) notFound()

  const league = (match as any).leagues
  const poissonProb = calculateDrawProbability(match.xg_home, match.xg_away)
  const impliedProb = impliedProbability(match.draw_odds)

  const stats = [
    { label: 'Home draw rate', home: `${Math.round(match.home_draw_rate * 100)}%`, away: `${Math.round(match.away_draw_rate * 100)}%` },
    { label: 'Goals scored avg', home: match.home_goals_avg.toFixed(1), away: match.away_goals_avg.toFixed(1) },
    { label: 'Goals conceded avg', home: match.home_concede_avg.toFixed(1), away: match.away_concede_avg.toFixed(1) },
    { label: 'Expected goals (xG)', home: match.xg_home.toFixed(2), away: match.xg_away.toFixed(2) },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--radar-bg)' }}>
      <header
        className="border-b px-6 py-4"
        style={{ borderColor: 'var(--radar-border)', background: 'var(--radar-surface)' }}
      >
        <Link href="/" className="text-sm flex items-center gap-2 no-underline" style={{ color: 'var(--radar-green)' }}>
          ← Back to predictions
        </Link>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10">
        {/* Match header */}
        <div
          className="rounded-xl p-8 mb-6 text-center"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <p className="text-xs mb-3" style={{ color: 'var(--radar-muted)' }}>{league?.name} · {new Date(match.match_date).toLocaleString('en-GB')}</p>
          <h1 className="text-3xl font-bold mb-1">{match.home_team_name}</h1>
          <p className="text-xl mb-1" style={{ color: 'var(--radar-muted)' }}>vs</p>
          <h1 className="text-3xl font-bold mb-6">{match.away_team_name}</h1>

          <div className="grid grid-cols-3 gap-4">
            <div className="rounded-lg p-4" style={{ background: 'var(--radar-bg)' }}>
              <p className="text-2xl font-bold" style={{ color: 'var(--radar-green)' }}>{match.confidence}%</p>
              <p className="text-xs mt-1" style={{ color: 'var(--radar-muted)' }}>Confidence</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--radar-bg)' }}>
              <p className="text-2xl font-bold">{match.draw_score}<span className="text-base font-normal text-gray-500">/10</span></p>
              <p className="text-xs mt-1" style={{ color: 'var(--radar-muted)' }}>Draw score</p>
            </div>
            <div className="rounded-lg p-4" style={{ background: 'var(--radar-bg)' }}>
              <p className="text-2xl font-bold">{match.draw_odds.toFixed(2)}</p>
              <p className="text-xs mt-1" style={{ color: 'var(--radar-muted)' }}>Draw odds</p>
            </div>
          </div>
        </div>

        {/* Probabilities */}
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <h2 className="font-semibold mb-4">Draw probability breakdown</h2>
          {[
            { label: 'Poisson model (xG-based)', value: Math.round(poissonProb * 100), color: '#00ff87' },
            { label: 'Market implied probability', value: impliedProb, color: '#f59e0b' },
            { label: 'H2H draw rate', value: Math.round(match.h2h_draw_rate * 100), color: '#818cf8' },
            { label: 'League average draw rate', value: Math.round((league?.avg_draw_rate ?? 0.25) * 100), color: '#6b7a8d' },
          ].map((item) => (
            <div key={item.label} className="mb-4">
              <div className="flex justify-between text-sm mb-1">
                <span style={{ color: 'var(--radar-muted)' }}>{item.label}</span>
                <span className="font-semibold" style={{ color: item.color }}>{item.value}%</span>
              </div>
              <div className="confidence-bar">
                <div className="confidence-bar-fill" style={{ width: `${item.value}%`, background: item.color }} />
              </div>
            </div>
          ))}
        </div>

        {/* Team stats */}
        <div
          className="rounded-xl p-6 mb-6"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <h2 className="font-semibold mb-4">Team comparison</h2>
          <div className="grid grid-cols-3 gap-0 text-center mb-2">
            <div className="text-sm font-semibold">{match.home_team_name}</div>
            <div />
            <div className="text-sm font-semibold">{match.away_team_name}</div>
          </div>
          {stats.map((s) => (
            <div key={s.label} className="grid grid-cols-3 items-center py-3" style={{ borderTop: '1px solid var(--radar-border)' }}>
              <div className="text-sm font-semibold text-left" style={{ color: 'var(--radar-green)' }}>{s.home}</div>
              <div className="text-xs text-center" style={{ color: 'var(--radar-muted)' }}>{s.label}</div>
              <div className="text-sm font-semibold text-right" style={{ color: 'var(--radar-green)' }}>{s.away}</div>
            </div>
          ))}
          <div className="grid grid-cols-3 items-center py-3" style={{ borderTop: '1px solid var(--radar-border)' }}>
            <div />
            <div className="text-xs text-center" style={{ color: 'var(--radar-muted)' }}>H2H draw rate</div>
            <div className="text-sm font-semibold text-right" style={{ color: '#818cf8' }}>{Math.round(match.h2h_draw_rate * 100)}%</div>
          </div>
        </div>

        {/* Disclaimer */}
        <p className="text-xs text-center" style={{ color: 'var(--radar-muted)' }}>
          Predictions are based on statistical models. Past draw rates do not guarantee future results.
          Always gamble responsibly.
        </p>
      </main>
    </div>
  )
}
