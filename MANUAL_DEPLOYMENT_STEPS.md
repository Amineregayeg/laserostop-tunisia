# Manual Deployment Steps for A3

## Issue
The Supabase CLI is not currently accessible in the WSL environment. Here are the manual steps to deploy the A3 implementation.

## Option 1: Install Supabase CLI (Recommended)

```bash
# Install via npm globally
npm install -g supabase

# OR install via binary (Linux)
curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz
sudo mv supabase /usr/local/bin/

# Verify installation
supabase --version

# Login to Supabase
supabase login

# Link your project
cd /mnt/d/laserostop_tn/laserostop-planning
supabase link --project-ref llhwtsklaakhfblxxoxn
```

## Option 2: Manual Deployment via Supabase Dashboard

### Step 1: Run Database Migration

1. Go to https://supabase.com/dashboard/project/llhwtsklaakhfblxxoxn
2. Navigate to **SQL Editor**
3. Click **New Query**
4. Copy the contents of `supabase/migrations/20251103_a3_categories_indexes_saturday.sql`
5. Paste and click **Run**
6. Verify success message

### Step 2: Deploy Edge Functions

#### A. Create/Update `create-booking` function

1. Go to **Edge Functions** in Supabase dashboard
2. Find `create-booking` function (or create new)
3. Copy contents of `supabase/functions/create-booking/index.ts`
4. Paste into the editor
5. Click **Deploy**

#### B. Create `move-booking` function

1. Click **New Function**
2. Name: `move-booking`
3. Copy contents of `supabase/functions/move-booking/index.ts`
4. Paste into the editor
5. Click **Deploy**

#### C. Create `update-booking` function

1. Click **New Function**
2. Name: `update-booking`
3. Copy contents of `supabase/functions/update-booking/index.ts`
4. Paste into the editor
5. Click **Deploy**

#### D. Update `update-session` function

1. Find `update-session` function
2. Copy contents of `supabase/functions/update-session/index.ts`
3. Paste into the editor (replace existing)
4. Click **Deploy**

### Step 3: Set Environment Secrets

1. Go to **Project Settings** → **Edge Functions** → **Secrets**
2. Add the following secrets:

```
RESEND_API_KEY = re_your_resend_api_key_here
FROM_EMAIL = noreply@yourdomain.com
```

**To get Resend API key:**
- Sign up at https://resend.com
- Go to API Keys section
- Create new API key
- Copy the key (starts with `re_`)

**Note:** You can use `onboarding@resend.dev` for `FROM_EMAIL` during testing, but you must verify your own domain for production.

### Step 4: Upload Frontend Files

Upload these files to your hosting service (Netlify, Vercel, GitHub Pages, etc.):

**Updated files:**
- `index.html`
- `app.js`
- `suivi.html`
- `suivi.js`
- `dashboard.html`
- `dashboard.js`

**Method depends on your hosting:**

#### If using Netlify/Vercel:
```bash
# If connected to Git, just push
git push origin master

# If manual upload, drag files to dashboard
```

#### If using GitHub Pages:
```bash
git push origin master
# Wait for GitHub Actions to deploy
```

#### If using manual hosting:
- FTP/SFTP the updated files to your server
- Ensure you preserve the directory structure

## Step 5: Verify Deployment

### Check Database Migration

Run this query in SQL Editor to verify:

```sql
-- Check if new categories are allowed
SELECT constraint_name, check_clause
FROM information_schema.check_constraints
WHERE constraint_name = 'bookings_category_check';

-- Should show: category IN ('tabac','drogue','drogue_dure','drogue_douce','renforcement')

-- Check if indexes exist
SELECT indexname FROM pg_indexes
WHERE tablename = 'bookings'
AND indexname LIKE 'idx_bookings_%';

-- Should show:
-- idx_bookings_phone_active
-- idx_bookings_client_name_lower_active

-- Test get_standard_price function
SELECT
  get_standard_price('tabac') as tabac,
  get_standard_price('drogue') as drogue,
  get_standard_price('drogue_dure') as drogue_dure,
  get_standard_price('drogue_douce') as drogue_douce,
  get_standard_price('renforcement') as renforcement;

-- Should return: 500, 750, 1000, 600, 0
```

### Check Edge Functions

1. Go to **Edge Functions** in dashboard
2. Verify all functions show as "Active"
3. Check recent deployments
4. Look at logs for any errors

### Test Frontend

1. Open your deployed site
2. Press F12 to open browser console
3. Run this test:

```javascript
// Should not error
console.log('Categories:', STRINGS.CATEGORIES);
console.log('Saturday slots:', TIME_SLOTS.samedi.length);
console.log('APIs:', API.MOVE, API.UPDATE);
```

## Step 6: Run Smoke Tests

Follow the testing checklist in `A3_DEPLOYMENT.md`:

1. ✅ Create booking with "Sevrage drogues douces"
2. ✅ Create booking with "Renforcement"
3. ✅ Test Saturday 17:00-18:00 slots
4. ✅ Test duplicate detection (phone)
5. ✅ Test duplicate detection (name)
6. ✅ Test edit booking
7. ✅ Test dashboard Realtime updates
8. ✅ Test email notifications

## Alternative: Use Supabase CLI via npx (One-time commands)

If you can't install globally, use `npx` for one-time commands:

```bash
cd /mnt/d/laserostop_tn/laserostop-planning

# Link project (one time)
npx supabase login
npx supabase link --project-ref llhwtsklaakhfblxxoxn

# Deploy functions
npx supabase functions deploy create-booking
npx supabase functions deploy move-booking
npx supabase functions deploy update-booking
npx supabase functions deploy update-session

# Set secrets
npx supabase secrets set RESEND_API_KEY=your_key
npx supabase secrets set FROM_EMAIL=noreply@yourdomain.com

# Run migration (if linked)
npx supabase db push
```

## Troubleshooting

### "Function not found" error
- Make sure function names match exactly (no spaces, lowercase with hyphens)
- Check that the function is deployed and active

### "RESEND_API_KEY not set" in logs
- Go to Project Settings → Edge Functions → Secrets
- Verify the secret is listed
- Redeploy the function after adding secrets

### Duplicate detection not working
- Check browser console for 409 responses
- Verify the indexes were created in the database
- Check Edge Function logs for errors

### Dashboard not updating in real-time
- Check browser console for "Realtime update:" messages
- Verify Supabase client is initialized (check for errors)
- Make sure supabase.min.js is loaded

## Files Reference

All files to deploy are tracked in git:

```bash
# View all changed files
git show --name-status a3-complete

# View specific file
git show a3-complete:app.js
git show a3-complete:supabase/migrations/20251103_a3_categories_indexes_saturday.sql
```

## Rollback (if needed)

```bash
# Checkout previous version
git checkout pre-a3

# Manually revert database (SQL in A3_DEPLOYMENT.md)
# Redeploy old frontend files
# Redeploy old Edge Functions
```

---

**Status:** Ready for deployment
**Git Tag:** `a3-complete`
**Migration File:** `supabase/migrations/20251103_a3_categories_indexes_saturday.sql`
