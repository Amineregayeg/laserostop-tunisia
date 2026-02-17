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
    const dateFilter = url.searchParams.get('date_filter') || 'today'
    const categoryFilter = url.searchParams.get('category')
    const centerParam = url.searchParams.get('center') || 'tunis'

    // Build date filter conditions
    let dateCondition = ''
    const now = new Date()
    const today = now.toISOString().split('T')[0]
    const yesterday = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString().split('T')[0]
    const weekAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]

    switch (dateFilter) {
      case 'today':
        dateCondition = `date = '${today}'`
        break
      case 'yesterday':
        dateCondition = `date = '${yesterday}'`
        break
      case 'week':
        dateCondition = `date >= '${weekAgo}'`
        break
      case 'all':
        dateCondition = `date >= '${weekAgo}'`
        break
      default:
        dateCondition = `date = '${today}'`
    }

    // Build query directly on bookings table for center support
    let query = supabaseClient
      .from('bookings')
      .select('id, client_name, phone, date, slot_start_utc, slot_end_utc, session_duration, session_type, category, notes, status, session_confirmed, center')
      .eq('session_confirmed', false)
      .in('status', ['booked', 'completed'])
      .gte('date', weekAgo)

    // Apply center filter
    if (centerParam !== 'all') {
      query = query.eq('center', centerParam)
    }

    // Apply date filters
    if (dateFilter === 'today') {
      query = query.eq('date', today)
    } else if (dateFilter === 'yesterday') {
      query = query.eq('date', yesterday)
    } else if (dateFilter === 'week' || dateFilter === 'all') {
      query = query.gte('date', weekAgo)
    }

    if (categoryFilter) {
      query = query.eq('category', categoryFilter)
    }

    const { data: sessions, error } = await query.order('slot_start_utc', { ascending: true })

    if (error) {
      console.error('Database error:', error)
      throw new Error('Erreur lors de la récupération des séances')
    }

    // Add urgency status based on current time
    const sessionsWithStatus = sessions?.map(session => {
      const slotStart = new Date(session.slot_start_utc)
      const twoHoursAgo = new Date(now.getTime() - 2 * 60 * 60 * 1000)
      const oneHourFromNow = new Date(now.getTime() + 60 * 60 * 1000)

      let urgencyStatus = 'upcoming'
      if (slotStart < twoHoursAgo) {
        urgencyStatus = 'overdue'
      } else if (slotStart < oneHourFromNow) {
        urgencyStatus = 'current'
      }

      return {
        ...session,
        urgency_status: urgencyStatus
      }
    }) || []

    return new Response(
      JSON.stringify({
        success: true,
        sessions: sessionsWithStatus,
        total: sessionsWithStatus.length
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in pending-sessions:', error)
    
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