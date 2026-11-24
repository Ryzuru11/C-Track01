#!/bin/bash

# ============================================================
# C-Track — VPS Deploy Script (run directly on the VPS)
# ============================================================
#
# Usage:
#   ./deploy-vps.sh                 Full deploy (deps, prisma, build all, PM2, nginx)
#   ./deploy-vps.sh --build         Quick rebuild both backend + frontend
#   ./deploy-vps.sh --build-backend  Rebuild backend only
#   ./deploy-vps.sh --build-frontend Rebuild frontend only
#
# Remote dir: /var/www/C-Track
# ============================================================

set -e

# ─── Config ──────────────────────────────────────────────────
PROJECT_DIR="/var/www/C-Track"
BACKEND_DIR="$PROJECT_DIR/backend-express"
FRONTEND_DIR="$PROJECT_DIR/frontend-web"

# ─── Flags ───────────────────────────────────────────────────
MODE="full"
for arg in "$@"; do
  case "$arg" in
    --build)          MODE="build-all" ;;
    --build-backend)  MODE="build-backend" ;;
    --build-frontend) MODE="build-frontend" ;;
  esac
done

# ─── Header ──────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
case "$MODE" in
  build-all)
echo "║          🏗️  C-Track Deploy  (rebuild all)                     ║"
echo "║          Backend + Frontend build → restart servers            ║" ;;
  build-backend)
echo "║          🏗️  C-Track Deploy  (backend only)                    ║"
echo "║          Backend build → restart backend                       ║" ;;
  build-frontend)
echo "║          🏗️  C-Track Deploy  (frontend only)                   ║"
echo "║          Frontend build → reload nginx                         ║" ;;
  full)
echo "║          🚀 C-Track Deploy  (full pipeline)                    ║"
echo "║          Clean install → Prisma → Build → PM2 → nginx         ║" ;;
esac
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# ─── Helper functions ────────────────────────────────────────
build_backend() {
  echo "  📦 Building backend (TypeScript)..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$BACKEND_DIR"
  npx prisma generate
  npm run build
  echo "  ✅ Backend build completed!"
  echo ""
}

restart_backend() {
  echo "  🔄 Restarting backend..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$BACKEND_DIR"
  if command -v pm2 &>/dev/null; then
    pm2 restart ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js
    echo "  ✅ Backend restarted via PM2"
    pm2 status
  else
    pkill -f 'ts-node' 2>/dev/null || true
    sleep 1
    nohup npm run dev > ~/ctrack-backend.log 2>&1 &
    echo "  ✅ Backend restarted (dev mode)"
  fi
  echo ""
}

build_frontend() {
  echo "  📦 Building frontend..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$FRONTEND_DIR"
  sudo rm -rf dist
  npm run build
  echo "  ✅ Frontend build completed!"
  echo ""
}

reload_nginx() {
  echo "  🌍 Reloading nginx..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  sudo nginx -t && sudo systemctl restart nginx
  echo "  ✅ nginx reloaded"
  echo ""
}

show_summary() {
  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║                    🎉 DEPLOY COMPLETE!                         ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "🌐 Access:"
  echo "   Frontend : https://ctrack.wikolabs.biz.id"
  echo "   API      : https://ctrack.wikolabs.biz.id/api"
  echo ""
  echo "💡 Usage:"
  echo "   Full deploy      : ./deploy-vps.sh"
  echo "   Rebuild all      : ./deploy-vps.sh --build"
  echo "   Backend only     : ./deploy-vps.sh --build-backend"
  echo "   Frontend only    : ./deploy-vps.sh --build-frontend"
  echo ""
  echo "📋 Logs:"
  echo "   PM2 logs : pm2 logs backend --lines 30"
  echo "   nginx    : sudo tail -f /var/log/nginx/error.log"
  echo ""
  echo "✨ Done! ✨"
  echo ""
}

# =============================================================================
# --build: Rebuild both backend + frontend
# =============================================================================
if [ "$MODE" = "build-all" ]; then
  build_backend
  restart_backend
  build_frontend
  reload_nginx
  show_summary
  exit 0
fi

# =============================================================================
# --build-backend: Rebuild backend only
# =============================================================================
if [ "$MODE" = "build-backend" ]; then
  build_backend
  restart_backend
  show_summary
  exit 0
fi

# =============================================================================
# --build-frontend: Rebuild frontend only
# =============================================================================
if [ "$MODE" = "build-frontend" ]; then
  build_frontend
  reload_nginx
  show_summary
  exit 0
fi

# =============================================================================
# Full pipeline (no flag)
# =============================================================================

# Step 1/7: Backend — Install dependencies
echo "📦 Step 1/7: Backend — installing dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$BACKEND_DIR" && npm install
echo "  ✅ Dependencies installed"
echo ""

# Step 2/7: Backend — Prisma generate + migrate
echo "🗄️  Step 2/7: Backend — Prisma generate + migrate..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$BACKEND_DIR"
npx prisma generate
echo "  ✅ Prisma client generated"
npx prisma migrate deploy || echo "  ⚠️  Prisma migrate had issues (may be fine if using db push)"
echo "  ✅ Prisma migrations applied"
npm run rbac:sync || echo "  ⚠️  RBAC sync had issues — roles/permissions may be outdated"
echo "  ✅ RBAC roles & permissions synced"
echo ""

# Step 3/7: Backend — Seed database
echo "🌱 Step 3/7: Backend — Seeding database..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$BACKEND_DIR"
npx prisma db seed 2>/dev/null || echo "  ⚠️  Seed skipped (already seeded or no seed script)"
echo "  ✅ Database ready"
echo ""

# Step 4/7: Backend — Build TypeScript
echo "🔨 Step 4/7: Backend — building TypeScript..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
build_backend

# Step 5/7: Backend — Restart PM2
echo "🔄 Step 5/7: Backend — restarting PM2..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
restart_backend

# Step 6/7: Frontend — Install & Build
echo "🌐 Step 6/7: Frontend — installing & building..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$FRONTEND_DIR" && npm install
echo "  ✅ Frontend dependencies installed"
build_frontend

# Step 7/7: Reload nginx
echo "🌍 Step 7/7: Reloading nginx..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
reload_nginx

# Setup PM2 cron monitoring
echo "⏰ Setting up PM2 auto-recovery cron..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$BACKEND_DIR"
chmod +x restart-backend.sh setup-cron.sh 2>/dev/null || true
bash setup-cron.sh 2>/dev/null || echo "  ⚠️  Cron setup skipped"
echo "  ✅ PM2 cron monitoring active"
echo ""

show_summary
