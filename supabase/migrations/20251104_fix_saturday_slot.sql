-- Fix business hours slots in get_available_slots() function
-- Tue-Thu: Extended to 19:00 (was 18:00) - adds 18:00-19:00 slots
-- Saturday: Extended to 18:00 (was 17:00) - adds 17:00-18:00 slots

CREATE OR REPLACE FUNCTION get_available_slots(week_start TIMESTAMP)
RETURNS TABLE (
    day_of_week TEXT,
    slot_date DATE,
    time_slot TEXT,
    is_available BOOLEAN,
    booking_id UUID,
    client_name TEXT,
    category TEXT
) AS $$
BEGIN
    RETURN QUERY
    WITH time_slots AS (
        -- Tuesday to Thursday: 10:00 to 19:00
        SELECT
            generate_series(
                week_start::DATE,
                week_start::DATE + INTERVAL '4 days',
                INTERVAL '1 day'
            )::DATE as date,
            unnest(ARRAY[
                '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00',
                '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00',
                '18:00-19:00'
            ]) as time_slot
        WHERE
            -- Tuesday to Thursday: all slots
            EXTRACT(DOW FROM generate_series) IN (2, 3, 4)
        UNION ALL
        SELECT
            generate_series(
                week_start::DATE + INTERVAL '3 days',
                week_start::DATE + INTERVAL '3 days',
                INTERVAL '1 day'
            )::DATE as date,
            unnest(ARRAY[
                '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00',
                '14:00-15:00', '14:30-15:30'
            ]) as time_slot
        WHERE
            -- Friday: special slots
            EXTRACT(DOW FROM generate_series) = 5
        UNION ALL
        SELECT
            generate_series(
                week_start::DATE + INTERVAL '4 days',
                week_start::DATE + INTERVAL '4 days',
                INTERVAL '1 day'
            )::DATE as date,
            unnest(ARRAY[
                '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00',
                '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'
            ]) as time_slot
        WHERE
            -- Saturday: NOW includes 17:00-18:00 slot
            EXTRACT(DOW FROM generate_series) = 6
    )
    SELECT
        CASE EXTRACT(DOW FROM ts.date)
            WHEN 2 THEN 'Mardi'
            WHEN 3 THEN 'Mercredi'
            WHEN 4 THEN 'Jeudi'
            WHEN 5 THEN 'Vendredi'
            WHEN 6 THEN 'Samedi'
        END as day_of_week,
        ts.date as slot_date,
        ts.time_slot,
        (b.id IS NULL) as is_available,
        b.id as booking_id,
        b.client_name,
        b.category
    FROM time_slots ts
    LEFT JOIN bookings b ON (
        b.date = ts.date
        AND b.status = 'booked'
        AND CONCAT(
            TO_CHAR(b.slot_start_utc AT TIME ZONE 'Africa/Tunis', 'HH24:MI'),
            '-',
            TO_CHAR(b.slot_end_utc AT TIME ZONE 'Africa/Tunis', 'HH24:MI')
        ) = ts.time_slot
    )
    ORDER BY ts.date, ts.time_slot;
END;
$$ LANGUAGE plpgsql;

-- Test queries to verify updated slots
-- Run after migration:

-- Test Tuesday-Thursday (should have 18:00-19:00):
-- SELECT * FROM get_available_slots((SELECT date_trunc('week', CURRENT_DATE + INTERVAL '1 week') + INTERVAL '1 day'))
-- WHERE day_of_week IN ('Mardi', 'Mercredi', 'Jeudi') ORDER BY slot_date, time_slot;
-- Expected: 9 slots per day (10:00-11:00 through 18:00-19:00)

-- Test Saturday (should have 17:00-18:00):
-- SELECT * FROM get_available_slots((SELECT date_trunc('week', CURRENT_DATE + INTERVAL '1 week') + INTERVAL '1 day'))
-- WHERE day_of_week = 'Samedi' ORDER BY time_slot;
-- Expected: 8 slots (10:00-11:00 through 17:00-18:00, NOT 18:00-19:00)
