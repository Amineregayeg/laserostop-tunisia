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
    const fromParam = url.searchParams.get('from')
    const toParam = url.searchParams.get('to')

    let startDate: string
    let endDate: string

    if (fromParam && toParam) {
      startDate = fromParam
      endDate = toParam
    } else {
      // Default to current week (Tuesday to Saturday)
      const now = new Date()
      const start = getWeekStart(now)
      startDate = start.toISOString().split('T')[0]
      
      const end = new Date(start)
      end.setDate(start.getDate() + 4) // Saturday
      endDate = end.toISOString().split('T')[0]
    }

    // Get overall statistics
    const { data: allBookings, error: allError } = await supabaseClient
      .from('bookings')
      .select('id, category, status, date, slot_start_utc')
      .gte('date', startDate)
      .lte('date', endDate)

    if (allError) {
      console.error('Database error:', allError)
      throw new Error('Erreur lors de la récupération des statistiques')
    }

    const bookings = allBookings || []

    // Calculate basic stats
    const totalBookings = bookings.length
    const confirmedBookings = bookings.filter(b => b.status === 'booked').length
    const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length
    const completedBookings = bookings.filter(b => b.status === 'completed').length

    // Calculate weekly bookings (for current week only)
    const currentWeekStart = getWeekStart(new Date())
    const currentWeekEnd = new Date(currentWeekStart)
    currentWeekEnd.setDate(currentWeekStart.getDate() + 4)

    const weeklyBookings = bookings.filter(b => {
      const bookingDate = new Date(b.date)
      return bookingDate >= currentWeekStart && bookingDate <= currentWeekEnd
    }).length

    // Calculate category distribution
    const categories = {
      tabac: bookings.filter(b => b.category === 'tabac').length,
      drogue: bookings.filter(b => b.category === 'drogue').length,
      drogue_dure: bookings.filter(b => b.category === 'drogue_dure').length
    }

    // Calculate fill rate (estimated based on available slots)
    const fillRate = calculateFillRate(startDate, endDate, confirmedBookings)

    // Get recent bookings for additional insights
    const { data: recentBookings, error: recentError } = await supabaseClient
      .from('bookings')
      .select(`
        id,
        date,
        slot_start_utc,
        client_name,
        category,
        status,
        created_at
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('created_at', { ascending: false })
      .limit(10)

    if (recentError) {
      console.error('Recent bookings error:', recentError)
    }

    // Calculate daily distribution
    const dailyStats = calculateDailyStats(bookings, startDate, endDate)

    // Calculate peak times
    const timeSlotStats = calculateTimeSlotStats(bookings)

    return new Response(
      JSON.stringify({
        success: true,
        period: {
          start: startDate,
          end: endDate
        },
        summary: {
          total_bookings: totalBookings,
          weekly_bookings: weeklyBookings,
          confirmed_bookings: confirmedBookings,
          cancelled_bookings: cancelledBookings,
          completed_bookings: completedBookings,
          fill_rate: fillRate
        },
        categories,
        daily_stats: dailyStats,
        time_slots: timeSlotStats,
        recent_bookings: recentBookings || [],
        insights: generateInsights(bookings, categories, fillRate)
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      }
    )

  } catch (error) {
    console.error('Error in stats function:', error)
    
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

// Helper function to get the start of the business week (Tuesday)
function getWeekStart(date: Date): Date {
  const d = new Date(date)
  const day = d.getDay()
  
  // Calculate days to get to Tuesday
  let daysToTuesday: number
  
  if (day === 0) { // Sunday
    daysToTuesday = 2 // Go forward to Tuesday
  } else if (day === 1) { // Monday  
    daysToTuesday = 1 // Go forward to Tuesday
  } else if (day === 2) { // Tuesday
    daysToTuesday = 0 // Already Tuesday
  } else { // Wednesday onwards
    daysToTuesday = 7 - (day - 2) // Go to next Tuesday
  }
  
  const tuesday = new Date(d)
  tuesday.setDate(d.getDate() + daysToTuesday)
  tuesday.setHours(0, 0, 0, 0)
  
  return tuesday
}

// Calculate estimated fill rate based on available slots
function calculateFillRate(startDate: string, endDate: string, confirmedBookings: number): number {
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  let totalSlots = 0
  
  // Count available slots for each day
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayOfWeek = d.getDay()
    
    switch (dayOfWeek) {
      case 2: // Tuesday
      case 3: // Wednesday
      case 4: // Thursday
        totalSlots += 8 // 8 slots (10-18, hourly)
        break
      case 5: // Friday
        totalSlots += 6 // 6 slots (including 14:30-15:30)
        break
      case 6: // Saturday
        totalSlots += 7 // 7 slots (10-17, hourly)
        break
      // Sunday and Monday are closed
    }
  }
  
  if (totalSlots === 0) return 0
  
  return Math.round((confirmedBookings / totalSlots) * 100)
}

// Calculate daily statistics
function calculateDailyStats(bookings: any[], startDate: string, endDate: string) {
  const dailyStats: Record<string, any> = {}
  
  const start = new Date(startDate)
  const end = new Date(endDate)
  
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dateStr = d.toISOString().split('T')[0]
    const dayOfWeek = d.getDay()
    
    // Only include business days
    if ([2, 3, 4, 5, 6].includes(dayOfWeek)) {
      const dayBookings = bookings.filter(b => b.date === dateStr)
      
      dailyStats[dateStr] = {
        day_name: getDayName(dayOfWeek),
        total: dayBookings.length,
        confirmed: dayBookings.filter(b => b.status === 'booked').length,
        cancelled: dayBookings.filter(b => b.status === 'cancelled').length,
        categories: {
          tabac: dayBookings.filter(b => b.category === 'tabac').length,
          drogue: dayBookings.filter(b => b.category === 'drogue').length,
          drogue_dure: dayBookings.filter(b => b.category === 'drogue_dure').length
        }
      }
    }
  }
  
  return dailyStats
}

// Calculate time slot statistics
function calculateTimeSlotStats(bookings: any[]) {
  const timeSlots: Record<string, number> = {}
  
  bookings.forEach(booking => {
    if (booking.status === 'booked') {
      const startTime = new Date(booking.slot_start_utc).toLocaleTimeString('en-GB', {
        timeZone: 'Africa/Tunis',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      })
      
      timeSlots[startTime] = (timeSlots[startTime] || 0) + 1
    }
  })
  
  // Sort by popularity
  const sortedSlots = Object.entries(timeSlots)
    .sort(([,a], [,b]) => b - a)
    .slice(0, 5) // Top 5 time slots
  
  return Object.fromEntries(sortedSlots)
}

// Generate insights based on the data
function generateInsights(bookings: any[], categories: any, fillRate: number) {
  const insights = []
  
  // Fill rate insight
  if (fillRate > 80) {
    insights.push("Excellent taux de remplissage ! Considérez d'ajouter des créneaux.")
  } else if (fillRate < 30) {
    insights.push("Taux de remplissage faible. Envisagez des actions marketing.")
  }
  
  // Category insights
  const totalCategoryBookings = Object.values(categories).reduce((a: any, b: any) => a + b, 0)
  if (totalCategoryBookings > 0) {
    const topCategory = Object.entries(categories).reduce((a, b) => a[1] > b[1] ? a : b)
    const categoryNames = {
      tabac: 'arrêt du tabac',
      drogue: 'sevrage drogue',
      drogue_dure: 'sevrage drogues dures'
    }
    insights.push(`Catégorie la plus demandée: ${categoryNames[topCategory[0] as keyof typeof categoryNames]}`)
  }
  
  // Cancellation rate insight
  const totalBookings = bookings.length
  const cancelledBookings = bookings.filter(b => b.status === 'cancelled').length
  
  if (totalBookings > 0) {
    const cancellationRate = (cancelledBookings / totalBookings) * 100
    if (cancellationRate > 15) {
      insights.push(`Taux d'annulation élevé (${cancellationRate.toFixed(1)}%). Vérifiez les rappels.`)
    }
  }
  
  return insights
}

// Helper function to get day name
function getDayName(dayOfWeek: number): string {
  const dayNames = {
    0: 'Dimanche',
    1: 'Lundi',
    2: 'Mardi', 
    3: 'Mercredi',
    4: 'Jeudi',
    5: 'Vendredi',
    6: 'Samedi'
  }
  
  return dayNames[dayOfWeek as keyof typeof dayNames] || 'Inconnu'
}