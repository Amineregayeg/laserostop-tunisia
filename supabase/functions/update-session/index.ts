import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface UpdateSessionRequest {
  session_id: string
  attendance_status: 'present' | 'absent' | 'rescheduled'
  actual_price: number
  price_notes?: string
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
    const updateData: UpdateSessionRequest = await req.json()

    // Validate required fields
    if (!updateData.session_id) {
      throw new Error('ID de séance obligatoire')
    }
    if (!updateData.attendance_status) {
      throw new Error('Statut de présence obligatoire')
    }
    if (updateData.actual_price === undefined || updateData.actual_price === null) {
      throw new Error('Prix obligatoire')
    }

    // Validate attendance status
    const validStatuses = ['present', 'absent', 'rescheduled']
    if (!validStatuses.includes(updateData.attendance_status)) {
      throw new Error('Statut de présence invalide')
    }

    // Validate price (must be >= 0)
    if (updateData.actual_price < 0) {
      throw new Error('Le prix ne peut pas être négatif')
    }

    // Get the booking to determine category and standard price
    const { data: booking, error: fetchError } = await supabaseClient
      .from('bookings')
      .select('id, category, client_name, slot_start_utc')
      .eq('id', updateData.session_id)
      .single()

    if (fetchError || !booking) {
      console.error('Fetch booking error:', fetchError)
      throw new Error('Séance introuvable')
    }

    // Calculate standard price
    const standardPrices = {
      'tabac': 500.00,
      'drogue': 750.00,
      'drogue_dure': 1000.00
    }
    const standardPrice = standardPrices[booking.category as keyof typeof standardPrices] || 0

    // Determine payment status
    let paymentStatus = 'pending'
    if (updateData.actual_price === 0) {
      paymentStatus = 'free'
    } else if (updateData.actual_price >= standardPrice) {
      paymentStatus = 'paid'
    } else {
      paymentStatus = 'partial'
    }

    // Determine booking status based on attendance
    let bookingStatus = 'booked'
    switch (updateData.attendance_status) {
      case 'present':
        bookingStatus = 'completed'
        break
      case 'absent':
        bookingStatus = 'cancelled'
        break
      case 'rescheduled':
        bookingStatus = 'rescheduled'
        break
    }

    // Update the booking using the custom function
    const { data: result, error: updateError } = await supabaseClient
      .rpc('update_booking_followup', {
        booking_id: updateData.session_id,
        new_attendance_status: updateData.attendance_status,
        new_actual_price: updateData.actual_price,
        new_price_notes: updateData.price_notes || '',
        new_follow_up_notes: updateData.follow_up_notes || '',
        confirmed_by_user: 'suivi_app'
      })

    if (updateError) {
      console.error('Update error:', updateError)
      throw new Error('Erreur lors de la mise à jour de la séance')
    }

    // Get updated booking data
    const { data: updatedBooking, error: refetchError } = await supabaseClient
      .from('bookings')
      .select('*')
      .eq('id', updateData.session_id)
      .single()

    if (refetchError) {
      console.error('Refetch error:', refetchError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Séance mise à jour avec succès',
        booking: updatedBooking,
        updated_fields: {
          attendance_status: updateData.attendance_status,
          actual_price: updateData.actual_price,
          payment_status: paymentStatus,
          status: bookingStatus
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in update-session:', error)
    
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