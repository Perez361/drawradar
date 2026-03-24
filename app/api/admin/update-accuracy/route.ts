// app/api/admin/update-accuracy/route.ts
//
// Calls the update_predictions_accuracy() Supabase RPC to mark
// predictions as correct/incorrect based on match results.

import { NextResponse } from 'next/server'
import { supabaseAdmin } from '@/lib/supabase'

export async function POST() {
  try {
    const { error } = await supabaseAdmin.rpc('update_predictions_accuracy')

    if (error) {
      console.error('[update-accuracy]', error.message)
      // Provide a helpful message if the function doesn't exist yet
      if (error.message.includes('does not exist') || error.code === 'PGRST202') {
        return NextResponse.json({
          error: 'RPC function update_predictions_accuracy not found. Please run the supabase_setup.sql migration first.',
          code: error.code,
        }, { status: 500 })
      }
      return NextResponse.json({ error: error.message }, { status: 500 })
    }

    return NextResponse.json({ success: true, message: 'Accuracy updated' })
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    console.error('[update-accuracy] unexpected error:', msg)
    return NextResponse.json({ error: msg }, { status: 500 })
  }
}