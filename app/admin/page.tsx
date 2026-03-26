'use client'

import { useState, useEffect } from 'react'

// ── Existing types (kept exactly as-is) ──────────────────────────────────────
type Status = 'idle' | 'loading' | 'success' | 'error'

interface PipelineResult {
  success?: boolean
  fetched?: number
  predictions?: number
  top_pick?: string | null
  error?: string
}

interface LogLine {
  ts: string
  msg: string
  type: 'info' | 'success' | 'error'
}

interface SignalImpact {
  count: number
  hitRate: number | null
  label?: string
  range?: string
}

interface AccuracyData {
  hitRate: number
  highConfHitRate: number
  totalEvaluated: number
  correct: number
  highConfTotal: number
  highConfCorrect: number
  unevaluated: number
  calibration: {
    plattA: number
    plattB: number
    sampleCount: number
    calibratedAt: string
    isIdentity: boolean
  } | null
  signalImpact: {
    realH2H: SignalImpact
    estimatedH2H: SignalImpact
    withForm: SignalImpact
    withoutForm: SignalImpact
    sweetSpotOdds: SignalImpact & { range: string }
    fatigueHigh?: SignalImpact
    midRangeOdds?: SignalImpact & { range: string }
    realTeamStats?: SignalImpact
  }
  reliabilityBuckets: Array<{
    scoreRange: string
    count: number
    actualHitRate: number
    predictedHitRate: number
  }>
  perLeague: Array<{
    league: string
    hitRate: number
    count: number
  }>
}

interface AllSportsResult {
  success?: boolean
  date?: string
  fetched?: number
  tracked?: number
  upserted?: number
  skippedNoOdds?: number
  skippedOddsRange?: number
  message?: string
  error?: string
}

interface TSDBResult {
  success?: boolean
  date?: string
  matchesFound?: number
  leaguesProcessed?: number
  teamsCoveredByTable?: number
  enriched?: number
  skipped?: number
  leagueDrawRatesUpdated?: number
  requestsUsed?: number
  budget?: { used: number; remaining: number; resetIn: number }
  message?: string
  error?: string
}

// ── New scraper types ─────────────────────────────────────────────────────────

interface ScraperRun {
  id: number
  source: string
  run_type: string
  status: 'running' | 'done' | 'error'
  records_upserted: number
  error_message: string | null
  started_at: string
  finished_at: string | null
}

interface ScraperStatus {
  scraperRuns: ScraperRun[]
  stats: {
    rawXgTotal: number
    rawXgLinked: number
    oddsSnapshots: number
    matchesWithXg: number
  }
}

interface XgResult {
  success?: boolean
  results?: { understat?: number; fbref?: number }
  totalRecords?: number
  errors?: number
  error?: string
}

interface OddsSnapshotResult {
  success?: boolean
  snapshots?: number
  error?: string
}

// ─────────────────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [status, setStatus]           = useState<Status>('idle')
  const [result, setResult]           = useState<PipelineResult | null>(null)
  const [logs, setLogs]               = useState<LogLine[]>([])
  const [accuracy, setAccuracy]       = useState<AccuracyData | null>(null)
  const [accStatus, setAccStatus]     = useState<Status>('idle')
  const [clearStatus, setClearStatus] = useState<Status>('idle')
  const [calStatus, setCalStatus]     = useState<Status>('idle')
  const [calResult, setCalResult]     = useState<any>(null)
  const [showLeague, setShowLeague]   = useState(false)
  const [asStatus, setAsStatus]       = useState<Status>('idle')
  const [asResult, setAsResult]       = useState<AllSportsResult | null>(null)
  const [tsdbStatus, setTsdbStatus]   = useState<Status>('idle')
  const [tsdbResult, setTsdbResult]   = useState<TSDBResult | null>(null)

  // New scraper state
  const [scraperStatus, setScraperStatus]     = useState<ScraperStatus | null>(null)
  const [xgStatus, setXgStatus]               = useState<Status>('idle')
  const [xgResult, setXgResult]               = useState<XgResult | null>(null)
  const [oddsSnapStatus, setOddsSnapStatus]   = useState<Status>('idle')
  const [oddsSnapResult, setOddsSnapResult]   = useState<OddsSnapshotResult | null>(null)

  function addLog(msg: string, type: LogLine['type'] = 'info') {
    const ts = new Date().toLocaleTimeString('en-GB')
    setLogs((prev) => [...prev, { ts, msg, type }])
  }

  // Load scraper status on mount
  useEffect(() => { loadScraperStatus() }, [])

  async function loadScraperStatus() {
    try {
      const res = await fetch('/api/admin/scraper-status')
      const data = await res.json()
      if (!data.error) setScraperStatus(data)
    } catch { /* silent */ }
  }

  async function runPipeline() {
    setStatus('loading')
    setResult(null)
    setLogs([])
    addLog('Calling /api/trigger-predictions …')
    try {
      const res  = await fetch('/api/trigger-predictions')
      const data = await res.json() as PipelineResult
      if (!res.ok || data.error) {
        addLog(`Error: ${data.error ?? res.statusText}`, 'error')
        setResult(data); setStatus('error'); return
      }
      addLog(`Fetched ${data.fetched} matches from API-Football`, 'info')
      addLog(`Generated ${data.predictions} predictions`, 'info')
      if (data.top_pick) addLog(`Top pick: ${data.top_pick}`, 'success')
      addLog('Done — reload the home page to see results ✓', 'success')
      setResult(data); setStatus('success')
    } catch (err) {
      addLog(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setStatus('error')
    }
  }

  async function clearOldData() {
    setClearStatus('loading')
    addLog('Clearing old seed data …')
    try {
      const res  = await fetch('/api/admin/clear-old-data', { method: 'POST' })
      const data = await res.json()
      if (!res.ok || data.error) {
        addLog(`Clear failed: ${data.error ?? res.statusText}`, 'error')
        setClearStatus('error'); return
      }
      addLog('Old predictions + matches cleared ✓', 'success')
      setClearStatus('success')
    } catch (err) {
      addLog(`Network error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setClearStatus('error')
    }
  }

  async function fetchAllSports() {
    setAsStatus('loading')
    setAsResult(null)
    addLog('Fetching AllSportsAPI fixtures + odds …')
    try {
      const res  = await fetch('/api/admin/allsports-fixtures')
      const data = await res.json() as AllSportsResult
      setAsResult(data)
      if (data.error) {
        addLog(`AllSports error: ${data.error}`, 'error')
        setAsStatus('error')
      } else {
        addLog(
          `AllSports done — fetched: ${data.fetched ?? 0}, tracked: ${data.tracked ?? 0}, ` +
          `upserted: ${data.upserted ?? 0}, no-odds: ${data.skippedNoOdds ?? 0}`,
          'success'
        )
        setAsStatus('success')
      }
    } catch (err) {
      addLog(`AllSports network error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setAsStatus('error')
    }
  }

  async function runTSDBEnrich() {
    setTsdbStatus('loading')
    setTsdbResult(null)
    addLog('Running TheSportsDB enrichment …')
    try {
      const res  = await fetch('/api/admin/tsdb-enrich')
      const data = await res.json() as TSDBResult
      setTsdbResult(data)
      if (data.error) {
        addLog(`TSDB error: ${data.error}`, 'error')
        setTsdbStatus('error')
      } else {
        addLog(`TSDB done — enriched: ${data.enriched ?? 0} matches`, 'success')
        setTsdbStatus('success')
      }
    } catch (err) {
      addLog(`TSDB network error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setTsdbStatus('error')
    }
  }

  async function runXgScraper() {
    setXgStatus('loading')
    setXgResult(null)
    addLog('Scraping xG from Understat + FBref …')
    try {
      const res  = await fetch('/api/admin/scrape-xg')
      const data = await res.json() as XgResult
      setXgResult(data)
      if (data.error) {
        addLog(`xG scraper error: ${data.error}`, 'error')
        setXgStatus('error')
      } else {
        addLog(
          `xG scrape done — understat: ${data.results?.understat ?? 0}, fbref: ${data.results?.fbref ?? 0} records`,
          'success'
        )
        setXgStatus('success')
        loadScraperStatus()
      }
    } catch (err) {
      addLog(`xG network error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setXgStatus('error')
    }
  }

  async function runOddsSnapshot() {
    setOddsSnapStatus('loading')
    setOddsSnapResult(null)
    addLog('Snapshotting draw odds from The-Odds-API …')
    try {
      const res  = await fetch('/api/admin/scrape-odds-snapshot')
      const data = await res.json() as OddsSnapshotResult
      setOddsSnapResult(data)
      if (data.error) {
        addLog(`Odds snapshot error: ${data.error}`, 'error')
        setOddsSnapStatus('error')
      } else {
        addLog(`Odds snapshot done — ${data.snapshots ?? 0} per-bookmaker snapshots saved`, 'success')
        setOddsSnapStatus('success')
        loadScraperStatus()
      }
    } catch (err) {
      addLog(`Odds snapshot error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setOddsSnapStatus('error')
    }
  }

  async function loadAccuracy() {
    setAccStatus('loading')
    try {
      const res  = await fetch('/api/model-accuracy')
      const data = await res.json()
      if (data.error) { addLog(`Accuracy error: ${data.error}`, 'error'); setAccStatus('error'); return }
      setAccuracy(data); setAccStatus('success')
    } catch (err) {
      addLog(`Accuracy load error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setAccStatus('error')
    }
  }

  async function updateAccuracy() {
    setAccStatus('loading')
    addLog('Updating accuracy via Supabase RPC …')
    try {
      const res = await fetch('/api/admin/update-accuracy', { method: 'POST' })
      if (res.ok) { addLog('Accuracy updated ✓'); loadAccuracy() }
      else { addLog('Update failed', 'error'); setAccStatus('error') }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setAccStatus('error')
    }
  }

  async function calibrateModel() {
    setCalStatus('loading')
    addLog('Fitting Platt scaling from was_correct data …')
    try {
      const res  = await fetch('/api/admin/calibrate-model', { method: 'POST' })
      const data = await res.json()
      setCalResult(data)
      if (data.success) {
        addLog(`Calibration done — a=${data.plattA}, b=${data.plattB} (${data.sampleCount} samples)`, 'success')
        setCalStatus('success')
      } else {
        addLog(data.message ?? 'Calibration failed', 'error')
        setCalStatus('error')
      }
    } catch (err) {
      addLog(`Error: ${err instanceof Error ? err.message : String(err)}`, 'error')
      setCalStatus('error')
    }
  }

  const logColor: Record<LogLine['type'], string> = {
    info: '#6b7a8d', success: '#00ff87', error: '#ef4444',
  }

  const surface = 'var(--radar-surface)'
  const border  = 'var(--radar-border)'
  const muted   = 'var(--radar-muted)'
  const green   = 'var(--radar-green)'
  const orange  = '#fb923c'
  const teal    = '#2dd4bf'
  const purple  = '#c084fc'
  const blue    = '#60a5fa'

  const buildSignalRows = (si: AccuracyData['signalImpact']) => {
    const rows: Array<{ label: string; count: number; hitRate: number | null }> = [
      { label: 'Real H2H data',   ...si.realH2H },
      { label: 'Estimated H2H',   ...si.estimatedH2H },
      { label: 'With form data',  ...si.withForm },
      { label: 'Without form',    ...si.withoutForm },
    ]
    if (si.fatigueHigh)   rows.push({ label: si.fatigueHigh.label ?? 'Avg ≥3 games/14d', ...si.fatigueHigh })
    if (si.realTeamStats) rows.push({ label: 'Real team stats', ...si.realTeamStats })
    return rows
  }

  const statusDot = (s: ScraperRun['status']) => ({
    running: { color: orange, label: 'running' },
    done:    { color: green,  label: 'done' },
    error:   { color: '#ef4444', label: 'error' },
  }[s])

  // Cron timeline
  const cronSteps = [
    { time: '05:00', label: 'xG scrape',    color: blue,   step: '0' },
    { time: '06:00', label: 'AllSports',    color: orange, step: '1b' },
    { time: '06:30', label: 'TSDB Enrich',  color: teal,   step: '1c' },
    { time: '07:00', label: 'Main pipeline',color: green,  step: '2'  },
    { time: '*/4h',  label: 'Odds snap',    color: purple, step: '∞'  },
  ]

  return (
    <div className="min-h-screen" style={{ background: 'var(--radar-bg)', color: 'var(--radar-text)' }}>
      <header className="border-b px-6 py-4 flex items-center gap-3"
        style={{ borderColor: border, background: surface }}>
        <a href="/" style={{ color: green, fontSize: 13 }}>← Home</a>
        <span style={{ color: border }}>|</span>
        <h1 className="text-base font-bold" style={{ color: green }}>DrawRadar — Dev Admin</h1>
        <span className="text-xs px-2 py-0.5 rounded"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}>
          LOCAL ONLY
        </span>
      </header>

      <main className="max-w-3xl mx-auto px-4 py-10 flex flex-col gap-6">

        {/* Daily cron timeline */}
        <section className="rounded-xl p-4" style={{ background: surface, border: `1px solid ${border}` }}>
          <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: muted }}>Daily cron schedule (UTC)</p>
          <div className="flex items-center gap-0">
            {cronSteps.map((s, i) => (
              <div key={s.step} className="flex items-center gap-0 flex-1">
                <div className="flex flex-col items-center">
                  <div className="w-2 h-2 rounded-full" style={{ background: s.color }} />
                  <p className="text-xs font-mono mt-1" style={{ color: s.color }}>{s.time}</p>
                  <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                </div>
                {i < cronSteps.length - 1 && (
                  <div className="flex-1 h-px mx-2" style={{ background: border }} />
                )}
              </div>
            ))}
          </div>
        </section>

        {/* ── NEW: Scraper health panel ── */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              Scraper health
              <button onClick={loadScraperStatus} className="text-xs px-2 py-0.5 rounded"
                style={{ background: 'rgba(0,255,135,0.1)', color: green, border: '1px solid rgba(0,255,135,0.3)' }}>
                ↻ Refresh
              </button>
            </h2>
          </div>

          {scraperStatus && (
            <>
              {/* Stats row */}
              <div className="grid grid-cols-4 gap-2 mb-4">
                {[
                  { label: 'xG records',     value: scraperStatus.stats.rawXgTotal },
                  { label: 'xG linked',       value: scraperStatus.stats.rawXgLinked },
                  { label: 'Odds snapshots',  value: scraperStatus.stats.oddsSnapshots },
                  { label: 'Matches w/ xG',   value: scraperStatus.stats.matchesWithXg },
                ].map(s => (
                  <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'var(--radar-bg)' }}>
                    <p className="text-base font-bold" style={{ color: blue }}>{s.value}</p>
                    <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Run statuses */}
              {scraperStatus.scraperRuns.length > 0 && (
                <div className="flex flex-col gap-1">
                  {scraperStatus.scraperRuns.map(r => {
                    const dot = statusDot(r.status)
                    const ago = r.started_at
                      ? Math.round((Date.now() - new Date(r.started_at).getTime()) / 60_000)
                      : null
                    return (
                      <div key={r.id} className="flex items-center gap-2 text-xs px-2 py-1 rounded"
                        style={{ background: 'var(--radar-bg)' }}>
                        <span style={{ color: dot.color }}>●</span>
                        <span style={{ color: 'var(--radar-text)', minWidth: 120 }}>{r.source}/{r.run_type}</span>
                        <span style={{ color: dot.color }}>{dot.label}</span>
                        <span style={{ color: muted, marginLeft: 'auto' }}>
                          {r.records_upserted} records
                          {ago !== null ? ` · ${ago}m ago` : ''}
                        </span>
                        {r.error_message && (
                          <span style={{ color: '#ef4444', marginLeft: 4 }} title={r.error_message}>⚠</span>
                        )}
                      </div>
                    )
                  })}
                </div>
              )}
            </>
          )}

          {/* Manual trigger buttons */}
          <div className="flex gap-2 mt-4 flex-wrap">
            <button onClick={runXgScraper} disabled={xgStatus === 'loading'}
              className="px-4 py-1.5 rounded text-xs font-medium"
              style={{
                background: xgStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(96,165,250,0.1)',
                color: xgStatus === 'loading' ? muted : blue,
                border: `1px solid ${xgStatus === 'loading' ? border : 'rgba(96,165,250,0.3)'}`,
                cursor: xgStatus === 'loading' ? 'not-allowed' : 'pointer',
              }}>
              {xgStatus === 'loading' ? 'Scraping xG…' : xgStatus === 'success' ? `xG ✓ (${xgResult?.totalRecords})` : '⚡ Scrape xG'}
            </button>

            <button onClick={runOddsSnapshot} disabled={oddsSnapStatus === 'loading'}
              className="px-4 py-1.5 rounded text-xs font-medium"
              style={{
                background: oddsSnapStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(192,132,252,0.1)',
                color: oddsSnapStatus === 'loading' ? muted : purple,
                border: `1px solid ${oddsSnapStatus === 'loading' ? border : 'rgba(192,132,252,0.3)'}`,
                cursor: oddsSnapStatus === 'loading' ? 'not-allowed' : 'pointer',
              }}>
              {oddsSnapStatus === 'loading' ? 'Snapshotting…' : oddsSnapStatus === 'success' ? `Odds ✓ (${oddsSnapResult?.snapshots})` : '📸 Snapshot odds'}
            </button>
          </div>

          {xgResult?.errors && xgResult.errors > 0 && (
            <p className="mt-2 text-xs" style={{ color: '#ef4444' }}>
              {xgResult.errors} scraper(s) had errors — check console logs
            </p>
          )}
        </section>

        {/* Step 1 — Clear */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1">Step 1 — Clear old seed data</h2>
          <p className="text-sm mb-4" style={{ color: muted }}>
            Deletes all rows from <code>predictions</code> and non-today <code>matches</code>.
          </p>
          <button onClick={clearOldData} disabled={clearStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: clearStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(239,68,68,0.12)',
              color: clearStatus === 'loading' ? muted : '#ef4444',
              border: `1px solid ${clearStatus === 'loading' ? border : 'rgba(239,68,68,0.35)'}`,
              cursor: clearStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}>
            {clearStatus === 'loading' ? 'Clearing…' : clearStatus === 'success' ? 'Cleared ✓' : 'Clear old data'}
          </button>
        </section>

        {/* Step 1b — AllSportsAPI */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            Step 1b — Fetch AllSportsAPI fixtures
            <span className="text-xs px-2 py-0.5 rounded font-normal"
              style={{ background: 'rgba(251,146,60,0.12)', color: orange, border: '1px solid rgba(251,146,60,0.3)' }}>
              06:00 UTC
            </span>
          </h2>
          <p className="text-sm mb-4" style={{ color: muted }}>
            Pulls today's fixtures + draw odds from <code>apiv2.allsportsapi.com</code>.
            Stores as <code>external_id = "allsp_*"</code>. Uses league baselines for stats — enriched in Step 1c.
          </p>
          <button onClick={fetchAllSports} disabled={asStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: asStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(251,146,60,0.1)',
              color: asStatus === 'loading' ? muted : orange,
              border: `1px solid ${asStatus === 'loading' ? border : 'rgba(251,146,60,0.35)'}`,
              cursor: asStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}>
            {asStatus === 'loading' ? 'Fetching…' : asStatus === 'success' ? 'Fetched ✓' : '⚡ Fetch AllSports'}
          </button>
          {asResult && asStatus === 'success' && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: 'API total', value: asResult.fetched ?? 0 },
                { label: 'Tracked',   value: asResult.tracked ?? 0 },
                { label: 'Upserted',  value: asResult.upserted ?? 0 },
                { label: 'No odds',   value: asResult.skippedNoOdds ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'var(--radar-bg)' }}>
                  <p className="text-base font-bold" style={{ color: orange }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Step 1c — TSDB */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            Step 1c — TheSportsDB enrichment
            <span className="text-xs px-2 py-0.5 rounded font-normal"
              style={{ background: 'rgba(45,212,191,0.12)', color: teal, border: '1px solid rgba(45,212,191,0.3)' }}>
              06:30 UTC
            </span>
          </h2>
          <p className="text-sm mb-4" style={{ color: muted }}>
            Reads today's matches and enriches with real draw rates + goals averages from standings.
            Sets <code>has_real_team_stats = true</code> on enriched matches.
          </p>
          <button onClick={runTSDBEnrich} disabled={tsdbStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: tsdbStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(45,212,191,0.08)',
              color: tsdbStatus === 'loading' ? muted : teal,
              border: `1px solid ${tsdbStatus === 'loading' ? border : 'rgba(45,212,191,0.3)'}`,
              cursor: tsdbStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}>
            {tsdbStatus === 'loading' ? 'Enriching…' : tsdbStatus === 'success' ? 'Enriched ✓' : '📊 Run TSDB Enrich'}
          </button>
          {tsdbResult && tsdbStatus === 'success' && (
            <div className="mt-3 grid grid-cols-4 gap-2">
              {[
                { label: 'Enriched',  value: tsdbResult.enriched ?? 0 },
                { label: 'Leagues',   value: tsdbResult.leaguesProcessed ?? 0 },
                { label: 'Teams',     value: tsdbResult.teamsCoveredByTable ?? 0 },
                { label: 'API calls', value: tsdbResult.requestsUsed ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-2 text-center" style={{ background: 'var(--radar-bg)' }}>
                  <p className="text-base font-bold" style={{ color: teal }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                </div>
              ))}
            </div>
          )}
        </section>

        {/* Step 2 — Main Pipeline */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1 flex items-center gap-2">
            Step 2 — Run enhanced pipeline
            <span className="text-xs px-2 py-0.5 rounded font-normal"
              style={{ background: 'rgba(0,255,135,0.1)', color: green, border: '1px solid rgba(0,255,135,0.25)' }}>
              07:00 UTC
            </span>
          </h2>
          <p className="text-sm mb-2" style={{ color: muted }}>
            Fetches API-Football fixtures + odds, team stats, H2H, form, scores ALL matches in DB
            (including AllSports rows from 1b, enriched by TSDB from 1c + xG from Understat/FBref),
            then saves top-10 predictions.
          </p>
          <div className="flex gap-3 items-center">
            <button onClick={runPipeline} disabled={status === 'loading'}
              className="px-5 py-2 rounded font-medium text-sm transition-all"
              style={{
                background: status === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(0,255,135,0.1)',
                color: status === 'loading' ? muted : green,
                border: `1px solid ${status === 'loading' ? border : 'rgba(0,255,135,0.3)'}`,
                cursor: status === 'loading' ? 'not-allowed' : 'pointer',
              }}>
              {status === 'loading' ? 'Running pipeline…' : '▶ Run pipeline'}
            </button>
            {status === 'success' && (
              <a href="/" className="px-4 py-2 rounded font-medium text-sm"
                style={{ background: 'rgba(0,255,135,0.08)', color: green, border: '1px solid rgba(0,255,135,0.2)' }}>
                View predictions →
              </a>
            )}
          </div>
        </section>

        {/* Step 3 — Accuracy */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <div className="flex items-center justify-between mb-4">
            <h2 className="font-semibold flex items-center gap-2">
              Step 3 — Model accuracy
              <button onClick={loadAccuracy} disabled={accStatus === 'loading'}
                className="text-xs px-2 py-0.5 rounded font-medium"
                style={{ background: 'rgba(0,255,135,0.1)', color: green, border: '1px solid rgba(0,255,135,0.3)' }}>
                {accStatus === 'loading' ? 'Loading…' : '↻ Refresh'}
              </button>
            </h2>
            <button onClick={updateAccuracy} disabled={accStatus === 'loading'}
              className="text-xs px-3 py-1 rounded font-medium"
              style={{ background: 'rgba(59,130,246,0.1)', color: blue, border: '1px solid rgba(59,130,246,0.3)' }}>
              Update accuracy
            </button>
          </div>

          {accuracy ? (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Overall hit rate',    value: `${accuracy.hitRate}%`,                                          color: green },
                  { label: 'High conf (≥70%)',    value: accuracy.highConfHitRate ? `${accuracy.highConfHitRate}%` : '—', color: '#f59e0b' },
                  { label: 'Evaluated / pending', value: `${accuracy.totalEvaluated} / ${accuracy.unevaluated}`,         color: 'var(--radar-text)' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: 'var(--radar-bg)' }}>
                    <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {accuracy.calibration && (
                <div className="rounded-lg p-3" style={{ background: 'var(--radar-bg)' }}>
                  <p className="text-xs font-semibold mb-1" style={{ color: muted }}>Platt calibration</p>
                  <div className="flex gap-4 text-xs">
                    <span style={{ color: accuracy.calibration.isIdentity ? '#ef4444' : green }}>
                      {accuracy.calibration.isIdentity ? '⚠ Not yet calibrated (identity)' : '✓ Calibrated'}
                    </span>
                    {!accuracy.calibration.isIdentity && (
                      <>
                        <span style={{ color: muted }}>a={accuracy.calibration.plattA}</span>
                        <span style={{ color: muted }}>b={accuracy.calibration.plattB}</span>
                        <span style={{ color: muted }}>{accuracy.calibration.sampleCount} samples</span>
                      </>
                    )}
                  </div>
                </div>
              )}

              {accuracy.signalImpact && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: muted }}>Signal impact</p>
                  <div className="grid grid-cols-2 gap-2">
                    {buildSignalRows(accuracy.signalImpact).map((s) => (
                      <div key={s.label} className="rounded p-2 flex justify-between items-center"
                        style={{ background: 'var(--radar-bg)', border: `1px solid ${border}` }}>
                        <span className="text-xs" style={{ color: muted }}>{s.label}</span>
                        <span className="text-sm font-bold" style={{ color: s.hitRate !== null && s.hitRate > 33 ? green : '#ef4444' }}>
                          {s.hitRate !== null ? `${s.hitRate}%` : '—'}
                          <span className="text-xs font-normal ml-1" style={{ color: muted }}>({s.count})</span>
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {accuracy.reliabilityBuckets?.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: muted }}>Reliability by score bucket</p>
                  <div className="flex flex-col gap-1">
                    {accuracy.reliabilityBuckets.map((b) => {
                      const diff = b.actualHitRate - b.predictedHitRate
                      return (
                        <div key={b.scoreRange} className="flex items-center gap-2 text-xs">
                          <span style={{ color: muted, width: 40 }}>Score {b.scoreRange}</span>
                          <div className="flex-1 relative h-4 rounded overflow-hidden" style={{ background: 'var(--radar-bg)' }}>
                            <div className="absolute h-full rounded" style={{ width: `${b.actualHitRate}%`, background: 'rgba(0,255,135,0.25)' }} />
                            <div className="absolute h-full border-r border-yellow-400 opacity-60" style={{ width: `${b.predictedHitRate}%` }} />
                          </div>
                          <span style={{ color: green, width: 36, textAlign: 'right' }}>{b.actualHitRate}%</span>
                          <span style={{ color: Math.abs(diff) < 10 ? green : '#ef4444', width: 44, textAlign: 'right' }}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                          </span>
                          <span style={{ color: muted }}>({b.count})</span>
                        </div>
                      )
                    })}
                  </div>
                </div>
              )}

              {accuracy.perLeague?.length > 0 && (
                <div>
                  <button onClick={() => setShowLeague((v) => !v)} className="text-xs" style={{ color: muted }}>
                    {showLeague ? '▼' : '▶'} Per-league breakdown ({accuracy.perLeague.length} leagues)
                  </button>
                  {showLeague && (
                    <div className="mt-2 flex flex-col gap-1 max-h-56 overflow-y-auto">
                      {accuracy.perLeague.map((l) => (
                        <div key={l.league} className="flex justify-between text-xs px-2 py-1 rounded" style={{ background: 'var(--radar-bg)' }}>
                          <span style={{ color: muted }}>{l.league}</span>
                          <span style={{ color: l.hitRate > 35 ? green : l.hitRate > 25 ? '#f59e0b' : '#ef4444' }}>
                            {l.hitRate}% ({l.count})
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <p className="text-sm" style={{ color: muted }}>Click refresh to load accuracy data</p>
          )}
        </section>

        {/* Step 4 — Calibrate */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1">Step 4 — Calibrate confidence (monthly)</h2>
          <p className="text-sm mb-4" style={{ color: muted }}>
            Fits Platt scaling from <code>was_correct</code> data. Run once you have ≥20 evaluated predictions.
          </p>
          <button onClick={calibrateModel} disabled={calStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: calStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(168,85,247,0.1)',
              color: calStatus === 'loading' ? muted : purple,
              border: `1px solid ${calStatus === 'loading' ? border : 'rgba(168,85,247,0.3)'}`,
              cursor: calStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}>
            {calStatus === 'loading' ? 'Calibrating…' : calStatus === 'success' ? 'Calibrated ✓' : '⚙ Fit Platt scaling'}
          </button>
          {calResult?.success && (
            <div className="mt-3 rounded-lg p-3 text-xs" style={{ background: 'var(--radar-bg)' }}>
              <p style={{ color: green }}>a={calResult.plattA} · b={calResult.plattB}</p>
              <p style={{ color: muted }}>Overall hit rate: {calResult.overallHitRate}%</p>
            </div>
          )}
        </section>

        {/* Pipeline result */}
        {result && status === 'success' && (
          <section className="rounded-xl p-5" style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <p className="text-sm font-semibold mb-3" style={{ color: green }}>Pipeline complete</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Matches fetched',   value: result.fetched ?? 0 },
                { label: 'Predictions saved', value: result.predictions ?? 0 },
              ].map((s) => (
                <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: 'var(--radar-bg)' }}>
                  <p className="text-xl font-bold" style={{ color: green }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                </div>
              ))}
            </div>
            {result.top_pick && (
              <p className="text-xs mt-3" style={{ color: muted }}>
                Top pick: <span style={{ color: 'var(--radar-text)' }}>{result.top_pick}</span>
              </p>
            )}
          </section>
        )}

        {result && status === 'error' && (
          <section className="rounded-xl p-5" style={{ background: 'rgba(239,68,68,0.05)', border: '1px solid rgba(239,68,68,0.2)' }}>
            <p className="text-sm font-semibold mb-2" style={{ color: '#ef4444' }}>Pipeline error</p>
            <p className="text-xs font-mono" style={{ color: muted }}>{result.error}</p>
          </section>
        )}

        {/* Log console */}
        {logs.length > 0 && (
          <section className="rounded-xl p-5" style={{ background: 'var(--radar-bg)', border: `1px solid ${border}` }}>
            <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: muted }}>Console</p>
            <div className="flex flex-col gap-1.5 font-mono text-xs">
              {logs.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ color: muted, flexShrink: 0 }}>{line.ts}</span>
                  <span style={{ color: logColor[line.type] }}>{line.msg}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-center" style={{ color: muted }}>
          This page is only accessible when <code>NODE_ENV=development</code>. Returns 403 in production.
        </p>
      </main>
    </div>
  )
}