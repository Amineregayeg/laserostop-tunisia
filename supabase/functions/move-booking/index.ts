import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface MoveBookingRequest {
  booking_id: string
  new_slot_start_local: string  // ISO string in local time
  new_slot_end_local: string    // ISO string in local time
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
    const moveData: MoveBookingRequest = await req.json()

    // Validate required fields
    if (!moveData.booking_id) {
      throw new Error('ID de réservation obligatoire')
    }
    if (!moveData.new_slot_start_local || !moveData.new_slot_end_local) {
      throw new Error('Les nouvelles heures de début et fin sont obligatoires')
    }

    // Get the existing booking
    const { data: booking, error: fetchError } = await supabaseClient
      .from('bookings')
      .select('*')
      .eq('id', moveData.booking_id)
      .single()

    if (fetchError || !booking) {
      console.error('Fetch error:', fetchError)
      throw new Error('Réservation introuvable')
    }

    // Convert local time to UTC
    const startLocal = new Date(moveData.new_slot_start_local)
    const endLocal = new Date(moveData.new_slot_end_local)

    // Convert to UTC for storage
    const startUTC = new Date(startLocal.toLocaleString('sv-SE', { timeZone: 'UTC' }))
    const endUTC = new Date(endLocal.toLocaleString('sv-SE', { timeZone: 'UTC' }))

    // Adjust for timezone offset
    const tunisOffset = getTunisTimezoneOffset(startLocal)
    startUTC.setMinutes(startUTC.getMinutes() - tunisOffset)
    endUTC.setMinutes(endUTC.getMinutes() - tunisOffset)

    // Get the local date for storage
    const newDate = startLocal.toISOString().split('T')[0]

    // Validate business hours
    const dayOfWeek = startLocal.getDay()
    const startTime = startLocal.toTimeString().slice(0, 5)
    const endTime = endLocal.toTimeString().slice(0, 5)

    if (!isValidBusinessSlot(dayOfWeek, startTime, endTime)) {
      throw new Error('Créneau en dehors des heures d\'ouverture')
    }

    // Check if slot is in the past
    const now = new Date()
    if (startLocal < now) {
      throw new Error('Impossible de déplacer vers un créneau passé')
    }

    // Check for conflicts (excluding the current booking)
    const { data: existingBookings, error: conflictError } = await supabaseClient
      .from('bookings')
      .select('id')
      .eq('date', newDate)
      .eq('status', 'booked')
      .eq('slot_start_utc', startUTC.toISOString())
      .neq('id', moveData.booking_id)

    if (conflictError) {
      console.error('Error checking conflicts:', conflictError)
      throw new Error('Erreur lors de la vérification des conflits')
    }

    if (existingBookings && existingBookings.length > 0) {
      throw new Error('Créneau déjà réservé')
    }

    // Update the booking
    const { data: updatedBooking, error: updateError } = await supabaseClient
      .from('bookings')
      .update({
        date: newDate,
        slot_start_utc: startUTC.toISOString(),
        slot_end_utc: endUTC.toISOString(),
      })
      .eq('id', moveData.booking_id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      throw new Error('Erreur lors du déplacement de la réservation')
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Réservation déplacée avec succès',
        booking: updatedBooking
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in move-booking:', error)

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

// Helper function to get Tunis timezone offset
function getTunisTimezoneOffset(date: Date): number {
  // Tunisia is UTC+1, no DST
  return 60 // minutes
}

// Helper function to validate business hours
function isValidBusinessSlot(dayOfWeek: number, startTime: string, endTime: string): boolean {
  // Sunday = 0, Monday = 1, Tuesday = 2, etc.
  // We only work Tuesday (2) to Saturday (6)
  if (![2, 3, 4, 5, 6].includes(dayOfWeek)) {
    return false
  }

  const start = timeToMinutes(startTime)
  const end = timeToMinutes(endTime)

  switch (dayOfWeek) {
    case 2: // Tuesday
    case 3: // Wednesday
    case 4: // Thursday
      return start >= timeToMinutes('10:00') && end <= timeToMinutes('19:00')
    case 5: // Friday
      return (
        (start >= timeToMinutes('10:00') && end <= timeToMinutes('15:00')) ||
        (start === timeToMinutes('14:30') && end === timeToMinutes('15:30'))
      )
    case 6: // Saturday
      return start >= timeToMinutes('10:00') && end <= timeToMinutes('18:00')
    default:
      return false
  }
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}
