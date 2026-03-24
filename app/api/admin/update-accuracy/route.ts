import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  addLog('Updating prediction accuracy...')

  try {
    const { error } = await supabaseAdmin.rpc('update_predictions_accuracy')
    
    if (error) {
      addLog(`Error: ${error.message}`, 'error')
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    addLog('Accuracy updated ✓')
    return NextResponse.json({ success: true, message: 'Accuracy updated' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    addLog(`Update failed: ${msg}`, 'error')
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}
