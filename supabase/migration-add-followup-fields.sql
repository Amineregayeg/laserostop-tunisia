-- Migration to add follow-up and financial tracking fields

-- Add new status values
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check 
    CHECK (status IN ('booked', 'cancelled', 'completed', 'confirmed', 'absent', 'rescheduled'));

-- Add financial tracking fields
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS standard_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS actual_price DECIMAL(10,2),
ADD COLUMN IF NOT EXISTS price_notes TEXT,
ADD COLUMN IF NOT EXISTS payment_status TEXT DEFAULT 'pending';

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_payment_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_payment_status_check 
    CHECK (payment_status IN ('pending', 'paid', 'free', 'partial'));

-- Add follow-up tracking fields
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS attendance_status TEXT DEFAULT 'pending',
ADD COLUMN IF NOT EXISTS session_confirmed BOOLEAN DEFAULT FALSE,
ADD COLUMN IF NOT EXISTS session_confirmed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS session_confirmed_by TEXT,
ADD COLUMN IF NOT EXISTS follow_up_notes TEXT;

ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_attendance_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_attendance_status_check 
    CHECK (attendance_status IN ('pending', 'present', 'absent', 'rescheduled'));

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS idx_bookings_attendance_status ON bookings(attendance_status);
CREATE INDEX IF NOT EXISTS idx_bookings_payment_status ON bookings(payment_status);
CREATE INDEX IF NOT EXISTS idx_bookings_session_confirmed ON bookings(session_confirmed);
CREATE INDEX IF NOT EXISTS idx_bookings_session_confirmed_at ON bookings(session_confirmed_at);

-- Update existing bookings with standard prices based on category
UPDATE bookings 
SET standard_price = CASE category
    WHEN 'tabac' THEN 500.00
    WHEN 'drogue' THEN 750.00
    WHEN 'drogue_dure' THEN 1000.00
    ELSE 0.00
END
WHERE standard_price IS NULL;

-- Set actual_price to standard_price for completed sessions where not set
UPDATE bookings 
SET actual_price = standard_price
WHERE status = 'completed' 
AND actual_price IS NULL 
AND standard_price IS NOT NULL;

-- Mark completed sessions as confirmed for existing data
UPDATE bookings 
SET 
    session_confirmed = TRUE,
    attendance_status = 'present',
    payment_status = 'paid',
    session_confirmed_at = updated_at
WHERE status = 'completed' 
AND session_confirmed = FALSE;

-- Comments
COMMENT ON COLUMN bookings.standard_price IS 'Standard price for this category of session';
COMMENT ON COLUMN bookings.actual_price IS 'Actual price charged (may include discounts)';
COMMENT ON COLUMN bookings.price_notes IS 'Notes about pricing (discounts, offers, etc.)';
COMMENT ON COLUMN bookings.payment_status IS 'Payment status: pending, paid, free, partial';
COMMENT ON COLUMN bookings.attendance_status IS 'Whether client attended: pending, present, absent, rescheduled';
COMMENT ON COLUMN bookings.session_confirmed IS 'Whether session outcome has been confirmed';
COMMENT ON COLUMN bookings.session_confirmed_at IS 'When session was confirmed';
COMMENT ON COLUMN bookings.session_confirmed_by IS 'Who confirmed the session';
COMMENT ON COLUMN bookings.follow_up_notes IS 'Follow-up notes after session';