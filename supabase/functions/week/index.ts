import { serve } from "https://deno.land/std@0.208.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // Only allow GET requests
    if (req.method !== 'GET') {
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

    // Parse query parameters
    const url = new URL(req.url)
    const startParam = url.searchParams.get('start')
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')
    const categoryParam = url.searchParams.get('category')
    const centerParam = url.searchParams.get('center') || 'tunis'

    let startDate: string
    let endDate: string

    if (startParam) {
      // Week mode: get bookings for the week starting from the given date
      const start = new Date(startParam)
      
      // Ensure we start on Monday (our business week start)
      const dayOfWeek = start.getDay()
      if (dayOfWeek !== 1) { // Not Monday
        const daysToSubtract = dayOfWeek === 0 ? 6 : dayOfWeek - 1
        start.setDate(start.getDate() - daysToSubtract)
      }

      startDate = start.toISOString().split('T')[0]

      // End on Saturday (5 days from Monday: Mon, Tue, Wed, Thu, Fri, Sat)
      const end = new Date(start)
      end.setDate(start.getDate() + 5)
      endDate = end.toISOString().split('T')[0]
      
    } else if (fromParam && toParam) {
      // Date range mode
      startDate = fromParam
      endDate = toParam
    } else {
      // Default to current week
      const now = new Date()
      const start = getWeekStart(now)
      startDate = start.toISOString().split('T')[0]
      
      const end = new Date(start)
      end.setDate(start.getDate() + 5)
      endDate = end.toISOString().split('T')[0]
    }

    // Build query
    let query = supabaseClient
      .from('bookings')
      .select(`
        id,
        date,
        slot_start_utc,
        slot_end_utc,
        client_name,
        phone,
        category,
        notes,
        status,
        center,
        session_duration,
        session_type,
        created_at,
        updated_at
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .eq('center', centerParam)
      .order('slot_start_utc', { ascending: true })

    // Add category filter if specified
    if (categoryParam && ['tabac', 'drogue', 'drogue_dure', 'drogue_douce', 'renforcement'].includes(categoryParam)) {
      query = query.eq('category', categoryParam)
    }

    const { data: bookings, error } = await query

    if (error) {
      console.error('Database error:', error)
      throw new Error('Erreur lors de la récupération des données')
    }

    // Format response
    const formattedBookings = (bookings || []).map(booking => ({
      ...booking,
      // Add computed fields for easier frontend use
      local_start_time: new Date(booking.slot_start_utc).toLocaleString('en-GB', {
        timeZone: 'Africa/Tunis',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }),
      local_end_time: new Date(booking.slot_end_utc).toLocaleString('en-GB', {
        timeZone: 'Africa/Tunis',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }),
      local_date: new Date(booking.slot_start_utc).toLocaleDateString('fr-TN', {
        timeZone: 'Africa/Tunis'
      }),
      day_of_week: getDayName(new Date(booking.slot_start_utc), 'Africa/Tunis')
    }))

    return new Response(
      JSON.stringify({
        success: true,
        bookings: formattedBookings,
        period: {
          start: startDate,
          end: endDate,
          total_count: formattedBookings.length,
          active_count: formattedBookings.filter(b => b.status === 'booked').length,
          cancelled_count: formattedBookings.filter(b => b.status === 'cancelled').length
        }
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in week function:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || 'Une erreur est survenue',
        bookings: []
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

// Helper function to get the start of the business week (Monday)
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  // Sunday = 0, Monday = 1, etc.
  const daysToMonday = day === 0 ? -6 : 1 - day
  const monday = new Date(d)
  monday.setDate(d.getDate() + daysToMonday)
  monday.setHours(0, 0, 0, 0)
  return monday
}

// Helper function to get day name in French
function getDayName(date: Date, timeZone: string): string {
  const dayNames = {
    0: 'Dimanche',
    1: 'Lundi', 
    2: 'Mardi',
    3: 'Mercredi',
    4: 'Jeudi',
    5: 'Vendredi',
    6: 'Samedi'
  }
  
  const localDate = new Date(date.toLocaleString('en-US', { timeZone }))
  return dayNames[localDate.getDay() as keyof typeof dayNames] || 'Inconnu'
}