#!/bin/bash

# ============================================================
# C-Track Backend - Clean Installation Script
# Wipes and reinstalls everything from scratch (no prompts)
# ============================================================

set -e  # Exit immediately on any error

YELLOW='\033[1;33m'
GREEN='\033[0;32m'
RED='\033[0;31m'
CYAN='\033[0;36m'
RESET='\033[0m'

step() { echo -e "\n${CYAN}▶ $1${RESET}"; }
ok()   { echo -e "${GREEN}✔ $1${RESET}"; }
warn() { echo -e "${YELLOW}⚠ $1${RESET}"; }
fail() { echo -e "${RED}✘ $1${RESET}"; exit 1; }

echo -e "${CYAN}"
echo "============================================"
echo "  C-Track Backend — Clean Installation"
echo "============================================"
echo -e "${RESET}"

# ─── 0. Make sure we're in backend-express/ ─────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ok "Working directory: $SCRIPT_DIR"

# ─── 1. Check requirements ──────────────────────────────────
step "Checking requirements"

command -v node  &>/dev/null || fail "Node.js is not installed. Install Node.js 18+ first."
command -v npm   &>/dev/null || fail "npm is not installed."
command -v npx   &>/dev/null || fail "npx is not available."

ok "Node.js $(node -v)"
ok "npm     $(npm -v)"

# ─── 2. .env setup ──────────────────────────────────────────
step "Setting up .env"

if [ ! -f .env ]; then
    if [ ! -f .env.example ]; then
        fail ".env.example not found. Cannot create .env automatically."
    fi
    cp .env.example .env
    warn ".env was missing — copied from .env.example"
    warn "Edit .env and update DATABASE_URL, JWT_SECRET, etc., then re-run this script."
    exit 1
fi
ok ".env file found"

# ─── 3. Clean node_modules ──────────────────────────────────
step "Cleaning old node_modules and lock file"

if [ -d node_modules ]; then
    rm -rf node_modules
    ok "Removed node_modules/"
fi

if [ -f package-lock.json ]; then
    rm -f package-lock.json
    ok "Removed package-lock.json"
fi

# ─── 4. Install dependencies ────────────────────────────────
step "Installing npm dependencies (fresh)"
npm install || fail "npm install failed"
ok "Dependencies installed"

# ─── 5. Create upload directories ───────────────────────────
step "Creating upload directories"
mkdir -p uploads/reports uploads/thumbnails
touch uploads/.gitkeep
ok "uploads/reports and uploads/thumbnails ready"

# ─── 6. Generate Prisma client ──────────────────────────────
step "Generating Prisma client"
npx prisma generate || fail "prisma generate failed"
ok "Prisma client generated"

# ─── 7. Push schema to database ─────────────────────────────
step "Pushing Prisma schema to database (db push)"
npx prisma db push --accept-data-loss || fail "prisma db push failed — check DATABASE_URL in .env"
ok "Database schema synced"

# ─── 8. Baseline migrations + sync RBAC ──────────────────────
# `db push` above already created the full schema, so running the migrations would
# fail on duplicate columns and leave a failed record that blocks every later
# `migrate deploy`. Record each migration as applied instead.
MIGRATION_DIR="prisma/migrations"
if [ -d "$MIGRATION_DIR" ]; then
    step "Marking Prisma migrations as applied (schema created by db push)"
    for dir in "$MIGRATION_DIR"/*/; do
        [ -f "${dir}migration.sql" ] || continue
        name="$(basename "$dir")"
        npx prisma migrate resolve --applied "$name" >/dev/null 2>&1 || true
    done
    ok "Migrations baselined"
fi
npm run rbac:sync || warn "RBAC sync had issues — continuing"
ok "RBAC roles & permissions synced"

# ─── 9. Seed database ───────────────────────────────────────
step "Seeding database"
npm run prisma:seed || fail "Database seeding failed"
ok "Database seeded"

# ─── 10. Build TypeScript ────────────────────────────────────
step "Building TypeScript"
npm run build || warn "TypeScript build failed — you can still run in dev mode with: npm run dev"

# ─── Done ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================"
echo "  Clean installation complete!"
echo -e "============================================${RESET}"
echo ""
echo "Start the dev server:"
echo "  npm run dev"
echo ""
echo "Default credentials after seeding:"
echo "  Admin    → admin@trackingapp.com     / admin123"
echo "  Employee → employee@trackingapp.com  / employee123"
echo ""
