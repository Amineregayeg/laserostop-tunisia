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

    const url = new URL(req.url)
    const isExport = url.searchParams.get('export') === 'true'
    const centerParam = url.searchParams.get('center') || 'tunis'

    // Get today's date in Tunisia timezone
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })

    if (isExport) {
      // Export data for the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })

      let exportQuery = supabaseClient
        .from('bookings')
        .select(`
          date,
          client_name,
          category,
          session_duration,
          standard_price,
          actual_price,
          attendance_status,
          price_notes,
          follow_up_notes,
          center
        `)
        .gte('date', thirtyDaysAgo)
        .eq('session_confirmed', true)
        .order('date', { ascending: false })

      if (centerParam !== 'all') {
        exportQuery = exportQuery.eq('center', centerParam)
      }

      const { data: exportData, error: exportError } = await exportQuery

      if (exportError) {
        console.error('Export error:', exportError)
        throw new Error('Erreur lors de l\'export des données')
      }

      return new Response(
        JSON.stringify({
          success: true,
          export_data: exportData || []
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

    // Get today's bookings directly (center-aware)
    let todayQuery = supabaseClient
      .from('bookings')
      .select('id, category, attendance_status, standard_price, actual_price, status')
      .eq('date', today)
    if (centerParam !== 'all') {
      todayQuery = todayQuery.eq('center', centerParam)
    }
    const { data: todayBookings, error: todayError } = await todayQuery

    if (todayError) {
      console.error('Today bookings error:', todayError)
    }

    const tb = todayBookings || []
    const todayData = {
      total_sessions: tb.length,
      confirmed_sessions: tb.filter(b => b.attendance_status === 'present').length,
      absent_sessions: tb.filter(b => b.attendance_status === 'absent').length,
      pending_sessions: tb.filter(b => b.attendance_status === 'pending' || !b.attendance_status).length,
      expected_revenue: tb.reduce((sum, b) => sum + (b.standard_price || 0), 0),
      confirmed_revenue: tb.filter(b => b.attendance_status === 'present').reduce((sum, b) => sum + (b.actual_price || 0), 0),
      avg_session_price: 0
    }
    if (todayData.confirmed_sessions > 0) {
      todayData.avg_session_price = Math.round((todayData.confirmed_revenue / todayData.confirmed_sessions) * 100) / 100
    }

    // Get weekly bookings directly (center-aware)
    let weeklyQuery = supabaseClient
      .from('bookings')
      .select('id, date, category, attendance_status, standard_price, actual_price, status')
      .gte('date', weekAgo)
    if (centerParam !== 'all') {
      weeklyQuery = weeklyQuery.eq('center', centerParam)
    }
    const { data: weeklyBookings, error: weeklyError } = await weeklyQuery

    if (weeklyError) {
      console.error('Weekly bookings error:', weeklyError)
    }

    // Group weekly data by date for chart
    const wb = weeklyBookings || []
    const dailyMap = new Map<string, any[]>()
    wb.forEach(b => {
      const d = b.date
      if (!dailyMap.has(d)) dailyMap.set(d, [])
      dailyMap.get(d)!.push(b)
    })

    const weeklyData = Array.from(dailyMap.entries()).map(([date, bookings]) => ({
      date,
      total_sessions: bookings.length,
      confirmed_sessions: bookings.filter(b => b.attendance_status === 'present').length,
      confirmed_revenue: bookings.filter(b => b.attendance_status === 'present').reduce((sum, b) => sum + (b.actual_price || 0), 0),
      expected_revenue: bookings.reduce((sum, b) => sum + (b.standard_price || 0), 0)
    })).sort((a, b) => a.date.localeCompare(b.date))

    // Calculate weekly totals
    const weeklyTotals = weeklyData.reduce((acc, day) => ({
      total_sessions: acc.total_sessions + (day.total_sessions || 0),
      confirmed_sessions: acc.confirmed_sessions + (day.confirmed_sessions || 0),
      total_revenue: acc.total_revenue + (day.confirmed_revenue || 0),
      expected_revenue: acc.expected_revenue + (day.expected_revenue || 0)
    }), {
      total_sessions: 0,
      confirmed_sessions: 0,
      total_revenue: 0,
      expected_revenue: 0
    })

    const avgSessionPrice = weeklyTotals.confirmed_sessions > 0
      ? weeklyTotals.total_revenue / weeklyTotals.confirmed_sessions
      : 0

    // Prepare daily chart data for the last 7 days
    const dailyChartData = weeklyData.map(day => ({
      day: new Date(day.date).toLocaleDateString('fr-TN', {
        weekday: 'short',
        timeZone: 'Africa/Tunis'
      }),
      revenue: day.confirmed_revenue || 0,
      sessions: day.confirmed_sessions || 0
    }))

    return new Response(
      JSON.stringify({
        success: true,
        today: {
          total_sessions: todayData.total_sessions,
          confirmed_sessions: todayData.confirmed_sessions,
          absent_sessions: todayData.absent_sessions,
          pending_sessions: todayData.pending_sessions,
          expected_revenue: todayData.expected_revenue,
          confirmed_revenue: todayData.confirmed_revenue,
          avg_session_price: todayData.avg_session_price
        },
        weekly: {
          total_sessions: weeklyTotals.total_sessions,
          confirmed_sessions: weeklyTotals.confirmed_sessions,
          total_revenue: weeklyTotals.total_revenue,
          expected_revenue: weeklyTotals.expected_revenue,
          avg_session_price: Math.round(avgSessionPrice * 100) / 100,
          daily_data: dailyChartData
        },
        categories: [],
        summary_date: today
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in financial-summary:', error)
    
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