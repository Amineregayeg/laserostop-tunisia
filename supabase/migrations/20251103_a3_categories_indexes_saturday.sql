-- Migration: A3 Categories, Indexes, and Saturday 17:00-18:00
-- Date: 2025-01-03
-- Purpose: Add drogue_douce and renforcement categories, duplicate detection indexes

-- 1) Allow new categories
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_category_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_category_check
  CHECK (category IN ('tabac','drogue','drogue_dure','drogue_douce','renforcement'));

-- 2) Standard price update
CREATE OR REPLACE FUNCTION get_standard_price(category_name TEXT)
RETURNS DECIMAL(10,2) AS $$
BEGIN
  RETURN CASE category_name
    WHEN 'tabac' THEN 500.00
    WHEN 'drogue' THEN 750.00
    WHEN 'drogue_dure' THEN 1000.00
    WHEN 'drogue_douce' THEN 600.00
    WHEN 'renforcement' THEN 0.00
    ELSE 0.00
  END;
END;
$$ LANGUAGE plpgsql;

-- 3) Duplicate-detection indexes
CREATE INDEX IF NOT EXISTS idx_bookings_phone_active
  ON bookings(phone) WHERE status IN ('booked','confirmed');

CREATE INDEX IF NOT EXISTS idx_bookings_client_name_lower_active
  ON bookings(LOWER(client_name)) WHERE status IN ('booked','confirmed');

-- 4) Saturday 17:00-18:00 slot (update get_available_slots if needed)
-- Note: This migration assumes the function uses dynamic generation or hardcoded array
-- The frontend and backend validation will handle the 17:00-18:00 window
