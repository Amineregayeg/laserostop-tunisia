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

    // Get today's date in Tunisia timezone
    const today = new Date().toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })
    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })

    if (isExport) {
      // Export data for the last 30 days
      const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toLocaleDateString('sv-SE', { timeZone: 'Africa/Tunis' })
      
      const { data: exportData, error: exportError } = await supabaseClient
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
          follow_up_notes
        `)
        .gte('date', thirtyDaysAgo)
        .eq('session_confirmed', true)
        .order('date', { ascending: false })

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

    // Get today's summary
    const { data: todayData, error: todayError } = await supabaseClient
      .from('daily_financial_summary')
      .select('*')
      .eq('date', today)
      .single()

    if (todayError && todayError.code !== 'PGRST116') {
      console.error('Today summary error:', todayError)
    }

    // Get weekly summary (last 7 days)
    const { data: weeklyData, error: weeklyError } = await supabaseClient
      .from('daily_financial_summary')
      .select('*')
      .gte('date', weekAgo)
      .order('date', { ascending: true })

    if (weeklyError) {
      console.error('Weekly summary error:', weeklyError)
    }

    // Calculate weekly totals
    const weeklyTotals = weeklyData?.reduce((acc, day) => ({
      total_sessions: acc.total_sessions + (day.total_sessions || 0),
      confirmed_sessions: acc.confirmed_sessions + (day.confirmed_sessions || 0),
      total_revenue: acc.total_revenue + (day.confirmed_revenue || 0),
      expected_revenue: acc.expected_revenue + (day.expected_revenue || 0)
    }), {
      total_sessions: 0,
      confirmed_sessions: 0,
      total_revenue: 0,
      expected_revenue: 0
    }) || {
      total_sessions: 0,
      confirmed_sessions: 0,
      total_revenue: 0,
      expected_revenue: 0
    }

    const avgSessionPrice = weeklyTotals.confirmed_sessions > 0 
      ? weeklyTotals.total_revenue / weeklyTotals.confirmed_sessions 
      : 0

    // Prepare daily chart data for the last 7 days
    const dailyChartData = weeklyData?.map(day => ({
      day: new Date(day.date).toLocaleDateString('fr-TN', { 
        weekday: 'short',
        timeZone: 'Africa/Tunis'
      }),
      revenue: day.confirmed_revenue || 0,
      sessions: day.confirmed_sessions || 0
    })) || []

    // Get category breakdown for current month
    const firstOfMonth = new Date().toLocaleDateString('sv-SE', { 
      timeZone: 'Africa/Tunis'
    }).slice(0, 8) + '01'

    const { data: categoryData, error: categoryError } = await supabaseClient
      .from('financial_stats_by_category')
      .select('*')

    if (categoryError) {
      console.error('Category stats error:', categoryError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        today: {
          total_sessions: todayData?.total_sessions || 0,
          confirmed_sessions: todayData?.confirmed_sessions || 0,
          absent_sessions: todayData?.absent_sessions || 0,
          pending_sessions: todayData?.pending_sessions || 0,
          expected_revenue: todayData?.expected_revenue || 0,
          confirmed_revenue: todayData?.confirmed_revenue || 0,
          avg_session_price: todayData?.avg_session_price || 0
        },
        weekly: {
          total_sessions: weeklyTotals.total_sessions,
          confirmed_sessions: weeklyTotals.confirmed_sessions,
          total_revenue: weeklyTotals.total_revenue,
          expected_revenue: weeklyTotals.expected_revenue,
          avg_session_price: Math.round(avgSessionPrice * 100) / 100,
          daily_data: dailyChartData
        },
        categories: categoryData || [],
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