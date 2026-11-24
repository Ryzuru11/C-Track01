#!/bin/bash

# =============================================================================
# C-Track — Build & Auto-Configure Nginx Script (ROOT ONLY)
# =============================================================================
# Menangani: npm install, Prisma generate/migrate, Build, PM2, & Injeksi Nginx.
# File Nginx yang digunakan: nginx-storage-fix.conf
# =============================================================================

set -e # Berhenti jika ada perintah yang gagal

# ─── KONFIGURASI PARAMETER ──────────────────────────────────────────────────
PROJECT_DIR="/var/www/C-Track"
BACKEND_DIR="$PROJECT_DIR/backend-express"
FRONTEND_DIR="$PROJECT_DIR/frontend-web"
PORT_PUB="8015"
NGINX_FILE="nginx-storage-fix.conf" # REVISI NAMA FILE NGINX

echo "=================================================================="
echo "🏗️  MEMULAI PROSES BUILD & OTOMATISASI NGINX C-TRACK (ROOT MODE)"
echo "=================================================================="

# ─── STEP 1: VERIFIKASI FILE .ENV ───────────────────────────────────────────
echo "📝 Step 1: Memeriksa konfigurasi database..."
if [ ! -f "$BACKEND_DIR/.env" ]; then
    echo "❌ DETAIL ERROR: File .env di $BACKEND_DIR belum ada!"
    echo "   Pastikan kamu sudah membuat file .env berisi DATABASE_URL MySQL sebelum menjalankan script ini."
    exit 1
fi
echo "✅ File .env ditemukan!"
echo ""

# ─── STEP 2: BACKEND PIPELINE (INSTALL, PRISMA, BUILD) ──────────────────────
echo "📦 Step 2: Menginstal dependensi & memproses Backend..."
cd "$BACKEND_DIR"

echo "  📥 Running npm install untuk Backend..."
npm install --allow-root

echo "  🧬 Running Prisma Generator & Migration..."
npx prisma generate
npx prisma migrate deploy || echo "  ⚠️ Catatan: Perintah migrate dilewati (struktur DB sudah up-to-date)."
npm run rbac:sync || echo "  ⚠️ Catatan: Sinkronisasi role & hak akses (RBAC) gagal."
# npx prisma db seed 2>/dev/null || echo "  ⚠️ Catatan: Seeding dilewati."

echo "  🔨 Mengompilasi TypeScript Backend..."
npm run build
echo "✅ Backend siap!"
echo ""

# ─── STEP 3: RESTART BACKEND VIA PM2 ────────────────────────────────────────
echo "🔄 Step 3: Menyalakan/Restart Backend di PM2..."
if ! command -v pm2 &>/dev/null; then
    echo "📦 PM2 belum terinstal global, menginstal PM2..."
    npm install -g pm2
fi

# Jalankan PM2 (restart jika sudah ada, buat baru jika belum)
pm2 restart ecosystem.config.js --update-env 2>/dev/null || pm2 start ecosystem.config.js || pm2 start dist/index.js --name "backend"
pm2 save # Mengunci list PM2 agar otomatis menyala saat VPS reboot
echo "✅ Backend mengudara di background!"
echo ""

# ─── STEP 4: FRONTEND PIPELINE (INSTALL & PRODUCTION BUILD) ──────────────────
echo "🌐 Step 4: Menginstal dependensi & memproses Frontend..."
cd "$FRONTEND_DIR"

echo "  📥 Running npm install untuk Frontend..."
npm install --allow-root

echo "  🔨 Membuat Production Build (Folder dist)..."
rm -rf dist
npm run build
echo "✅ Frontend selesai di-build!"
echo ""

# ─── STEP 5: INJEKSI OTOMATIS KONFIGURASI NGINX (REVISI) ─────────────────────
echo "🌍 Step 5: Mengonfigurasi Nginx Server Block..."
if [ -f "$PROJECT_DIR/$NGINX_FILE" ]; then
    # Salin file nginx-storage-fix.conf bawaan git ke folder sistem Nginx
    cp "$PROJECT_DIR/$NGINX_FILE" /etc/nginx/sites-available/c-track
    ln -sf /etc/nginx/sites-available/c-track /etc/nginx/sites-enabled/c-track
    
    # Hapus default site Nginx agar tidak tabrakan port
    rm -f /etc/nginx/sites-enabled/default 
    
    # Tes & Restart Nginx
    nginx -t
    systemctl restart nginx
    echo "✅ Nginx sukses dikonfigurasi otomatis menggunakan $NGINX_FILE!"
else
    echo "❌ DETAIL ERROR: File $PROJECT_DIR/$NGINX_FILE tidak ditemukan!"
    echo "   Pastikan file '$NGINX_FILE' hasil clone berada tepat di dalam folder /var/www/C-Track/"
    exit 1
fi
echo ""

# ─── STEP 6: FIREWALL REINFORCEMENT (UFW) ────────────────────────────────────
echo "🛡️ Step 6: Membuka port di Firewall (UFW)..."
if command -v ufw &>/dev/null; then
    ufw allow "$PORT_PUB"/tcp comment 'C-Track Web Port'
    ufw reload
    echo "✅ Port $PORT_PUB terbuka publik!"
else
    echo "⚠️ UFW tidak aktif. Pastikan port $PORT_PUB dibuka manual di panel cloud VPS-mu."
fi
echo ""

# ─── SUMMARY SCREEN ──────────────────────────────────────────────────────────
echo "=================================================================="
echo "🎉 DEPLOY & BUILD SELESAI (ROOT)! 🎉"
echo "=================================================================="
echo "Silakan buka browser dan akses web kamu di:"
echo "👉 http://202.169.232.241:${PORT_PUB}"
echo "=================================================================="
