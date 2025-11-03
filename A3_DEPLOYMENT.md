# A3 Implementation - Deployment Checklist

## Summary

The A3 implementation adds:
- **New Categories**: `drogue_douce` (600 DT) and `renforcement` (0 DT, 30 min only)
- **Duplicate Client Detection**: Checks by phone and name with conflict resolution UI
- **Edit Booking Feature**: Modal to edit existing bookings
- **Move Booking API**: Endpoint to move bookings to different slots
- **Saturday Extension**: Now open until 18:00 (was 17:00)
- **Dashboard Realtime**: Live updates when bookings change
- **Email via Resend**: Production-ready email notifications

## Pre-Deployment Steps

### 1. Database Migration

Run the migration file on Supabase:

```bash
# Navigate to Supabase dashboard → SQL Editor
# Run the migration file:
supabase/migrations/20251103_a3_categories_indexes_saturday.sql
```

This will:
- Add new categories to CHECK constraint
- Update `get_standard_price()` function
- Create indexes for duplicate detection

### 2. Deploy Edge Functions

Deploy all updated/new Edge Functions:

```bash
# Create booking (updated)
supabase functions deploy create-booking

# Move booking (new)
supabase functions deploy move-booking

# Update booking (new)
supabase functions deploy update-booking

# Update session (updated)
supabase functions deploy update-session
```

### 3. Configure Secrets

Set the Resend API key for email notifications:

```bash
# Set RESEND_API_KEY secret
supabase secrets set RESEND_API_KEY=re_xxxxxxxxxxxxxx

# Set FROM_EMAIL (sender address)
supabase secrets set FROM_EMAIL=noreply@yourdomain.com

# Verify secrets are set
supabase secrets list
```

### 4. Update Frontend Files

Deploy the updated HTML and JS files:

- `index.html` - New category options, edit modal, duplicate modal
- `app.js` - Duplicate detection, edit handlers, Saturday 18:00
- `suivi.html` - New category filter options
- `suivi.js` - New category mappings and prices
- `dashboard.html` - New category filter options
- `dashboard.js` - Realtime updates, new categories

## Testing Checklist

### Smoke Tests

#### 1. New Categories
- [ ] Create booking with "Sevrage drogues douces" (600 DT)
- [ ] Create booking with "Renforcement (gratuit, 30 min)"
- [ ] Verify renforcement forces 30 minutes duration
- [ ] Verify trying to change renforcement to 60 min shows error

#### 2. Saturday Extension
- [ ] Navigate to Saturday in calendar
- [ ] Verify 17:00-17:30 slot exists
- [ ] Verify 17:30-18:00 slot exists
- [ ] Create booking in 17:00-18:00 window

#### 3. Duplicate Detection (Phone)
- [ ] Create booking: "John Doe", phone "+216 12345678"
- [ ] Try creating another booking: "Jane Smith", phone "00216 12345678"
- [ ] Should show duplicate modal with phone match
- [ ] Test "Déplacer l'ancien" button
- [ ] Test "Garder les deux" button
- [ ] Test "Annuler" button

#### 4. Duplicate Detection (Name)
- [ ] Create booking: "Alice Martin", phone "20111222"
- [ ] Try creating another booking: "alice martin", phone "99999999"
- [ ] Should show duplicate modal with name match
- [ ] Test resolution options

#### 5. Edit Booking
- [ ] Click on existing booking to view details
- [ ] Click "Modifier" button
- [ ] Edit modal should open with current data
- [ ] Change client name and save
- [ ] Verify booking updated on calendar
- [ ] Edit category to "renforcement"
- [ ] Verify duration forced to 30 min

#### 6. Dashboard Realtime
- [ ] Open dashboard.html in one tab
- [ ] Open index.html in another tab
- [ ] Create a booking in index.html
- [ ] Dashboard should auto-refresh (check console for "Realtime update:")
- [ ] Stats should update without manual refresh

#### 7. Email Notifications
- [ ] Go to dashboard.html → Settings
- [ ] Set notification email
- [ ] Create a new booking
- [ ] Check email inbox for notification
- [ ] Verify email contains: client name, phone, date/time, category

### Regression Tests

Run this in browser console on index.html:

```javascript
// Verify all categories exist
console.assert(
  Object.keys(STRINGS.CATEGORIES).length === 5,
  'Should have 5 categories'
);
console.assert(
  STRINGS.CATEGORIES.renforcement === 'Renforcement (gratuit)',
  'Renforcement category missing'
);

// Verify Saturday slots go to 18:00
const saturdaySlots = TIME_SLOTS.samedi;
console.assert(
  saturdaySlots[saturdaySlots.length - 1] === '17:30-18:00',
  'Saturday should end at 18:00'
);

// Verify API endpoints exist
console.assert(API.MOVE, 'MOVE API endpoint missing');
console.assert(API.UPDATE, 'UPDATE API endpoint missing');

console.log('✅ All regression checks passed');
```

## Rollback Plan

If issues occur, rollback to pre-A3:

### 1. Restore Database
```sql
-- Remove new categories from constraint
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_category_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_category_check
  CHECK (category IN ('tabac','drogue','drogue_dure'));

-- Restore old get_standard_price
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

-- Drop indexes
DROP INDEX IF EXISTS idx_bookings_phone_active;
DROP INDEX IF EXISTS idx_bookings_client_name_lower_active;
```

### 2. Git Rollback
```bash
# Checkout pre-A3 tag
git checkout pre-a3

# Redeploy old frontend files
# (copy index.html, app.js, dashboard.html, dashboard.js, suivi.html, suivi.js)

# Redeploy old Edge Functions
supabase functions deploy create-booking
supabase functions deploy update-session
```

## Configuration Notes

### Resend API Key
- Sign up at https://resend.com
- Create API key with "Send emails" permission
- Add verified domain or use test mode
- Free tier: 100 emails/day, 3,000/month

### FROM_EMAIL Format
Must be one of:
- Verified domain: `noreply@yourdomain.com`
- Resend test domain: `onboarding@resend.dev` (testing only)

### Duplicate Detection Logic
- **Phone normalization**: Strips spaces, converts `00216` → `+216`, removes leading `0`
- **Match priority**: Phone first, then name
- **Case insensitive**: "John Doe" matches "john doe"
- **Status filter**: Only checks `booked` and `confirmed` bookings

## Support

If you encounter issues:
1. Check browser console for errors
2. Check Supabase Edge Function logs
3. Verify environment variables are set (`RESEND_API_KEY`, `FROM_EMAIL`)
4. Test with known data from smoke tests above

---

**Git Tags:**
- `pre-a3` - State before A3 implementation
- `a3-complete` - A3 implementation complete

**Deployed on:** 2025-01-03
