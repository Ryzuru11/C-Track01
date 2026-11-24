#!/bin/bash

# ============================================================
# C-Track Mobile — Clean Installation Script
# Expo + React Native (no .env — API URL in config/api.config.ts)
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
echo "  C-Track Mobile — Clean Installation"
echo "============================================"
echo -e "${RESET}"

# ─── 0. Make sure we're in mobile/ ──────────────────────────
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"
ok "Working directory: $SCRIPT_DIR"

# ─── 1. Check requirements ──────────────────────────────────
step "Checking requirements"

command -v node &>/dev/null || fail "Node.js is not installed. Install Node.js 18+ first."
command -v npm  &>/dev/null || fail "npm is not installed."

ok "Node.js $(node -v)"
ok "npm     $(npm -v)"

# Check Expo CLI
if command -v expo &>/dev/null; then
    ok "Expo CLI $(expo --version)"
else
    warn "Expo CLI not found globally — installing now..."
    npm install -g expo-cli || warn "Could not install expo-cli globally. Use: npx expo instead."
fi

# Check EAS CLI (optional, needed for builds)
if command -v eas &>/dev/null; then
    ok "EAS CLI  $(eas --version)"
else
    warn "EAS CLI not found — install it to run cloud builds: npm install -g eas-cli"
fi

# ─── 2. Show current API URL ─────────────────────────────────
step "Checking API configuration"

API_URL=$(grep "^export const API_BASE_URL" config/api.config.ts | sed "s/.*= '//;s/'.*//")
ok "API_BASE_URL = $API_URL"
warn "To change API URL, edit: config/api.config.ts"

# ─── 3. Clean old node_modules and lock file ─────────────────
step "Cleaning old node_modules and lock file"

if [ -d node_modules ]; then
    rm -rf node_modules
    ok "Removed node_modules/"
fi

if [ -f package-lock.json ]; then
    rm -f package-lock.json
    ok "Removed package-lock.json"
fi

# Clean Expo cache
if [ -d .expo ]; then
    rm -rf .expo
    ok "Removed .expo cache/"
fi

# ─── 4. Install dependencies ─────────────────────────────────
step "Installing npm dependencies (fresh)"
npm install || fail "npm install failed"
ok "Dependencies installed"

# ─── 5. TypeScript check ─────────────────────────────────────
step "Running TypeScript check"
npx tsc --noEmit && ok "TypeScript check passed" || warn "TypeScript reported issues — check output above (non-blocking)"

# ─── 6. Lint check ───────────────────────────────────────────
step "Running lint check"
npm run lint && ok "Lint passed" || warn "Lint reported issues — check output above (non-blocking)"

# ─── Done ────────────────────────────────────────────────────
echo ""
echo -e "${GREEN}============================================"
echo "  Clean installation complete!"
echo -e "============================================${RESET}"
echo ""
echo "Start the dev server (Expo Go):"
echo "  npx expo start"
echo ""
echo "Run on Android emulator:"
echo "  npx expo run:android"
echo ""
echo "Run on iOS simulator:"
echo "  npx expo run:ios"
echo ""
echo "Build APK via EAS (development):"
echo "  eas build --profile development --platform android"
echo ""
echo -e "${YELLOW}Physical device?${RESET} Update API_BASE_URL in config/api.config.ts"
echo "  → Uncomment the physical device line and set your machine's local IP"
echo ""
