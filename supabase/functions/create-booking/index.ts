import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface BookingRequest {
  client_name: string
  phone: string
  category: 'tabac' | 'drogue' | 'drogue_dure'
  notes?: string
  session_duration?: number
  session_type?: 'solo' | 'duo'
  slot_start_local: string // ISO string in local time
  slot_end_local: string   // ISO string in local time
}

interface SMTPConfig {
  host: string
  port: number
  user: string
  pass: string
  from: string
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
    const bookingData: BookingRequest = await req.json()

    // Validate required fields
    if (!bookingData.client_name?.trim()) {
      throw new Error('Le nom est obligatoire')
    }
    if (!bookingData.phone?.trim()) {
      throw new Error('Le téléphone est obligatoire')
    }
    if (!bookingData.category) {
      throw new Error('La catégorie est obligatoire')
    }
    if (!bookingData.slot_start_local || !bookingData.slot_end_local) {
      throw new Error('Les heures de début et fin sont obligatoires')
    }

    // No phone format validation - accept any input

    // Validate category
    const validCategories = ['tabac', 'drogue', 'drogue_dure']
    if (!validCategories.includes(bookingData.category)) {
      throw new Error('Catégorie invalide')
    }

    // Convert local time to UTC
    const TUNIS_TZ = 'Africa/Tunis'
    const startLocal = new Date(bookingData.slot_start_local)
    const endLocal = new Date(bookingData.slot_end_local)
    
    // Convert to UTC for storage
    const startUTC = new Date(startLocal.toLocaleString('sv-SE', { timeZone: 'UTC' }))
    const endUTC = new Date(endLocal.toLocaleString('sv-SE', { timeZone: 'UTC' }))
    
    // Adjust for timezone offset
    const tunisOffset = getTunisTimezoneOffset(startLocal)
    startUTC.setMinutes(startUTC.getMinutes() - tunisOffset)
    endUTC.setMinutes(endUTC.getMinutes() - tunisOffset)

    // Get the local date for storage
    const bookingDate = startLocal.toISOString().split('T')[0]

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
      throw new Error('Impossible de réserver un créneau passé')
    }

    // Check for conflicts
    const { data: existingBookings, error: conflictError } = await supabaseClient
      .from('bookings')
      .select('id')
      .eq('date', bookingDate)
      .eq('status', 'booked')
      .eq('slot_start_utc', startUTC.toISOString())

    if (conflictError) {
      console.error('Error checking conflicts:', conflictError)
      throw new Error('Erreur lors de la vérification des conflits')
    }

    if (existingBookings && existingBookings.length > 0) {
      throw new Error('Créneau déjà réservé')
    }

    // Create the booking
    const booking = {
      date: bookingDate,
      slot_start_utc: startUTC.toISOString(),
      slot_end_utc: endUTC.toISOString(),
      client_name: bookingData.client_name.trim(),
      phone: bookingData.phone.trim(),
      category: bookingData.category,
      notes: bookingData.notes?.trim() || '',
      session_duration: bookingData.session_duration || 60,
      session_type: bookingData.session_type || 'solo',
      status: 'booked'
    }

    const { data: newBooking, error: insertError } = await supabaseClient
      .from('bookings')
      .insert(booking)
      .select()
      .single()

    if (insertError) {
      console.error('Insert error:', insertError)
      if (insertError.code === '23505') { // Unique constraint violation
        throw new Error('Créneau déjà réservé')
      }
      throw new Error('Erreur lors de la création du rendez-vous')
    }

    // Send notification email
    try {
      await sendBookingNotification(newBooking, supabaseClient)
    } catch (emailError) {
      console.error('Email notification failed:', emailError)
      // Don't fail the booking if email fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Rendez-vous créé avec succès',
        booking: newBooking
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 201,
      }
    )

  } catch (error) {
    console.error('Error in create-booking:', error)
    
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
      return start >= timeToMinutes('10:00') && end <= timeToMinutes('18:00')
    case 5: // Friday
      return (
        (start >= timeToMinutes('10:00') && end <= timeToMinutes('15:00')) ||
        (start === timeToMinutes('14:30') && end === timeToMinutes('15:30'))
      )
    case 6: // Saturday
      return start >= timeToMinutes('10:00') && end <= timeToMinutes('17:00')
    default:
      return false
  }
}

function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map(Number)
  return hours * 60 + minutes
}

// Helper function to send email notifications
async function sendBookingNotification(booking: any, supabaseClient: any) {
  // Get notification email from settings
  const { data: settings } = await supabaseClient
    .from('settings')
    .select('value')
    .eq('id', 'notification_email')
    .single()

  if (!settings?.value) {
    console.log('No notification email configured')
    return
  }

  const smtpConfig: SMTPConfig = {
    host: Deno.env.get('SMTP_HOST') || '',
    port: parseInt(Deno.env.get('SMTP_PORT') || '587'),
    user: Deno.env.get('SMTP_USER') || '',
    pass: Deno.env.get('SMTP_PASS') || '',
    from: Deno.env.get('FROM_EMAIL') || ''
  }

  // Validate SMTP configuration
  if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass || !smtpConfig.from) {
    console.log('SMTP not configured, skipping email notification')
    return
  }

  const startTime = new Date(booking.slot_start_utc).toLocaleString('fr-TN', { 
    timeZone: 'Africa/Tunis',
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit'
  })

  const categories = {
    tabac: 'Arrêt du tabac',
    drogue: 'Sevrage drogue',
    drogue_dure: 'Sevrage drogues dures'
  }

  const subject = 'Nouveau rendez-vous LaserOstop'
  const body = `
Nouveau rendez-vous créé:

Client: ${booking.client_name}
Téléphone: ${booking.phone}
Date et heure: ${startTime}
Durée: ${booking.session_duration || 60} minutes
Type: ${booking.session_type || 'solo'}
Catégorie: ${categories[booking.category] || booking.category}
${booking.notes ? `Notes: ${booking.notes}` : ''}

---
LaserOstop Tunisie
  `.trim()

  try {
    // Simple email sending using basic SMTP
    await sendEmail(smtpConfig, settings.value, subject, body)
    
    // Mark notification as sent
    await supabaseClient
      .from('bookings')
      .update({ notification_sent: true })
      .eq('id', booking.id)

  } catch (error) {
    console.error('Failed to send email:', error)
    throw error
  }
}

async function sendEmail(config: SMTPConfig, to: string, subject: string, body: string) {
  // This is a simplified email implementation
  // In a real deployment, you would use a proper SMTP library or service
  console.log(`Would send email to ${to}: ${subject}`)
  console.log(`Body: ${body}`)
  
  // For demo purposes, we'll just log the email
  // In production, implement actual SMTP sending here
}