import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

interface CancelRequest {
  id: string
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
    const { id }: CancelRequest = await req.json()

    // Validate required fields
    if (!id) {
      throw new Error('ID du rendez-vous obligatoire')
    }

    // Check if booking exists and is cancellable
    const { data: existingBooking, error: fetchError } = await supabaseClient
      .from('bookings')
      .select('*')
      .eq('id', id)
      .single()

    if (fetchError) {
      console.error('Fetch error:', fetchError)
      throw new Error('Rendez-vous introuvable')
    }

    if (!existingBooking) {
      throw new Error('Rendez-vous introuvable')
    }

    if (existingBooking.status !== 'booked') {
      throw new Error('Ce rendez-vous ne peut pas être annulé')
    }

    // Check if booking is not in the past (optional business rule)
    const now = new Date()
    const bookingStart = new Date(existingBooking.slot_start_utc)
    
    if (bookingStart < now) {
      // Allow cancellation of past bookings for admin flexibility
      console.log('Cancelling past booking:', id)
    }

    // Update booking status to cancelled
    const { data: cancelledBooking, error: updateError } = await supabaseClient
      .from('bookings')
      .update({ 
        status: 'cancelled',
        updated_at: new Date().toISOString()
      })
      .eq('id', id)
      .select()
      .single()

    if (updateError) {
      console.error('Update error:', updateError)
      throw new Error('Erreur lors de l\'annulation')
    }

    // Send cancellation notification email (optional)
    try {
      await sendCancellationNotification(cancelledBooking, supabaseClient)
    } catch (emailError) {
      console.error('Email notification failed:', emailError)
      // Don't fail the cancellation if email fails
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: 'Rendez-vous annulé avec succès',
        booking: cancelledBooking
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in cancel-booking:', error)
    
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

// Helper function to send cancellation notification
async function sendCancellationNotification(booking: any, supabaseClient: any) {
  // Check if email notifications are enabled
  const { data: emailEnabled } = await supabaseClient
    .from('settings')
    .select('value')
    .eq('id', 'smtp_enabled')
    .single()

  if (emailEnabled?.value !== 'true') {
    console.log('Email notifications disabled')
    return
  }

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

  const smtpConfig = {
    host: Deno.env.get('SMTP_HOST') || '',
    port: parseInt(Deno.env.get('SMTP_PORT') || '587'),
    user: Deno.env.get('SMTP_USER') || '',
    pass: Deno.env.get('SMTP_PASS') || '',
    from: Deno.env.get('FROM_EMAIL') || ''
  }

  // Validate SMTP configuration
  if (!smtpConfig.host || !smtpConfig.user || !smtpConfig.pass || !smtpConfig.from) {
    console.log('SMTP not configured, skipping cancellation notification')
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

  const subject = 'Rendez-vous annulé - LaserOstop'
  const body = `
Rendez-vous annulé:

Client: ${booking.client_name}
Téléphone: ${booking.phone}
Date et heure: ${startTime}
Catégorie: ${categories[booking.category] || booking.category}
${booking.notes ? `Notes: ${booking.notes}` : ''}

Le créneau est maintenant disponible pour une nouvelle réservation.

---
LaserOstop Tunisie
  `.trim()

  try {
    // Log the cancellation notification
    console.log(`Cancellation notification for ${booking.client_name}:`)
    console.log(`To: ${settings.value}`)
    console.log(`Subject: ${subject}`)
    console.log(`Body: ${body}`)
    
    // In a real implementation, send the actual email here
    // await sendEmail(smtpConfig, settings.value, subject, body)

  } catch (error) {
    console.error('Failed to send cancellation email:', error)
    throw error
  }
}