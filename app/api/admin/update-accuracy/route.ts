import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  try {
    const { error } = await supabaseAdmin.rpc('update_predictions_accuracy')

    if (error) {
      console.error('[update-accuracy]', error.message)
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Accuracy updated' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[update-accuracy] unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}