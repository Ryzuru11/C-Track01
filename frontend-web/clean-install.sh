#!/bin/bash

# ============================================================
# C-Track Frontend Web — Clean Installation Script
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
echo "  C-Track Frontend Web — Clean Installation"
echo "============================================"
echo -e "${RESET}"

# ─── 0. Make sure we're in frontend-web/ ────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ok "Working directory: $SCRIPT_DIR"

# ─── 1. Check requirements ──────────────────────────────────
step "Checking requirements"

command -v node &>/dev/null || fail "Node.js is not installed. Install Node.js 18+ first."
command -v npm  &>/dev/null || fail "npm is not installed."

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
    warn "Default API URL is set to: http://localhost:8000/api (local backend)"
    warn "Edit .env to change VITE_API_BASE_URL if needed, then re-run."
fi
ok ".env file ready"

# Show current API URL
API_URL=$(grep "^VITE_API_BASE_URL" .env | cut -d '=' -f2 || echo "not set")
ok "VITE_API_BASE_URL = $API_URL"

# ─── 3. Clean old build artifacts and modules ───────────────
step "Cleaning old node_modules, dist, and lock file"

if [ -d node_modules ]; then
    rm -rf node_modules
    ok "Removed node_modules/"
fi

if [ -f package-lock.json ]; then
    rm -f package-lock.json
    ok "Removed package-lock.json"
fi

if [ -d dist ]; then
    rm -rf dist
    ok "Removed dist/"
fi

# ─── 4. Install dependencies ────────────────────────────────
step "Installing npm dependencies (fresh)"
npm install || fail "npm install failed"
ok "Dependencies installed"

# ─── 5. Lint check (optional, non-blocking) ─────────────────
step "Running lint check"
npm run lint && ok "Lint passed" || warn "Lint reported issues — check output above (non-blocking)"

# ─── 6. Build production bundle ─────────────────────────────
step "Building production bundle (vite build)"
npm run build || fail "vite build failed"
ok "Production build ready in dist/"

# ─── Done ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================"
echo "  Clean installation complete!"
echo -e "============================================${RESET}"
echo ""
echo "Start the dev server:"
echo "  npm run dev        → http://localhost:5173"
echo ""
echo "Preview the production build:"
echo "  npm run preview"
echo ""
echo "Show network URLs:"
echo "  npm run network"
echo ""
