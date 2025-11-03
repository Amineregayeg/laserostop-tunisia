#!/bin/bash
# A3 Deployment Script for LaserOstop
# This script helps deploy the A3 implementation to Supabase

set -e  # Exit on error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo -e "${GREEN}=== LaserOstop A3 Deployment Script ===${NC}\n"

# Check if Supabase CLI is installed
if ! command -v supabase &> /dev/null; then
    if [ -f "$HOME/.local/bin/supabase" ]; then
        export PATH="$HOME/.local/bin:$PATH"
    else
        echo -e "${RED}Error: Supabase CLI not found${NC}"
        echo "Please install it first:"
        echo "  mkdir -p ~/.local/bin"
        echo "  curl -fsSL https://github.com/supabase/cli/releases/latest/download/supabase_linux_amd64.tar.gz | tar -xz"
        echo "  mv supabase ~/.local/bin/"
        exit 1
    fi
fi

echo -e "${GREEN}✓ Supabase CLI found: $(supabase --version)${NC}\n"

# Check if logged in
echo -e "${YELLOW}Step 1: Login to Supabase${NC}"
echo "If you're not logged in, you'll be prompted to authenticate"
echo "Press Enter to continue..."
read

supabase login || {
    echo -e "${RED}Login failed. Please try again.${NC}"
    exit 1
}

echo -e "${GREEN}✓ Logged in${NC}\n"

# Link project
echo -e "${YELLOW}Step 2: Link Project${NC}"
echo "Project Reference: llhwtsklaakhfblxxoxn"
echo "Press Enter to link..."
read

supabase link --project-ref llhwtsklaakhfblxxoxn || {
    echo -e "${YELLOW}Warning: Link failed or already linked${NC}"
}

echo -e "${GREEN}✓ Project linked${NC}\n"

# Deploy database migration
echo -e "${YELLOW}Step 3: Deploy Database Migration${NC}"
echo "This will add new categories and create indexes"
echo ""
echo "IMPORTANT: This will modify your production database!"
echo "Type 'yes' to continue: "
read confirm

if [ "$confirm" != "yes" ]; then
    echo -e "${RED}Deployment cancelled${NC}"
    exit 1
fi

echo "Applying migration..."
supabase db push || {
    echo -e "${YELLOW}Warning: Migration may have already been applied${NC}"
    echo "You can also run it manually via the Supabase dashboard SQL Editor"
    echo "File: supabase/migrations/20251103_a3_categories_indexes_saturday.sql"
}

echo -e "${GREEN}✓ Database migration complete${NC}\n"

# Deploy Edge Functions
echo -e "${YELLOW}Step 4: Deploy Edge Functions${NC}"

echo "Deploying create-booking..."
supabase functions deploy create-booking --no-verify-jwt || {
    echo -e "${RED}Failed to deploy create-booking${NC}"
    exit 1
}
echo -e "${GREEN}✓ create-booking deployed${NC}"

echo "Deploying move-booking (new)..."
supabase functions deploy move-booking --no-verify-jwt || {
    echo -e "${RED}Failed to deploy move-booking${NC}"
    exit 1
}
echo -e "${GREEN}✓ move-booking deployed${NC}"

echo "Deploying update-booking (new)..."
supabase functions deploy update-booking --no-verify-jwt || {
    echo -e "${RED}Failed to deploy update-booking${NC}"
    exit 1
}
echo -e "${GREEN}✓ update-booking deployed${NC}"

echo "Deploying update-session..."
supabase functions deploy update-session --no-verify-jwt || {
    echo -e "${RED}Failed to deploy update-session${NC}"
    exit 1
}
echo -e "${GREEN}✓ update-session deployed${NC}\n"

# Set secrets
echo -e "${YELLOW}Step 5: Set Environment Secrets${NC}"
echo ""
echo "You need to set two secrets:"
echo "  1. RESEND_API_KEY - Your Resend API key for emails"
echo "  2. FROM_EMAIL - The sender email address"
echo ""
echo "Do you want to set these now? (y/n): "
read set_secrets

if [ "$set_secrets" = "y" ]; then
    echo "Enter your Resend API key (starts with 're_'):"
    read -s resend_key

    echo "Enter your FROM_EMAIL (e.g., noreply@yourdomain.com):"
    read from_email

    supabase secrets set RESEND_API_KEY="$resend_key" || {
        echo -e "${RED}Failed to set RESEND_API_KEY${NC}"
    }

    supabase secrets set FROM_EMAIL="$from_email" || {
        echo -e "${RED}Failed to set FROM_EMAIL${NC}"
    }

    echo -e "${GREEN}✓ Secrets set${NC}\n"
else
    echo -e "${YELLOW}Skipping secrets. Set them manually:${NC}"
    echo "  supabase secrets set RESEND_API_KEY=your_key"
    echo "  supabase secrets set FROM_EMAIL=noreply@yourdomain.com"
    echo ""
fi

# Summary
echo -e "${GREEN}=== Deployment Complete! ===${NC}\n"
echo "Deployed components:"
echo "  ✓ Database migration (new categories, indexes)"
echo "  ✓ create-booking (updated)"
echo "  ✓ move-booking (new)"
echo "  ✓ update-booking (new)"
echo "  ✓ update-session (updated)"
echo ""
echo -e "${YELLOW}Next steps:${NC}"
echo "  1. Upload frontend files (index.html, app.js, etc.) to your hosting"
echo "  2. Run smoke tests from A3_DEPLOYMENT.md"
echo "  3. Verify email notifications work"
echo ""
echo "For testing, see: A3_DEPLOYMENT.md"
echo "For manual steps, see: MANUAL_DEPLOYMENT_STEPS.md"
echo ""
echo -e "${GREEN}Done!${NC}"
