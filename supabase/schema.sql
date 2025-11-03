-- ===== LaserOstop Planning Database Schema =====

-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ===== Bookings Table =====
CREATE TABLE bookings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    date DATE NOT NULL,
    slot_start_utc TIMESTAMPTZ NOT NULL,
    slot_end_utc TIMESTAMPTZ NOT NULL,
    client_name TEXT NOT NULL,
    phone TEXT NOT NULL,
    category TEXT NOT NULL CHECK (category IN ('tabac', 'drogue', 'drogue_dure')),
    notes TEXT,
    session_duration INTEGER DEFAULT 60 CHECK (session_duration IN (30, 60, 90)),
    session_type TEXT DEFAULT 'solo' CHECK (session_type IN ('solo', 'duo')),
    status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked', 'cancelled', 'completed', 'confirmed', 'absent', 'rescheduled')),
    
    -- Financial tracking fields
    standard_price DECIMAL(10,2),
    actual_price DECIMAL(10,2),
    price_notes TEXT,
    payment_status TEXT DEFAULT 'pending' CHECK (payment_status IN ('pending', 'paid', 'free', 'partial')),
    
    -- Follow-up tracking fields
    attendance_status TEXT DEFAULT 'pending' CHECK (attendance_status IN ('pending', 'present', 'absent', 'rescheduled')),
    session_confirmed BOOLEAN DEFAULT FALSE,
    session_confirmed_at TIMESTAMPTZ,
    session_confirmed_by TEXT,
    follow_up_notes TEXT,
    
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    notification_sent BOOLEAN DEFAULT FALSE
);

-- Create unique index to prevent double bookings for the same slot
CREATE UNIQUE INDEX unique_active_slot ON bookings(slot_start_utc) 
WHERE status = 'booked';

-- Index for efficient queries
CREATE INDEX idx_bookings_date ON bookings(date);
CREATE INDEX idx_bookings_status ON bookings(status);
CREATE INDEX idx_bookings_category ON bookings(category);
CREATE INDEX idx_bookings_created_at ON bookings(created_at);

-- ===== Settings Table =====
CREATE TABLE settings (
    id TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Insert default settings
INSERT INTO settings (id, value, description) VALUES 
('notification_email', 'contact@laserostop.tn', 'Email address for booking notifications'),
('smtp_enabled', 'true', 'Enable/disable email notifications'),
('business_name', 'LaserOstop Tunisie', 'Business name for notifications'),
('timezone', 'Africa/Tunis', 'Business timezone'),
('booking_advance_days', '30', 'Maximum days in advance for bookings'),
('max_daily_bookings', '8', 'Maximum bookings per day');

-- ===== Trigger for updated_at =====
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER update_bookings_updated_at 
    BEFORE UPDATE ON bookings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER update_settings_updated_at 
    BEFORE UPDATE ON settings 
    FOR EACH ROW 
    EXECUTE FUNCTION update_updated_at_column();

-- ===== Row Level Security (RLS) =====
-- Enable RLS on tables
ALTER TABLE bookings ENABLE ROW LEVEL SECURITY;
ALTER TABLE settings ENABLE ROW LEVEL SECURITY;

-- Policies for bookings (allow all operations for now - can be restricted later)
CREATE POLICY "Allow all operations on bookings" ON bookings
    FOR ALL USING (true) WITH CHECK (true);

-- Policies for settings (allow read, restrict write)
CREATE POLICY "Allow read access to settings" ON settings
    FOR SELECT USING (true);

CREATE POLICY "Allow update access to settings" ON settings
    FOR UPDATE USING (true) WITH CHECK (true);

-- ===== Views for Analytics =====

-- View for current week statistics
CREATE OR REPLACE VIEW current_week_stats AS
SELECT 
    COUNT(*) as total_bookings,
    COUNT(*) FILTER (WHERE status = 'booked') as confirmed_bookings,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_bookings,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_bookings,
    COUNT(DISTINCT category) as unique_categories,
    ROUND(
        (COUNT(*) FILTER (WHERE status = 'booked')::DECIMAL / 
         GREATEST(1, COUNT(*))) * 100, 1
    ) as fill_rate_percentage
FROM bookings 
WHERE date >= DATE_TRUNC('week', CURRENT_DATE + INTERVAL '1 day') -- Tuesday
AND date <= DATE_TRUNC('week', CURRENT_DATE + INTERVAL '1 day') + INTERVAL '4 days'; -- Saturday

-- View for category distribution
CREATE OR REPLACE VIEW category_stats AS
SELECT 
    category,
    COUNT(*) as count,
    COUNT(*) FILTER (WHERE status = 'booked') as active_count,
    ROUND(
        (COUNT(*)::DECIMAL / GREATEST(1, (SELECT COUNT(*) FROM bookings))) * 100, 1
    ) as percentage
FROM bookings 
GROUP BY category
ORDER BY count DESC;

-- View for monthly statistics
CREATE OR REPLACE VIEW monthly_stats AS
SELECT 
    DATE_TRUNC('month', created_at) as month,
    COUNT(*) as total_bookings,
    COUNT(*) FILTER (WHERE status = 'booked') as confirmed_bookings,
    COUNT(*) FILTER (WHERE status = 'cancelled') as cancelled_bookings,
    COUNT(*) FILTER (WHERE status = 'completed') as completed_bookings,
    COUNT(DISTINCT client_name) as unique_clients
FROM bookings 
GROUP BY DATE_TRUNC('month', created_at)
ORDER BY month DESC;

-- View for follow-up sessions (pending confirmation)
CREATE OR REPLACE VIEW pending_followup AS
SELECT 
    id,
    client_name,
    phone,
    date,
    slot_start_utc,
    slot_end_utc,
    session_duration,
    session_type,
    category,
    notes,
    get_standard_price(category) as standard_price,
    EXTRACT(EPOCH FROM (slot_end_utc - slot_start_utc))/60 as duration_minutes,
    CASE 
        WHEN slot_start_utc < NOW() - INTERVAL '2 hours' THEN 'overdue'
        WHEN slot_start_utc < NOW() + INTERVAL '1 hour' THEN 'current'
        ELSE 'upcoming'
    END as urgency_status
FROM bookings 
WHERE 
    session_confirmed = FALSE 
    AND status IN ('booked', 'completed')
    AND date >= CURRENT_DATE - INTERVAL '7 days'
ORDER BY slot_start_utc ASC;

-- View for daily financial summary
CREATE OR REPLACE VIEW daily_financial_summary AS
SELECT 
    date,
    COUNT(*) as total_sessions,
    COUNT(*) FILTER (WHERE attendance_status = 'present') as confirmed_sessions,
    COUNT(*) FILTER (WHERE attendance_status = 'absent') as absent_sessions,
    COUNT(*) FILTER (WHERE attendance_status = 'pending') as pending_sessions,
    SUM(COALESCE(standard_price, get_standard_price(category))) as expected_revenue,
    SUM(COALESCE(actual_price, 0)) as actual_revenue,
    SUM(COALESCE(actual_price, 0)) FILTER (WHERE attendance_status = 'present') as confirmed_revenue,
    ROUND(
        AVG(COALESCE(actual_price, 0)) FILTER (WHERE attendance_status = 'present'), 2
    ) as avg_session_price
FROM bookings 
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY date
ORDER BY date DESC;

-- View for financial statistics by category
CREATE OR REPLACE VIEW financial_stats_by_category AS
SELECT 
    category,
    COUNT(*) as total_sessions,
    COUNT(*) FILTER (WHERE attendance_status = 'present') as completed_sessions,
    get_standard_price(category) as standard_price,
    AVG(COALESCE(actual_price, 0)) FILTER (WHERE attendance_status = 'present') as avg_actual_price,
    SUM(COALESCE(actual_price, 0)) FILTER (WHERE attendance_status = 'present') as total_revenue,
    SUM(COALESCE(standard_price, get_standard_price(category))) as expected_revenue,
    COUNT(*) FILTER (WHERE payment_status = 'free') as free_sessions,
    COUNT(*) FILTER (WHERE payment_status = 'partial') as discounted_sessions
FROM bookings 
WHERE date >= CURRENT_DATE - INTERVAL '30 days'
GROUP BY category
ORDER BY total_revenue DESC;

-- ===== Functions =====

-- Function to get standard price for a category
CREATE OR REPLACE FUNCTION get_standard_price(category_name TEXT)
RETURNS DECIMAL(10,2) AS $$
BEGIN
    RETURN CASE category_name
        WHEN 'tabac' THEN 500.00
        WHEN 'drogue' THEN 750.00
        WHEN 'drogue_dure' THEN 1000.00
        ELSE 0.00
    END;
END;
$$ LANGUAGE plpgsql;

-- Function to update booking with follow-up data
CREATE OR REPLACE FUNCTION update_booking_followup(
    booking_id UUID,
    new_attendance_status TEXT,
    new_actual_price DECIMAL(10,2),
    new_price_notes TEXT DEFAULT '',
    new_follow_up_notes TEXT DEFAULT '',
    confirmed_by_user TEXT DEFAULT 'system'
) RETURNS BOOLEAN AS $$
DECLARE
    payment_status_val TEXT;
    standard_price_val DECIMAL(10,2);
BEGIN
    -- Get the booking's category to determine standard price
    SELECT category INTO standard_price_val FROM bookings WHERE id = booking_id;
    standard_price_val := get_standard_price(standard_price_val);
    
    -- Determine payment status based on actual price
    IF new_actual_price = 0 THEN
        payment_status_val := 'free';
    ELSIF new_actual_price >= standard_price_val THEN
        payment_status_val := 'paid';
    ELSE
        payment_status_val := 'partial';
    END IF;
    
    -- Update the booking
    UPDATE bookings 
    SET 
        attendance_status = new_attendance_status,
        actual_price = new_actual_price,
        price_notes = new_price_notes,
        follow_up_notes = new_follow_up_notes,
        payment_status = payment_status_val,
        session_confirmed = TRUE,
        session_confirmed_at = NOW(),
        session_confirmed_by = confirmed_by_user,
        standard_price = standard_price_val,
        status = CASE 
            WHEN new_attendance_status = 'present' THEN 'completed'
            WHEN new_attendance_status = 'absent' THEN 'cancelled'
            WHEN new_attendance_status = 'rescheduled' THEN 'rescheduled'
            ELSE status
        END,
        updated_at = NOW()
    WHERE id = booking_id;
    
    RETURN FOUND;
END;
$$ LANGUAGE plpgsql;

-- Function to get available slots for a given week
CREATE OR REPLACE FUNCTION get_available_slots(week_start DATE)
RETURNS TABLE(
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
        SELECT 
            generate_series(
                week_start::DATE,
                week_start::DATE + INTERVAL '4 days',
                INTERVAL '1 day'
            )::DATE as date,
            unnest(ARRAY[
                '10:00-11:00', '11:00-12:00', '12:00-13:00', '13:00-14:00',
                '14:00-15:00', '15:00-16:00', '16:00-17:00', '17:00-18:00'
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
                '14:00-15:00', '15:00-16:00', '16:00-17:00'
            ]) as time_slot
        WHERE 
            -- Saturday: no 17:00-18:00 slot
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

-- Function to validate business hours
CREATE OR REPLACE FUNCTION is_valid_business_slot(
    slot_date DATE,
    start_time TIME,
    end_time TIME
) RETURNS BOOLEAN AS $$
DECLARE
    day_of_week INTEGER;
BEGIN
    day_of_week := EXTRACT(DOW FROM slot_date);
    
    -- Only Tuesday (2) to Saturday (6)
    IF day_of_week NOT IN (2, 3, 4, 5, 6) THEN
        RETURN FALSE;
    END IF;
    
    -- Check time slots based on day
    CASE day_of_week
        WHEN 2, 3, 4 THEN -- Tuesday, Wednesday, Thursday
            RETURN start_time >= '10:00'::TIME AND end_time <= '18:00'::TIME;
        WHEN 5 THEN -- Friday
            RETURN (
                (start_time >= '10:00'::TIME AND end_time <= '15:00'::TIME) OR
                (start_time = '14:30'::TIME AND end_time = '15:30'::TIME)
            );
        WHEN 6 THEN -- Saturday
            RETURN start_time >= '10:00'::TIME AND end_time <= '17:00'::TIME;
        ELSE
            RETURN FALSE;
    END CASE;
END;
$$ LANGUAGE plpgsql;

-- Function to check for slot conflicts
CREATE OR REPLACE FUNCTION check_slot_conflict(
    check_date DATE,
    start_utc TIMESTAMPTZ,
    end_utc TIMESTAMPTZ,
    exclude_booking_id UUID DEFAULT NULL
) RETURNS BOOLEAN AS $$
DECLARE
    conflict_count INTEGER;
BEGIN
    SELECT COUNT(*) INTO conflict_count
    FROM bookings
    WHERE 
        date = check_date
        AND status = 'booked'
        AND (
            (slot_start_utc < end_utc AND slot_end_utc > start_utc)
        )
        AND (exclude_booking_id IS NULL OR id != exclude_booking_id);
    
    RETURN conflict_count > 0;
END;
$$ LANGUAGE plpgsql;

-- ===== Sample Data (for testing) =====
-- Uncomment to insert sample bookings for testing
/*
INSERT INTO bookings (date, slot_start_utc, slot_end_utc, client_name, phone, category, notes) VALUES
('2024-01-16', '2024-01-16 09:00:00+00', '2024-01-16 10:00:00+00', 'Ahmed Ben Ali', '+21620123456', 'tabac', 'Premier rendez-vous'),
('2024-01-17', '2024-01-17 10:00:00+00', '2024-01-17 11:00:00+00', 'Fatma Trabelsi', '+21698765432', 'drogue', 'Suivi mensuel'),
('2024-01-18', '2024-01-18 12:00:00+00', '2024-01-18 13:00:00+00', 'Mohamed Sassi', '+21655123789', 'drogue_dure', '');
*/

-- ===== Comments =====
COMMENT ON TABLE bookings IS 'Table principale pour stocker les rendez-vous LaserOstop';
COMMENT ON TABLE settings IS 'Configuration de l''application';
COMMENT ON FUNCTION get_available_slots(DATE) IS 'Retourne les créneaux disponibles pour une semaine donnée';
COMMENT ON FUNCTION is_valid_business_slot(DATE, TIME, TIME) IS 'Valide si un créneau est dans les heures d''ouverture';
COMMENT ON FUNCTION check_slot_conflict(DATE, TIMESTAMPTZ, TIMESTAMPTZ, UUID) IS 'Vérifie les conflits de créneaux';