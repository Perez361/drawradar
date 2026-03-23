'use client'

import { useState } from 'react'

// ─── Types ────────────────────────────────────────────────────────────────────

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

// ─── Component ────────────────────────────────────────────────────────────────

export default function AdminPage() {
  const [status, setStatus]           = useState<Status>('idle')
  const [result, setResult]           = useState<PipelineResult | null>(null)
  const [logs, setLogs]               = useState<LogLine[]>([])
  const [clearStatus, setClearStatus] = useState<Status>('idle')

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
        setResult(data)
        setStatus('error')
        return
      }

      addLog(`Fetched ${data.fetched} matches from Odds API`, 'info')
      addLog(`Generated ${data.predictions} predictions`, 'info')
      if (data.top_pick) addLog(`Top pick: ${data.top_pick}`, 'success')
      addLog('Done — reload the home page to see results ✓', 'success')
      setResult(data)
      setStatus('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`Network error: ${msg}`, 'error')
      setStatus('error')
    }
  }

  async function clearOldData() {
    setClearStatus('loading')
    addLog('Clearing old seed data from Supabase …')

    try {
      const res  = await fetch('/api/admin/clear-old-data', { method: 'POST' })
      const data = await res.json() as { success?: boolean; error?: string }

      if (!res.ok || data.error) {
        addLog(`Clear failed: ${data.error ?? res.statusText}`, 'error')
        setClearStatus('error')
        return
      }

      addLog('Old predictions + matches cleared ✓', 'success')
      setClearStatus('success')
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      addLog(`Network error: ${msg}`, 'error')
      setClearStatus('error')
    }
  }

  const logColor: Record<LogLine['type'], string> = {
    info:    '#6b7a8d',
    success: '#00ff87',
    error:   '#ef4444',
  }

  return (
    <div className="min-h-screen" style={{ background: 'var(--radar-bg)', color: 'var(--radar-text)' }}>
      {/* Header */}
      <header
        className="border-b px-6 py-4 flex items-center gap-3"
        style={{ borderColor: 'var(--radar-border)', background: 'var(--radar-surface)' }}
      >
        <a href="/" style={{ color: 'var(--radar-green)', fontSize: 13 }}>← Home</a>
        <span style={{ color: 'var(--radar-border)' }}>|</span>
        <h1 className="text-base font-bold" style={{ color: 'var(--radar-green)' }}>
          DrawRadar — Dev Admin
        </h1>
        <span
          className="text-xs px-2 py-0.5 rounded"
          style={{ background: 'rgba(239,68,68,0.15)', color: '#ef4444', border: '1px solid rgba(239,68,68,0.3)' }}
        >
          LOCAL ONLY
        </span>
      </header>

      <main className="max-w-2xl mx-auto px-4 py-10 flex flex-col gap-6">

        {/* Step 1 — Clear old data */}
        <section
          className="rounded-xl p-6"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <h2 className="font-semibold mb-1">Step 1 — Clear old seed data</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--radar-muted)' }}>
            Deletes all rows from <code>predictions</code> and non-today <code>matches</code> so
            stale hardcoded data doesn't pollute results.
          </p>
          <button
            onClick={clearOldData}
            disabled={clearStatus === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: clearStatus === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(239,68,68,0.12)',
              color: clearStatus === 'loading' ? 'var(--radar-muted)' : '#ef4444',
              border: `1px solid ${clearStatus === 'loading' ? 'var(--radar-border)' : 'rgba(239,68,68,0.35)'}`,
              cursor: clearStatus === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {clearStatus === 'loading' ? 'Clearing…' : clearStatus === 'success' ? 'Cleared ✓' : 'Clear old data'}
          </button>
        </section>

        {/* Step 2 — Run pipeline */}
        <section
          className="rounded-xl p-6"
          style={{ background: 'var(--radar-surface)', border: '1px solid var(--radar-border)' }}
        >
          <h2 className="font-semibold mb-1">Step 2 — Fetch today's matches &amp; generate predictions</h2>
          <p className="text-sm mb-4" style={{ color: 'var(--radar-muted)' }}>
            Calls The Odds API for today's fixtures across all supported leagues, scores them,
            and writes the top 10 predictions to Supabase.
          </p>
          <button
            onClick={runPipeline}
            disabled={status === 'loading'}
            className="px-5 py-2 rounded font-medium text-sm transition-all"
            style={{
              background: status === 'loading' ? 'rgba(255,255,255,0.05)' : 'rgba(0,255,135,0.1)',
              color: status === 'loading' ? 'var(--radar-muted)' : 'var(--radar-green)',
              border: `1px solid ${status === 'loading' ? 'var(--radar-border)' : 'rgba(0,255,135,0.3)'}`,
              cursor: status === 'loading' ? 'not-allowed' : 'pointer',
            }}
          >
            {status === 'loading' ? 'Running pipeline…' : '▶ Run pipeline'}
          </button>
        </section>

        {/* Result summary */}
        {result && status === 'success' && (
          <section
            className="rounded-xl p-5"
            style={{ background: 'rgba(0,255,135,0.05)', border: '1px solid rgba(0,255,135,0.2)' }}
          >
            <p className="text-sm font-semibold mb-3" style={{ color: 'var(--radar-green)' }}>
              Pipeline complete
            </p>
            <div className="grid grid-cols-2 gap-3">
              {[
                { label: 'Matches fetched', value: result.fetched ?? 0 },
                { label: 'Predictions saved', value: result.predictions ?? 0 },
              ].map((s) => (
                <div
                  key={s.label}
                  className="rounded-lg p-3 text-center"
                  style={{ background: 'var(--radar-bg)' }}
                >
                  <p className="text-xl font-bold" style={{ color: 'var(--radar-green)' }}>{s.value}</p>
                  <p className="text-xs mt-0.5" style={{ color: 'var(--radar-muted)' }}>{s.label}</p>
                </div>
              ))}
            </div>
            {result.top_pick && (
              <p className="text-xs mt-3" style={{ color: 'var(--radar-muted)' }}>
                Top pick: <span style={{ color: 'var(--radar-text)' }}>{result.top_pick}</span>
              </p>
            )}
            <a
              href="/"
              className="mt-4 inline-block text-sm font-medium px-4 py-2 rounded transition-all"
              style={{
                background: 'rgba(0,255,135,0.1)',
                color: 'var(--radar-green)',
                border: '1px solid rgba(0,255,135,0.25)',
              }}
            >
              View predictions →
            </a>
          </section>
        )}

        {/* Log console */}
        {logs.length > 0 && (
          <section
            className="rounded-xl p-5"
            style={{ background: 'var(--radar-bg)', border: '1px solid var(--radar-border)' }}
          >
            <p className="text-xs font-semibold mb-3 uppercase tracking-wider" style={{ color: 'var(--radar-muted)' }}>
              Console
            </p>
            <div className="flex flex-col gap-1.5 font-mono text-xs">
              {logs.map((line, i) => (
                <div key={i} className="flex gap-3">
                  <span style={{ color: 'var(--radar-muted)', flexShrink: 0 }}>{line.ts}</span>
                  <span style={{ color: logColor[line.type] }}>{line.msg}</span>
                </div>
              ))}
            </div>
          </section>
        )}

        <p className="text-xs text-center" style={{ color: 'var(--radar-muted)' }}>
          This page is only accessible when <code>NODE_ENV=development</code>.
          It will return 403 in production.
        </p>
      </main>
    </div>
  )
}