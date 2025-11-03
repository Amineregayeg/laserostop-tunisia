import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface BatchConfirmRequest {
  session_ids: string[]
  attendance_status: 'present' | 'absent' | 'rescheduled'
  use_standard_prices: boolean
  custom_price?: number
  follow_up_notes?: string
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only allow POST requests
    if (req.method !== 'POST') {
      throw new Error('Method not allowed')
    }

    // Initialize Supabase client
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_ANON_KEY') ?? '',
      {
        auth: {
          persistSession: false,
        },
      }
    )

    // Parse request body
    const batchData: BatchConfirmRequest = await req.json()

    // Validate required fields
    if (!batchData.session_ids || !Array.isArray(batchData.session_ids) || batchData.session_ids.length === 0) {
      throw new Error('Liste des séances obligatoire')
    }
    if (!batchData.attendance_status) {
      throw new Error('Statut de présence obligatoire')
    }

    // Validate attendance status
    const validStatuses = ['present', 'absent', 'rescheduled']
    if (!validStatuses.includes(batchData.attendance_status)) {
      throw new Error('Statut de présence invalide')
    }

    // Get all bookings to update
    const { data: bookings, error: fetchError } = await supabaseClient
      .from('bookings')
      .select('id, category, client_name, slot_start_utc')
      .in('id', batchData.session_ids)

    if (fetchError) {
      console.error('Fetch bookings error:', fetchError)
      throw new Error('Erreur lors de la récupération des séances')
    }

    if (!bookings || bookings.length === 0) {
      throw new Error('Aucune séance trouvée')
    }

    // Standard prices mapping
    const standardPrices = {
      'tabac': 500.00,
      'drogue': 750.00,
      'drogue_dure': 1000.00
    }

    const results = []
    let successCount = 0
    let errorCount = 0

    // Process each booking
    for (const booking of bookings) {
      try {
        // Determine price
        let actualPrice = 0
        if (batchData.use_standard_prices) {
          actualPrice = standardPrices[booking.category as keyof typeof standardPrices] || 0
        } else if (batchData.custom_price !== undefined) {
          actualPrice = batchData.custom_price
        }

        // Update using the custom function
        const { error: updateError } = await supabaseClient
          .rpc('update_booking_followup', {
            booking_id: booking.id,
            new_attendance_status: batchData.attendance_status,
            new_actual_price: actualPrice,
            new_price_notes: batchData.use_standard_prices ? 'Confirmation en lot - prix standard' : 'Confirmation en lot',
            new_follow_up_notes: batchData.follow_up_notes || 'Confirmation en lot automatique',
            confirmed_by_user: 'batch_operation'
          })

        if (updateError) {
          console.error(`Update error for booking ${booking.id}:`, updateError)
          errorCount++
          results.push({
            booking_id: booking.id,
            client_name: booking.client_name,
            success: false,
            error: updateError.message
          })
        } else {
          successCount++
          results.push({
            booking_id: booking.id,
            client_name: booking.client_name,
            success: true,
            actual_price: actualPrice
          })
        }
      } catch (error) {
        console.error(`Error processing booking ${booking.id}:`, error)
        errorCount++
        results.push({
          booking_id: booking.id,
          client_name: booking.client_name,
          success: false,
          error: error.message
        })
      }
    }

    // Calculate totals
    const totalRevenue = results
      .filter(r => r.success)
      .reduce((sum, r) => sum + (r.actual_price || 0), 0)

    return new Response(
      JSON.stringify({
        success: true,
        message: `${successCount} séances confirmées avec succès${errorCount > 0 ? `, ${errorCount} erreurs` : ''}`,
        updated_count: successCount,
        error_count: errorCount,
        total_revenue: totalRevenue,
        results: results,
        summary: {
          total_processed: bookings.length,
          successful_updates: successCount,
          failed_updates: errorCount,
          total_revenue: totalRevenue
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in batch-confirm:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || 'Une erreur est survenue'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})