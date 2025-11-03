-- Migration to add session_duration and session_type fields to bookings table

-- Add the new columns
ALTER TABLE bookings 
ADD COLUMN IF NOT EXISTS session_duration INTEGER DEFAULT 60 CHECK (session_duration IN (30, 60, 90)),
ADD COLUMN IF NOT EXISTS session_type TEXT DEFAULT 'solo' CHECK (session_type IN ('solo', 'duo'));

-- Update existing bookings to have default values
UPDATE bookings 
SET 
    session_duration = 60,
    session_type = 'solo'
WHERE 
    session_duration IS NULL 
    OR session_type IS NULL;

-- Create index for efficient querying
CREATE INDEX IF NOT EXISTS idx_bookings_session_duration ON bookings(session_duration);
CREATE INDEX IF NOT EXISTS idx_bookings_session_type ON bookings(session_type);

-- Update comments
COMMENT ON COLUMN bookings.session_duration IS 'Duration of the session in minutes (30, 60, or 90)';
COMMENT ON COLUMN bookings.session_type IS 'Type of session: solo or duo';