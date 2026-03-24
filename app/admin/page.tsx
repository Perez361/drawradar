'use client'

import { useState } from 'react'

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

  function addLog(msg: string, type: LogLine['type'] = 'info') {
    const ts = new Date().toLocaleTimeString('en-GB')
    setLogs((prev) => [...prev, { ts, msg, type }])
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

  async function loadAccuracy() {
    setAccStatus('loading')
    try {
      const res  = await fetch('/api/model-accuracy')
      const data = await res.json()
      setAccuracy(data)
      setAccStatus('success')
    } catch { setAccStatus('error') }
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

  const surface  = 'var(--radar-surface)'
  const border   = 'var(--radar-border)'
  const muted    = 'var(--radar-muted)'
  const green    = 'var(--radar-green)'

  return (
    <div className="min-h-screen" style={{ background: 'var(--radar-bg)', color: 'var(--radar-text)' }}>
      {/* Header */}
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

        {/* Step 2 — Pipeline */}
        <section className="rounded-xl p-6" style={{ background: surface, border: `1px solid ${border}` }}>
          <h2 className="font-semibold mb-1">Step 2 — Run enhanced pipeline</h2>
          <p className="text-sm mb-2" style={{ color: muted }}>
            Fetches fixtures + odds, team stats, form, H2H, and computes predictions via draw engine v3.
          </p>
          <ul className="text-xs mb-4 list-disc list-inside" style={{ color: muted }}>
            <li>Real H2H draw rate (weighted recent-biased)</li>
            <li>Form streak — weighted last-5 draw rate + goals avg</li>
            <li>Fatigue proxy — games in last 14 days</li>
            <li>Line movement — opening odds vs current (stored for tomorrow)</li>
            <li>Platt-scaled confidence (identity until calibrated)</li>
          </ul>
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
            <div className="flex gap-2">
              <button onClick={updateAccuracy} disabled={accStatus === 'loading'}
                className="text-xs px-3 py-1 rounded font-medium"
                style={{ background: 'rgba(59,130,246,0.1)', color: '#60a5fa', border: '1px solid rgba(59,130,246,0.3)' }}>
                Update accuracy
              </button>
            </div>
          </div>

          {accuracy ? (
            <div className="flex flex-col gap-4">
              {/* Core stats */}
              <div className="grid grid-cols-3 gap-3">
                {[
                  { label: 'Overall hit rate', value: `${accuracy.hitRate}%`, color: green },
                  { label: 'High conf (≥70%)', value: accuracy.highConfHitRate ? `${accuracy.highConfHitRate}%` : '—', color: '#f59e0b' },
                  { label: 'Evaluated / pending', value: `${accuracy.totalEvaluated} / ${accuracy.unevaluated}`, color: 'var(--radar-text)' },
                ].map((s) => (
                  <div key={s.label} className="rounded-lg p-3 text-center" style={{ background: 'var(--radar-bg)' }}>
                    <p className="text-lg font-bold" style={{ color: s.color }}>{s.value}</p>
                    <p className="text-xs mt-0.5" style={{ color: muted }}>{s.label}</p>
                  </div>
                ))}
              </div>

              {/* Calibration status */}
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

              {/* Signal impact */}
              {accuracy.signalImpact && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: muted }}>Signal impact</p>
                  <div className="grid grid-cols-2 gap-2">
                    {[
                      { label: 'Real H2H data', ...accuracy.signalImpact.realH2H },
                      { label: 'Estimated H2H', ...accuracy.signalImpact.estimatedH2H },
                      { label: 'With form data', ...accuracy.signalImpact.withForm },
                      { label: 'Without form', ...accuracy.signalImpact.withoutForm },
                    ].map((s) => (
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
                  {accuracy.signalImpact.sweetSpotOdds.count > 0 && (
                    <div className="rounded p-2 flex justify-between items-center mt-2"
                      style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
                      <span className="text-xs" style={{ color: muted }}>
                        Odds sweet spot ({accuracy.signalImpact.sweetSpotOdds.range})
                      </span>
                      <span className="text-sm font-bold" style={{ color: green }}>
                        {accuracy.signalImpact.sweetSpotOdds.hitRate ?? '—'}%
                        <span className="text-xs font-normal ml-1" style={{ color: muted }}>
                          ({accuracy.signalImpact.sweetSpotOdds.count})
                        </span>
                      </span>
                    </div>
                  )}
                </div>
              )}

              {/* Reliability buckets */}
              {accuracy.reliabilityBuckets && accuracy.reliabilityBuckets.length > 0 && (
                <div>
                  <p className="text-xs font-semibold mb-2 uppercase tracking-wider" style={{ color: muted }}>
                    Reliability by score bucket
                  </p>
                  <div className="flex flex-col gap-1">
                    {accuracy.reliabilityBuckets.map((b) => {
                      const diff = b.actualHitRate - b.predictedHitRate
                      const diffColor = Math.abs(diff) < 10 ? green : '#ef4444'
                      return (
                        <div key={b.scoreRange} className="flex items-center gap-2 text-xs">
                          <span style={{ color: muted, width: 40 }}>Score {b.scoreRange}</span>
                          <div className="flex-1 relative h-4 rounded overflow-hidden" style={{ background: 'var(--radar-bg)' }}>
                            <div className="absolute h-full rounded" style={{
                              width: `${b.actualHitRate}%`, background: 'rgba(0,255,135,0.25)'
                            }} />
                            <div className="absolute h-full border-r border-yellow-400 opacity-60" style={{
                              width: `${b.predictedHitRate}%`
                            }} />
                          </div>
                          <span style={{ color: green, width: 36, textAlign: 'right' }}>{b.actualHitRate}%</span>
                          <span style={{ color: diffColor, width: 44, textAlign: 'right' }}>
                            {diff >= 0 ? '+' : ''}{diff.toFixed(1)}
                          </span>
                          <span style={{ color: muted }}>({b.count})</span>
                        </div>
                      )
                    })}
                    <p className="text-xs mt-1" style={{ color: muted }}>
                      Green bar = actual hit rate · Yellow line = predicted · Diff = actual − predicted
                    </p>
                  </div>
                </div>
              )}

              {/* Per-league toggle */}
              {accuracy.perLeague && accuracy.perLeague.length > 0 && (
                <div>
                  <button onClick={() => setShowLeague((v) => !v)}
                    className="text-xs" style={{ color: muted }}>
                    {showLeague ? '▼' : '▶'} Per-league breakdown ({accuracy.perLeague.length} leagues)
                  </button>
                  {showLeague && (
                    <div className="mt-2 flex flex-col gap-1 max-h-56 overflow-y-auto">
                      {accuracy.perLeague.map((l) => (
                        <div key={l.league} className="flex justify-between text-xs px-2 py-1 rounded"
                          style={{ background: 'var(--radar-bg)' }}>
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
            Fits Platt scaling from <code>was_correct</code> data so that confidence % matches actual hit rates.
            Run once you have ≥20 evaluated predictions. Repeat monthly.
          </p>
          <button onClick={calibrateModel} disabled={calStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: calStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(168,85,247,0.1)',
              color: calStatus === 'loading' ? muted : '#c084fc',
              border: `1px solid ${calStatus === 'loading' ? border : 'rgba(168,85,247,0.3)'}`,
              cursor: calStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}>
            {calStatus === 'loading' ? 'Calibrating…' : calStatus === 'success' ? 'Calibrated ✓' : '⚙ Fit Platt scaling'}
          </button>

          {calResult?.success && (
            <div className="mt-3 rounded-lg p-3 text-xs" style={{ background: 'var(--radar-bg)' }}>
              <p style={{ color: green }}>a={calResult.plattA} · b={calResult.plattB}</p>
              <p style={{ color: muted }}>
                Overall hit rate: {calResult.overallHitRate}% · Well-calibrated: {calResult.isWellCalibrated ? 'yes' : 'needs more data'}
              </p>
            </div>
          )}

          {calResult && !calResult.success && (
            <p className="mt-2 text-xs" style={{ color: muted }}>{calResult.message}</p>
          )}
        </section>

        {/* Pipeline result */}
        {result && status === 'success' && (
          <section className="rounded-xl p-5"
            style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}>
            <p className="text-sm font-semibold mb-3" style={{ color: green }}>Pipeline complete</p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Matches fetched', value: result.fetched ?? 0 },
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
            <a href="/" className="mt-4 inline-block text-sm font-medium px-4 py-2 rounded transition-all"
              style={{ background: 'rgba(0,255,135,0.1)', color: green, border: '1px solid rgba(0,255,135,0.25)' }}>
              View predictions →
            </a>
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