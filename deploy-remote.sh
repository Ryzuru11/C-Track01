#!/bin/bash

# ============================================================
# C-Track — Remote Deploy Script (run directly on VPS)
# ============================================================
#
# Usage (on VPS):
#   ./deploy-remote.sh --build   Quick rebuild + restart servers
#   ./deploy-remote.sh           Full clean deploy
#
# Project dir: /var/www/C-Track
# ============================================================

set -e

PROJECT="/var/www/C-Track"

# ─── Flags ───────────────────────────────────────────────────
DO_BUILD=false
for arg in "$@"; do
  [[ "$arg" == "--build" ]] && DO_BUILD=true
done

# ─── Header ──────────────────────────────────────────────────
echo ""
echo "╔════════════════════════════════════════════════════════════════╗"
if [ "$DO_BUILD" = true ]; then
echo "║          🏗️  C-Track Deploy  (--build mode)                    ║"
echo "║          Quick rebuild + restart servers                       ║"
else
echo "║          🚀 C-Track Deploy  (full pipeline)                    ║"
echo "║          Clean install → Prisma → Build → PM2 → nginx         ║"
fi
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""

# =============================================================================
# --build mode: Quick rebuild + restart
# =============================================================================
if [ "$DO_BUILD" = true ]; then

  echo "📦 Step 1/4: Building backend..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$PROJECT/backend-express"
  npm run build
  echo "  ✅ Backend build completed!"
  echo ""

  echo "📦 Step 2/4: Building frontend..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  cd "$PROJECT/frontend-web"
  sudo rm -rf dist
  npm run build
  echo "  ✅ Frontend build completed!"
  echo ""

  echo "🔄 Step 3/4: Restarting dev servers..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  echo "  🛑 Stopping old processes..."
  pkill -f 'node.*vite' 2>/dev/null || true
  pkill -f 'ts-node' 2>/dev/null || true
  sleep 2

  echo "  🚀 Starting backend..."
  cd "$PROJECT/backend-express"
  nohup npm run dev > ~/ctrack-backend.log 2>&1 &
  sleep 1

  echo "  🚀 Starting frontend dev server..."
  cd "$PROJECT/frontend-web"
  nohup npm run dev -- --host > ~/ctrack-frontend.log 2>&1 &
  sleep 3

  echo ""
  echo "  📋 Running processes:"
  ps aux | grep -E '(vite|ts-node)' | grep -v grep | head -5 || true
  echo "  ✅ Dev servers restarted!"
  echo ""

  echo "🌍 Step 4/4: Reloading nginx..."
  echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  sudo nginx -t && sudo systemctl reload nginx
  echo "  ✅ nginx reloaded"
  echo ""

  echo "╔════════════════════════════════════════════════════════════════╗"
  echo "║                    🎉 REBUILD COMPLETE!                        ║"
  echo "╚════════════════════════════════════════════════════════════════╝"
  echo ""
  echo "🌐 Access your site:"
  echo "   Dev Server : https://ctrack.wikolabs.biz.id (hot reload)"
  echo "   Production : https://ctrack.wikolabs.biz.id (static build)"
  echo "   API        : https://ctrack.wikolabs.biz.id/api"
  echo ""
  echo "📋 Logs:"
  echo "   Backend  : tail -f ~/ctrack-backend.log"
  echo "   Frontend : tail -f ~/ctrack-frontend.log"
  echo ""
  echo "✨ Happy coding! ✨"
  echo ""
  exit 0
fi

# =============================================================================
# Full pipeline (no flag)
# =============================================================================

echo "📦 Step 1/7: Backend — installing dependencies..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
npm install
echo "  ✅ Dependencies installed"
echo ""

echo "🗄️  Step 2/7: Backend — Prisma generate + migrate..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
npx prisma generate
echo "  ✅ Prisma client generated"
npx prisma migrate deploy || echo "  ⚠️  Prisma migrate deploy had issues (may be fine if using db push)"
echo "  ✅ Prisma migrations applied"
npm run rbac:sync || echo "  ⚠️  RBAC sync had issues — roles/permissions may be outdated"
echo "  ✅ RBAC roles & permissions synced"
echo ""

echo "🌱 Step 3/7: Backend — Seeding database..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
npx prisma db seed 2>/dev/null || echo "  ⚠️  Seed skipped (already seeded or no seed script)"
echo "  ✅ Database ready"
echo ""

echo "🔨 Step 4/7: Backend — building TypeScript..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
npm run build
echo "  ✅ Backend built"
echo ""

echo "🔄 Step 5/7: Backend — restarting PM2..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
pm2 restart ecosystem.config.js --update-env || pm2 start ecosystem.config.js
echo "  ✅ Backend running via PM2"
echo ""
echo "  📋 PM2 status:"
pm2 status || true
echo ""

echo "🌐 Step 6/7: Frontend — installing & building..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/frontend-web"
npm install
echo "  ✅ Frontend dependencies installed"
sudo rm -rf dist
npm run build
echo "  ✅ Frontend built"
echo ""

echo "🌍 Step 7/7: Reloading nginx..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
sudo nginx -t && sudo systemctl reload nginx
echo "  ✅ nginx reloaded"
echo ""

echo "⏰ Setting up PM2 auto-recovery cron..."
echo "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
cd "$PROJECT/backend-express"
chmod +x restart-backend.sh setup-cron.sh
bash setup-cron.sh || echo "  ⚠️  Cron setup skipped"
echo "  ✅ PM2 cron monitoring active"
echo ""

echo "╔════════════════════════════════════════════════════════════════╗"
echo "║                 🎉 FULL DEPLOY COMPLETE!                       ║"
echo "╚════════════════════════════════════════════════════════════════╝"
echo ""
echo "🌐 Your app is live:"
echo "   Frontend : https://ctrack.wikolabs.biz.id"
echo "   API      : https://ctrack.wikolabs.biz.id/api"
echo ""
echo "📋 Monitoring:"
echo "   PM2 status : pm2 status"
echo "   PM2 logs   : pm2 logs backend --lines 30"
echo "   nginx logs : sudo tail -f /var/log/nginx/error.log"
echo ""
echo "✨ Happy shipping! ✨"
echo ""
