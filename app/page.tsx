export const revalidate = 0
export const dynamic = 'force-dynamic'

import { supabaseAdmin, impliedProbability } from '@/lib/supabase'
import type { Prediction } from '@/lib/supabase'
import Link from 'next/link'

const LEAGUE_FLAGS: Record<string, string> = {
  'Premier League':             '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Championship':               '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'League One':                 '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'League Two':                 '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'National League':            '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'La Liga':                    '🇪🇸',
  'Segunda División':           '🇪🇸',
  'Serie A':                    '🇮🇹',
  'Serie B':                    '🇮🇹',
  'Bundesliga':                 '🇩🇪',
  '2. Bundesliga':              '🇩🇪',
  'Ligue 1':                    '🇫🇷',
  'Ligue 2':                    '🇫🇷',
  'Eredivisie':                 '🇳🇱',
  'Primeira Liga':              '🇵🇹',
  'Süper Lig':                  '🇹🇷',
  'Pro League':                 '🇧🇪',
  'Premiership':                '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
}

const COUNTRY_FLAGS: Record<string, string> = {
  'England':        '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Scotland':       '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'Spain':          '🇪🇸',
  'Italy':          '🇮🇹',
  'Germany':        '🇩🇪',
  'France':         '🇫🇷',
  'Netherlands':    '🇳🇱',
  'Portugal':       '🇵🇹',
  'Turkey':         '🇹🇷',
  'Belgium':        '🇧🇪',
  'Greece':         '🇬🇷',
  'Sweden':         '🇸🇪',
  'Norway':         '🇳🇴',
  'Denmark':        '🇩🇰',
  'Poland':         '🇵🇱',
  'Czech Republic':  '🇨🇿',
  'Serbia':         '🇷🇸',
  'Romania':        '🇷🇴',
  'Croatia':        '🇭🇷',
  'Russia':         '🇷🇺',
  'Ukraine':        '🇺🇦',
  'Austria':        '🇦🇹',
  'Switzerland':    '🇨🇭',
  'Nigeria':        '🇳🇬',
  'Egypt':          '🇪🇬',
  'Morocco':        '🇲🇦',
  'South Africa':    '🇿🇦',
  'Ghana':          '🇬🇭',
  'Brazil':         '🇧🇷',
  'Argentina':      '🇦🇷',
  'Mexico':         '🇲🇽',
  'USA':            '🇺🇸',
  'Chile':          '🇨🇱',
  'Colombia':       '🇨🇴',
  'Ecuador':        '🇪🇨',
  'Uruguay':        '🇺🇾',
  'Saudi Arabia':    '🇸🇦',
  'Qatar':          '🇶🇦',
  'Japan':          '🇯🇵',
  'South Korea':     '🇰🇷',
  'India':          '🇮🇳',
  'China':          '🇨🇳',
  'Australia':      '🇦🇺',
  // Africa
  'Senegal':        '🇸🇳',
  'Kenya':          '🇰🇪',
  'Ivory Coast':    '🇨🇮',
  'Cameroon':       '🇨🇲',
  'Tanzania':       '🇹🇿',
  'Uganda':         '🇺🇬',
  'Zimbabwe':       '🇿🇼',
  'Zambia':         '🇿🇲',
  'Ethiopia':       '🇪🇹',
  'Rwanda':         '🇷🇼',
  'Libya':          '🇱🇾',
  'Sudan':          '🇸🇩',
  'Angola':         '🇦🇴',
  'DR Congo':       '🇨🇩',
  'Mali':           '🇲🇱',
  'Burkina Faso':   '🇧🇫',
  'Botswana':       '🇧🇼',
  // Americas
  'Canada':         '🇨🇦',
  'Costa Rica':     '🇨🇷',
  'Guatemala':      '🇬🇹',
  'Honduras':       '🇭🇳',
  'El Salvador':    '🇸🇻',
  'Panama':         '🇵🇦',
  'Jamaica':        '🇯🇲',
  'Trinidad and Tobago': '🇹🇹',
  'Bolivia':        '🇧🇴',
  'Paraguay':       '🇵🇾',
  'Peru':           '🇵🇪',
  'Venezuela':      '🇻🇪',
  // Asia
  'Iran':           '🇮🇷',
  'Iraq':           '🇮🇶',
  'Jordan':         '🇯🇴',
  'Lebanon':        '🇱🇧',
  'Syria':          '🇸🇾',
  'Kuwait':         '🇰🇼',
  'Bahrain':        '🇧🇭',
  'Oman':           '🇴🇲',
  'Thailand':       '🇹🇭',
  'Vietnam':        '🇻🇳',
  'Malaysia':       '🇲🇾',
  'Singapore':      '🇸🇬',
  'Philippines':    '🇵🇭',
  'Uzbekistan':     '🇺🇿',
  'Kazakhstan':     '🇰🇿',
  // Europe
  'Slovakia':       '🇸🇰',
  'Hungary':        '🇭🇺',
  'Bulgaria':       '🇧🇬',
  'Slovenia':       '🇸🇮',
  'Bosnia':         '🇧🇦',
  'North Macedonia':'🇲🇰',
  'Albania':        '🇦🇱',
  'Kosovo':         '🇽🇰',
  'Montenegro':     '🇲🇪',
  'Israel':         '🇮🇱',
  'Cyprus':         '🇨🇾',
  'Belarus':        '🇧🇾',
  'Lithuania':      '🇱🇹',
  'Latvia':         '🇱🇻',
  'Estonia':        '🇪🇪',
  'Iceland':        '🇮🇸',
  'Ireland':        '🇮🇪',
  'Northern Ireland': '🇬🇧',
  'Armenia':        '🇦🇲',
  'Azerbaijan':     '🇦🇿',
  'Moldova':        '🇲🇩',
}

function getLeagueFlag(leagueName: string, country: string): string {
  return COUNTRY_FLAGS[country] ?? LEAGUE_FLAGS[leagueName] ?? '⚽'
}

function ConfidenceBar({ value }: { value: number }) {
  const color =
    value >= 75 ? '#00ff87' :
    value >= 60 ? '#f59e0b' :
    '#ef4444'
  return (
    <div className="confidence-bar w-full mt-1">
      <div className="confidence-bar-fill" style={{ width: `${value}%`, background: color }} />
    </div>
  )
}

function RankBadge({ rank }: { rank: number }) {
  const cls = rank <= 3 ? `rank-${rank}` : 'text-gray-400'
  return <span className={`text-2xl font-bold tabular-nums ${cls}`}>#{rank}</span>
}

function OddsBadge({ odds }: { odds: number }) {
  if (!odds || odds <= 0) return null
  const implied = impliedProbability(odds)
  const isSweet = odds >= 2.8 && odds <= 3.6
  return (
    <div className="flex flex-col items-end gap-0.5">
      <span
        className="text-sm font-semibold px-2 py-0.5 rounded"
        style={{
          background: isSweet ? 'rgba(0,255,135,0.12)' : 'rgba(255,255,255,0.06)',
          color: isSweet ? '#00ff87' : '#9ca3af',
          border: `1px solid ${isSweet ? 'rgba(0,255,135,0.25)' : 'rgba(255,255,255,0.08)'}`,
        }}
      >
        {odds.toFixed(2)}
      </span>
      <span className="text-xs" style={{ color: '#6b7a8d' }}>
        {implied}% implied
        {isSweet && <span style={{ color: '#00ff87' }}> ✓</span>}
      </span>
    </div>
  )
}

export default async function HomePage() {
  const now = new Date()
  // Use UTC date to match what the pipeline stores
  const today = [
    now.getUTCFullYear(),
    String(now.getUTCMonth() + 1).padStart(2, '0'),
    String(now.getUTCDate()).padStart(2, '0'),
  ].join('-')

  const formattedDate = now.toLocaleDateString('en-GB', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    timeZone: 'UTC',
  })

  // Use supabaseAdmin to bypass RLS — same as /api/predictions
  const { data: predictions, error } = await supabaseAdmin
    .from('predictions')
    .select(`*, matches(*, leagues(name, country, avg_draw_rate, draw_boost))`)
    .eq('prediction_date', today)
    .order('rank', { ascending: true })
    .limit(10)

  if (error) {
    console.error('[homepage] predictions query error:', error.message)
  }

  const preds = (predictions ?? []) as Prediction[]

  const avgConfidence = preds.length
    ? Math.round(preds.reduce((s, p) => s + (p.confidence ?? 0), 0) / preds.length)
    : 0
  const topConfidence = preds[0]?.confidence ?? 0

  return (
    <div className="min-h-screen" style={{ background: 'var(--radar-bg)' }}>
      <header
        className="border-b px-6 py-4 flex items-center justify-between"
        style={{ borderColor: 'var(--radar-border)', background: 'var(--radar-surface)' }}
      >
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div
              className="w-8 h-8 rounded-full flex items-center justify-center radar-pulse relative z-10"
              style={{ background: 'rgba(0,255,135,0.15)', border: '1.5px solid var(--radar-green)' }}
            >
              <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
                <circle cx="7" cy="7" r="6" stroke="#00ff87" strokeWidth="1.5"/>
                <circle cx="7" cy="7" r="3" stroke="#00ff87" strokeWidth="1" opacity="0.5"/>
                <line x1="7" y1="7" x2="12" y2="4" stroke="#00ff87" strokeWidth="1.5" strokeLinecap="round"/>
              </svg>
            </div>
          </div>
          <div>
            <h1 className="text-lg font-bold tracking-tight" style={{ color: 'var(--radar-green)' }}>DrawRadar</h1>
            <p className="text-xs" style={{ color: 'var(--radar-muted)' }}>Draw Prediction Engine</p>
          </div>
        </div>
        <nav className="hidden md:flex items-center gap-6 text-sm" style={{ color: 'var(--radar-muted)' }}>
          <a href="#" className="hover:text-white transition-colors">Predictions</a>
          <a href="#" className="hover:text-white transition-colors">Statistics</a>
          <a href="#" className="hover:text-white transition-colors">How it works</a>
          <button
            className="px-4 py-1.5 rounded text-sm font-medium transition-all"
            style={{
              background: 'rgba(0,255,135,0.1)',
              color: 'var(--radar-green)',
              border: '1px solid rgba(0,255,135,0.25)',
            }}
          >
            VIP Access
          </button>
        </nav>
      </header>

      <main className="max-w-5xl mx-auto px-4 py-10">
        <div className="mb-10">
          <p className="text-sm mb-1" style={{ color: 'var(--radar-muted)' }}>{formattedDate}</p>
          <h2 className="text-3xl font-bold mb-2 tracking-tight">Today&apos;s Top Draw Predictions</h2>
          <p className="text-sm mb-8" style={{ color: 'var(--radar-muted)' }}>
            Powered by Poisson model · 10-point scoring system · Updated daily at 07:00 UTC
          </p>

          <div className="grid grid-cols-3 gap-4 mb-10">
            {[
              { label: 'Matches analysed',   value: preds.length.toString() },
              { label: 'Avg confidence',      value: `${avgConfidence}%` },
              { label: 'Top pick confidence', value: `${topConfidence}%` },
            ].map((stat) => (
              <div
                key={stat.label}
                className="rounded-xl p-5 text-center"
                style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
              >
                <p className="text-2xl font-bold" style={{ color: 'var(--radar-green)' }}>{stat.value}</p>
                <p className="text-xs mt-1" style={{ color: 'var(--radar-muted)' }}>{stat.label}</p>
              </div>
            ))}
          </div>
        </div>

        {preds.length === 0 ? (
          <div
            className="rounded-xl p-12 text-center"
            style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
          >
            <p className="text-lg mb-2">No predictions yet for today</p>
            <p className="text-sm mb-4" style={{ color: 'var(--radar-muted)' }}>
              Predictions are generated daily at 07:00 UTC
            </p>
            <p className="text-xs" style={{ color: 'var(--radar-muted)' }}>
              Date queried: <code>{today}</code>
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {preds.map((pred) => {
              const m      = pred.matches
              if (!m) return null
              const league = m.leagues
              const flag   = getLeagueFlag(league?.name ?? '', league?.country ?? '')
              const isTop3 = pred.rank <= 3
              const drawScore = pred.draw_score ?? 0
              const drawOdds  = pred.draw_odds ?? 0

              return (
                <Link
                  key={pred.id}
                  href={`/match/${m.id}`}
                  className="prediction-card block rounded-xl p-5 cursor-pointer no-underline"
                  style={{
                    background: isTop3 ? 'var(--radar-surface-2)' : 'var(--radar-surface)',
                    border: `1px solid ${isTop3 ? 'rgba(0,255,135,0.12)' : 'var(--radar-border)'}`,
                  }}
                >
                  <div className="flex items-center gap-4">
                    <div className="w-10 text-center flex-shrink-0">
                      <RankBadge rank={pred.rank} />
                    </div>

                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-sm">{flag}</span>
                        <span
                          className="text-xs px-2 py-0.5 rounded"
                          style={{ background: 'rgba(255,255,255,0.06)', color: 'var(--radar-muted)' }}
                        >
                          {league?.name}
                          {league?.country ? ` · ${league.country}` : ''}
                        </span>
                        <span className="text-xs" style={{ color: 'var(--radar-muted)' }}>
                          {new Date(m.match_date).toLocaleTimeString('en-GB', {
                            hour: '2-digit', minute: '2-digit', timeZone: 'UTC'
                          })}
                        </span>
                      </div>
                      <p className="font-semibold text-base truncate">
                        {m.home_team_name}
                        <span style={{ color: 'var(--radar-muted)' }}> vs </span>
                        {m.away_team_name}
                      </p>
                      <div className="mt-2 flex items-center gap-3">
                        <div className="flex-1 max-w-xs">
                          <ConfidenceBar value={pred.confidence ?? 0} />
                        </div>
                        <span className="text-xs font-medium" style={{ color: 'var(--radar-green)' }}>
                          {pred.confidence ?? 0}% confidence
                        </span>
                      </div>
                    </div>

                    <div className="flex flex-col items-end gap-2 flex-shrink-0">
                      {drawOdds > 0 && <OddsBadge odds={drawOdds} />}
                      <div className="flex items-center gap-1">
                        <span className="text-xs" style={{ color: 'var(--radar-muted)' }}>Score:</span>
                        <span
                          className="text-sm font-bold"
                          style={{
                            color: drawScore >= 8 ? '#00ff87' : drawScore >= 6 ? '#f59e0b' : '#9ca3af'
                          }}
                        >
                          {drawScore.toFixed(1)}/10
                        </span>
                      </div>
                    </div>
                  </div>
                </Link>
              )
            })}
          </div>
        )}

        <div
          className="mt-12 rounded-xl p-6"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <h3 className="font-semibold mb-4 text-sm uppercase tracking-wider" style={{ color: 'var(--radar-muted)' }}>
            How DrawRadar scores matches
          </h3>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            {[
              { label: 'Team strength parity',  pts: '2pts' },
              { label: 'Low-scoring tendency',  pts: '2pts' },
              { label: 'Historical draw rate',  pts: '2pts' },
              { label: 'Draw odds sweet spot',  pts: '2pts' },
              { label: 'H2H draw history',      pts: '1pt'  },
              { label: 'xG balance',            pts: '1pt'  },
            ].map((item) => (
              <div key={item.label} className="flex items-center justify-between">
                <span className="text-sm" style={{ color: 'var(--radar-muted)' }}>{item.label}</span>
                <span
                  className="text-xs font-bold ml-2 px-1.5 py-0.5 rounded"
                  style={{ background: 'rgba(0,255,135,0.1)', color: 'var(--radar-green)' }}
                >
                  {item.pts}
                </span>
              </div>
            ))}
          </div>
          <p className="text-xs mt-4" style={{ color: 'var(--radar-muted)' }}>
            Combined with a Poisson distribution model using expected goals (xG) data.
            Draw odds in the 2.80–3.60 range indicate bookmaker consensus on draw likelihood.
          </p>
        </div>
      </main>

      <footer
        className="border-t mt-16 py-8 text-center text-sm"
        style={{ borderColor: 'var(--radar-border)', color: 'var(--radar-muted)' }}
      >
        <p>DrawRadar · For informational purposes only · Predictions are not financial advice</p>
      </footer>
    </div>
  )
}