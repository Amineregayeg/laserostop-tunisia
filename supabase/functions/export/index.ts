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
    const categoryParam = url.searchParams.get('category')
    const formatParam = url.searchParams.get('format') || 'csv'

    let startDate: string
    let endDate: string

    if (fromParam && toParam) {
      startDate = fromParam
      endDate = toParam
    } else {
      // Default to current month
      const now = new Date()
      const start = new Date(now.getFullYear(), now.getMonth(), 1)
      const end = new Date(now.getFullYear(), now.getMonth() + 1, 0)
      
      startDate = start.toISOString().split('T')[0]
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
        created_at,
        updated_at
      `)
      .gte('date', startDate)
      .lte('date', endDate)
      .order('slot_start_utc', { ascending: true })

    // Add category filter if specified
    if (categoryParam && ['tabac', 'drogue', 'drogue_dure'].includes(categoryParam)) {
      query = query.eq('category', categoryParam)
    }

    const { data: bookings, error } = await query

    if (error) {
      console.error('Database error:', error)
      throw new Error('Erreur lors de la récupération des données')
    }

    if (!bookings || bookings.length === 0) {
      return new Response(
        JSON.stringify({
          success: false,
          message: 'Aucune donnée à exporter pour la période sélectionnée'
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 404,
        }
      )
    }

    // Format the data
    const formattedBookings = bookings.map(booking => ({
      ...booking,
      local_start_time: new Date(booking.slot_start_utc).toLocaleString('fr-TN', {
        timeZone: 'Africa/Tunis',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }),
      local_end_time: new Date(booking.slot_end_utc).toLocaleString('fr-TN', {
        timeZone: 'Africa/Tunis',
        hour12: false,
        hour: '2-digit',
        minute: '2-digit'
      }),
      local_date: new Date(booking.slot_start_utc).toLocaleDateString('fr-TN', {
        timeZone: 'Africa/Tunis'
      }),
      formatted_created_at: new Date(booking.created_at).toLocaleString('fr-TN', {
        timeZone: 'Africa/Tunis'
      })
    }))

    // Generate export based on format
    if (formatParam === 'csv') {
      const csv = generateCSV(formattedBookings)
      
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': `attachment; filename="reservations_${startDate}_${endDate}.csv"`
        },
        status: 200,
      })
    } else {
      // Return JSON for client-side processing
      return new Response(
        JSON.stringify({
          success: true,
          bookings: formattedBookings,
          export_info: {
            total_records: formattedBookings.length,
            period_start: startDate,
            period_end: endDate,
            exported_at: new Date().toISOString(),
            filters: {
              category: categoryParam || 'all'
            }
          }
        }),
        {
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200,
        }
      )
    }

  } catch (error) {
    console.error('Error in export function:', error)
    
    return new Response(
      JSON.stringify({
        success: false,
        message: error.message || 'Une erreur est survenue lors de l\'exportation'
      }),
      {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400,
      }
    )
  }
})

// Generate CSV content
function generateCSV(bookings: any[]): string {
  // Category translations
  const categories = {
    tabac: 'Arrêt du tabac',
    drogue: 'Sevrage drogue', 
    drogue_dure: 'Sevrage drogues dures'
  }

  // Status translations
  const statuses = {
    booked: 'Confirmé',
    cancelled: 'Annulé',
    completed: 'Terminé'
  }

  // CSV headers
  const headers = [
    'Date',
    'Heure début',
    'Heure fin', 
    'Nom du client',
    'Téléphone',
    'Catégorie',
    'Statut',
    'Notes',
    'Créé le',
    'ID'
  ]

  // Convert bookings to CSV rows
  const rows = bookings.map(booking => [
    escapeCSV(booking.local_date),
    escapeCSV(booking.local_start_time),
    escapeCSV(booking.local_end_time),
    escapeCSV(booking.client_name),
    escapeCSV(booking.phone),
    escapeCSV(categories[booking.category as keyof typeof categories] || booking.category),
    escapeCSV(statuses[booking.status as keyof typeof statuses] || booking.status),
    escapeCSV(booking.notes || ''),
    escapeCSV(booking.formatted_created_at),
    escapeCSV(booking.id)
  ])

  // Combine headers and rows
  const csvContent = [
    headers.join(','),
    ...rows.map(row => row.join(','))
  ].join('\n')

  // Add BOM for Excel compatibility
  return '\ufeff' + csvContent
}

// Escape CSV values
function escapeCSV(value: string | null | undefined): string {
  if (value == null) return '""'
  
  const stringValue = String(value)
  
  // If the value contains comma, quote, or newline, wrap in quotes and escape quotes
  if (stringValue.includes(',') || stringValue.includes('"') || stringValue.includes('\n') || stringValue.includes('\r')) {
    return `"${stringValue.replace(/"/g, '""')}"`
  }
  
  return stringValue
}