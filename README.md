# C-Track — Employee Location & Task Tracking System

A full-stack field-operations platform. Admins assign tasks and monitor employees in real time via a web dashboard; employees receive tasks, submit reports, and are tracked via GPS on the mobile app.

---

## System Architecture

```
┌─────────────────────────────────────────────────────────┐
│                        C-Track                          │
│                                                         │
│  ┌──────────────┐   REST + WS   ┌──────────────────┐   │
│  │  Mobile App  │ ────────────► │  Backend Express  │   │
│  │ (Employee)   │               │  Node + Prisma    │   │
│  │ React Native │ ◄──────────── │  Socket.io        │   │
│  └──────────────┘               │  MySQL/MariaDB    │   │
│                                 └────────┬─────────┘   │
│  ┌──────────────┐   REST + WS            │              │
│  │  Web Admin   │ ─────────────────────► │              │
│  │  (Admin/SM)  │ ◄──────────────────── │              │
│  │  React/Vite  │                        │              │
│  └──────────────┘                        │              │
└─────────────────────────────────────────────────────────┘
```

| Layer | Tech | Port | Access |
|-------|------|------|--------|
| **Backend** | Express + TypeScript + Prisma + Socket.io | 8000 | API + WebSocket |
| **Web Admin** | React 19 + Vite + Leaflet + Chart.js | 5173 | Web roles (Superadmin, Admin, Manager, custom roles) |
| **Mobile** | React Native + Expo SDK 54 + Expo Router | — | Employee only |
| **Database** | MySQL / MariaDB | 3306 | Backend only |

---

## Roles & Permissions (RBAC)

Access is permission-based (`module.action`, e.g. `tasks.create`, `analytics.view`). Roles are named sets of permissions that the **Superadmin** edits in the web **Roles & Akses** page (`/roles`), where new roles can also be created. The permission catalog lives in [`backend-express/src/rbac/permissions.ts`](backend-express/src/rbac/permissions.ts).

| Role | Level | Web | Mobile | Default capabilities |
|------|-------|-----|--------|----------------------|
| `superadmin` | 100 | ✅ | ❌ | Everything, including Roles & Akses (`roles.manage`, superadmin only) |
| `admin` | 50 | ✅ | ❌ | Dashboard, tasks, assignments, monitoring, users (no delete), teams, AI Assistant |
| `manager` | 50 | ✅ | ❌ | Same as admin **plus Employee Analytics**; tasks they create show a "Dibuat oleh Manager" badge |
| `employee` | 10 | ❌ (blocked) | ✅ | View own assignments, start/complete tasks, submit reports, tracked by GPS |
| custom | 1–99 | ✅ | ❌ | Whatever the Superadmin grants; optional task badge |

- Users can only manage (edit, deactivate, delete, assign roles to) users whose role **level is lower** than their own.
- There is no self-registration: accounts are created in User Management.
- After deploying, run `npm run rbac:sync` in `backend-express` (the deploy scripts do this) to sync the permission catalog and system roles.

---

## Features

### Task Management
- Create tasks with title, description, GPS coordinates, and working hours
- Assign tasks to one or more employees (multi-user assignments)
- Track assignment status: `pending` → `in_progress` → `completed`
- Ticket numbers auto-generated for tasks and assignments

### Real-Time GPS Tracking
- Employee location recorded every 15 minutes via background service
- Locations pushed to admin dashboard via Socket.io (`location:updated`)
- Admin monitoring page shows live markers per user on Leaflet map
- Location history per user with filtering
- Offline queue: failed GPS uploads are batched and retried automatically

### Reports
- Employees submit text reports with photos (up to 5 photos)
- Photos stored as files on disk, compressed via **Sharp** (~91% size reduction)
- Admin dashboard shows latest 5 reports; full history in monitoring view
- Real-time notification to team on `report:created` via Socket.io

### Sistem Notifikasi Terpadu (Push & In-App)
- **Push Notifications**: Pemberitahuan via FCM (Android) / APNs (iOS) untuk karyawan melalui Expo Notifications + EAS build, memastikan update diterima meski aplikasi ditutup.
- **In-App Notifications**: Pemberitahuan langsung di dalam aplikasi (Web dan Mobile) yang muncul secara real-time menggunakan Socket.io.
- **Otomatisasi Trigger**: Notifikasi dikirimkan otomatis saat ada tugas baru (`task:assigned`), pembaruan status (`task:status_updated`), laporan baru dari anggota tim (`report:created`), atau pengumuman penting dari admin (`admin:broadcast`).

### Forum & Komunikasi Chat (Real-Time)
- **Real-Time Messaging**: Komunikasi instan dua arah antara Admin dan Karyawan, maupun antar anggota tim menggunakan teknologi WebSockets (Socket.io).
- **Grup & Forum Diskusi**: Ruang percakapan khusus untuk koordinasi proyek atau tim tertentu, memudahkan penyebaran informasi secara terpusat.
- **Riwayat Percakapan**: Semua riwayat pesan disimpan secara persisten di database sehingga informasi penting terkait tugas tidak hilang dan dapat ditelusuri kembali.

### Admin Dashboard (Web)
- **Dashboard**: 6 KPI cards, issue detection, assignment funnel, weekly activity chart, top performers
- **Task Management**: full CRUD, Leaflet map picker, Google Maps link extractor, status management
- **Assignment Management**: create/delete assignments, multi-employee picker
- **Monitoring**: per-assignment live map + location history + activity panel
- **User Management**: full CRUD, role management, status toggle, avatar display

---

## Repository Structure

```
Ctrack/
├── backend-express/       # API server
│   ├── prisma/
│   │   ├── schema.prisma  # Database schema
│   │   └── seed.ts        # Sample data seeder
│   ├── src/
│   │   ├── controllers/   # Route handlers
│   │   ├── middleware/     # Auth, error handling, upload
│   │   ├── routes/         # API route definitions
│   │   ├── sockets/        # Socket.io event handlers
│   │   └── utils/          # Helpers (Sharp image processing, etc.)
│   ├── uploads/            # Image file storage (gitignored)
│   ├── .env.example
│   ├── clean-install.sh    # One-command clean install script
│   ├── restart-backend.sh  # PM2 health-check daemon (cron)
│   ├── setup-cron.sh       # Registers PM2 cron monitor on VPS
│   └── README.md           # ← Full backend docs
│
├── frontend-web/           # Web admin dashboard
│   ├── src/
│   │   ├── pages/          # Dashboard, Task, Taken, Monitoring, UserManagement, Login
│   │   ├── components/     # ProtectedRoute, ResponsiveTable
│   │   ├── services/api.js # All API calls (Axios)
│   │   └── utils/auth.js   # RBAC helpers, session management
│   ├── .env.example
│   ├── clean-install.sh    # One-command clean install script
│   └── README.md           # ← Full frontend docs
│
├── mobile/                 # Employee mobile app
│   ├── app/                # Expo Router screens
│   │   ├── (tabs)/         # Beranda, Laporan, Peta, Profil
│   │   ├── login.tsx
│   │   ├── task-detail.tsx
│   │   ├── task-reports.tsx
│   │   └── report-detail.tsx
│   ├── services/
│   │   ├── api.ts                        # All API calls (Axios)
│   │   ├── locationTrackingRefactored.ts # Background GPS service
│   │   ├── socketService.ts              # Socket.io + notifications
│   │   └── notificationService.ts       # FCM/APNs setup
│   ├── config/api.config.ts  # ← Set backend URL here
│   ├── clean-install.sh      # One-command clean install script
│   └── README.md             # ← Full mobile docs
│
├── deploy-vps.sh           # VPS deploy script (run on VPS directly)
└── README.md               # ← This file
```

---

## Quick Start (Local Development)

### Prerequisites

- Node.js ≥ 18
- MySQL or MariaDB ≥ 5.7
- Expo Go app on a physical device (or Android emulator)

### 1. Backend

```bash
cd backend-express
cp .env.example .env
# Edit .env: set DATABASE_URL, JWT_SECRET
npm install
npx prisma migrate deploy
npx prisma db seed        # loads sample users, tasks, assignments
npm run dev
# Backend running at http://localhost:8000
```

Or use the automated clean install script:

```bash
cd backend-express
./clean-install.sh
```

### 2. Web Admin Dashboard

```bash
cd frontend-web
./clean-install.sh        # or manually:
cp .env.example .env      # VITE_API_BASE_URL=http://localhost:8000/api
npm install
npm run dev
# Open http://localhost:5173
```

### 3. Mobile App

```bash
cd mobile
./clean-install.sh        # or manually:
npm install
```

Edit `mobile/config/api.config.ts`:

```typescript
// Replace with your machine's LAN IP (not localhost — phone needs to reach it)
export const API_BASE_URL = 'http://192.168.x.x:8000/api';
```

```bash
npm start
# Scan QR with Expo Go
```

### All three at once

```bash
# Terminal 1
cd backend-express && npm run dev

# Terminal 2
cd frontend-web && npm run dev

# Terminal 3
cd mobile && npm start
```

### Running Tests

Setiap modul menggunakan **Vitest** untuk pengujian unit & integrasi:

```bash
# 1. Backend tests
cd backend-express
npm test

# 2. Frontend Web tests
cd frontend-web
npm test            # Unit tests (Vitest)
npm run test:e2e    # E2E tests (Playwright)

# 3. Mobile app tests
cd mobile
npm test            # Unit tests (Vitest)
npm run test:watch  # Interactive watch mode
```

---

## Default Accounts (after seeding)

| Role | Email | Password | Use |
|------|-------|----------|-----|
| Superadmin | `superadmin@trackingapp.com` | `password123` | Web dashboard — full control |
| Admin | `admin@trackingapp.com` | `password123` | Web dashboard — ops management |
| Manager | `manager@trackingapp.com` | `password123` | Web dashboard — ops + Employee Analytics |
| Employee | `michael@trackingapp.com` | `password123` | Mobile app |
| Employee | `sarah@trackingapp.com` | `password123` | Mobile app |

> ⚠️ **Change all passwords before any production deployment.**

---

## Environment Variables

### Backend (`backend-express/.env`)

| Variable | Required | Example |
|----------|----------|---------|
| `DATABASE_URL` | ✅ | `mysql://user:pass@localhost:3306/ctrack?timezone=Z` |
| `JWT_SECRET` | ✅ | `your-random-secret-min-32-chars` |
| `JWT_EXPIRES_IN` | — | `7d` |
| `PORT` | — | `8000` |
| `NODE_ENV` | — | `development` |
| `TZ` | — | `Asia/Jakarta` |
| `CORS_ORIGINS` | ✅ | `http://localhost:5173,https://your-frontend.vercel.app` |

### Frontend Web (`frontend-web/.env`)

| Variable | Example |
|----------|---------|
| `VITE_API_BASE_URL` | `http://localhost:8000/api` or `https://your-domain.com/api` |

### Mobile (`mobile/config/api.config.ts`)

```typescript
export const API_BASE_URL = 'http://192.168.x.x:8000/api'; // local
// or
export const API_BASE_URL = 'https://your-domain.com/api'; // production
```

---

## API Overview

Full documentation: [`backend-express/README.md`](backend-express/README.md)

| Group | Base path | Who |
|-------|-----------|-----|
| Auth | `/api/auth/*` | All (no public register) |
| Employee tasks | `/api/my-tasks/*` | Employee (mobile) |
| Location recording | `/api/locations/*` | Employee (mobile) |
| Employee reports | `/api/reports/*` | Employee (mobile) |
| User profile | `/api/profile/*` | All |
| Admin — users | `/api/admin/users/*` | Web roles with `users.*` |
| Admin — tasks | `/api/admin/tasks/*` | Web roles with `tasks.*` |
| Admin — assignments | `/api/admin/assignments/*` | Web roles with `assignments.*` |
| Admin — locations | `/api/admin/locations/*` | Web roles with `monitoring.view_locations` |
| Admin — reports | `/api/admin/reports/*` | Web roles with `monitoring.*` |
| Admin — teams | `/api/admin/teams/*` | Web roles with `teams.*` |
| Roles & permissions | `/api/admin/roles/*`, `/api/admin/permissions` | Superadmin (`roles.manage`) |
| Geocoding | `/api/geocoding/*` | Web (map picker, `tasks.create`/`tasks.update`) |

---

## Socket.io Events

Full documentation: [`backend-express/README.md`](backend-express/README.md)

| Event | Direction | Payload |
|-------|-----------|---------|
| `location:updated` | Server → Admin | Live GPS update from employee |
| `report:created` | Server → All | New report submitted |
| `task:assigned` | Server → Employee | New task assignment |
| `task:status_updated` | Server → All | Assignment status changed |
| `admin:broadcast` | Server → All | Admin announcement |
| `tracking:force_stop` | Server → Employee | Admin stops employee tracking |
| `tracking:start` | Employee → Server | Employee began tracking |
| `tracking:stop` | Employee → Server | Employee stopped tracking |
| `user:join` | Client → Server | Join user notification room |

---

## Production Deployment

The production system runs on a VPS with:
- **Backend**: `https://your-domain.com/api` (behind nginx + PM2)
- **Frontend**: `https://your-domain.com` (nginx serves `dist/`)
- **Mobile**: EAS builds deployed via Expo

### Deploy to VPS

SSH into the VPS and run the script directly from the project directory:

```bash
cd /var/www/C-Track

# Full pipeline: install deps → Prisma → build → PM2 → frontend → nginx
./deploy-vps.sh

# Quick rebuild both backend + frontend
./deploy-vps.sh --build

# Rebuild backend only (build TS + restart PM2)
./deploy-vps.sh --build-backend

# Rebuild frontend only (build Vite + reload nginx)
./deploy-vps.sh --build-frontend
```

### Scripts Overview

| Script | Location | Purpose |
|--------|----------|----------|
| `deploy-vps.sh` | repo root | Deploy script (run on VPS: full, backend, or frontend rebuild) |
| `clean-install.sh` | backend-express/ | Fresh local backend setup (deps, prisma, seed, build) |
| `clean-install.sh` | frontend-web/ | Fresh local frontend setup (deps, lint, build) |
| `clean-install.sh` | mobile/ | Fresh local mobile setup (deps, tsc check, lint) |
| `restart-backend.sh` | backend-express/ | PM2 health-check daemon (called by cron) |
| `setup-cron.sh` | backend-express/ | Registers PM2 cron monitor on VPS |

For nginx + PM2 setup details, see [`backend-express/README.md`](backend-express/README.md).

---

## Shell Scripts Reference

### `deploy-vps.sh` (repo root)

Deploy script — run directly on the VPS. Four modes:

```bash
./deploy-vps.sh                 # Full pipeline (first deploy)
./deploy-vps.sh --build         # Rebuild backend + frontend
./deploy-vps.sh --build-backend  # Rebuild backend only
./deploy-vps.sh --build-frontend # Rebuild frontend only
```

**Full pipeline** (no flag) — 7 steps:

| Step | Action |
|------|--------|
| 1 | Backend: `npm install` |
| 2 | Backend: `prisma generate` + `prisma migrate deploy` |
| 3 | Backend: `prisma db seed` (skips if already seeded) |
| 4 | Backend: `npm run build` (TypeScript) |
| 5 | Backend: `pm2 restart ecosystem.config.js` |
| 6 | Frontend: `npm install` + `sudo rm -rf dist` + `npm run build` |
| 7 | `nginx -t` + `systemctl reload nginx` |

**`--build`** — rebuild both:

| Step | Action |
|------|--------|
| 1 | Backend: `npm run build` → restart PM2 |
| 2 | Frontend: `sudo rm -rf dist` + `npm run build` |
| 3 | `nginx -t` + `systemctl reload nginx` |

**`--build-backend`** — backend only:

| Step | Action |
|------|--------|
| 1 | Backend: `npm run build` |
| 2 | Restart PM2 |

**`--build-frontend`** — frontend only:

| Step | Action |
|------|--------|
| 1 | Frontend: `sudo rm -rf dist` + `npm run build` |
| 2 | `nginx -t` + `systemctl reload nginx` |

---

### `backend-express/clean-install.sh`

Fresh local setup for the backend. Fully automated, no prompts.

```bash
cd backend-express && ./clean-install.sh
```

| Step | Action |
|------|--------|
| 1 | Check Node.js, npm, npx |
| 2 | Copy `.env.example` → `.env` if missing (exits to let you edit it) |
| 3 | Delete `node_modules/` and `package-lock.json` |
| 4 | `npm install` (fresh) |
| 5 | Create `uploads/reports/` and `uploads/thumbnails/` |
| 6 | `prisma generate` |
| 7 | `prisma db push --accept-data-loss` |
| 8 | `prisma migrate deploy` (if migrations exist) |
| 9 | `npm run prisma:seed` |
| 10 | `npm run build` (TypeScript) |

---

### `frontend-web/clean-install.sh`

Fresh local setup for the web admin dashboard.

```bash
cd frontend-web && ./clean-install.sh
```

| Step | Action |
|------|--------|
| 1 | Check Node.js, npm |
| 2 | Copy `.env.example` → `.env` if missing |
| 3 | Delete `node_modules/`, `package-lock.json`, `dist/` |
| 4 | `npm install` (fresh) |
| 5 | `npm run lint` (non-blocking) |
| 6 | `npm run build` (Vite production bundle) |

---

### `mobile/clean-install.sh`

Fresh local setup for the mobile app (Expo + React Native).

```bash
cd mobile && ./clean-install.sh
```

| Step | Action |
|------|--------|
| 1 | Check Node.js, npm; auto-install Expo CLI if missing; warn if EAS CLI absent |
| 2 | Print active `API_BASE_URL` from `config/api.config.ts` |
| 3 | Delete `node_modules/`, `package-lock.json`, `.expo/` cache |
| 4 | `npm install` (fresh) |
| 5 | `tsc --noEmit` TypeScript check (non-blocking) |
| 6 | `npm run lint` (non-blocking) |

---

### `backend-express/restart-backend.sh`

PM2 health-check daemon — designed to be called by cron every 5 minutes on the VPS. Checks if the backend PM2 process is online; if not, restarts it via `ecosystem.config.js`.

---

### `backend-express/setup-cron.sh`

One-time setup script to register the PM2 auto-recovery cron job on the VPS:

```bash
# Adds: */5 * * * * /var/www/C-Track/backend-express/restart-backend.sh
```

---

## Documentation

| Document | Contents |
|----------|---------|
| [`backend-express/README.md`](backend-express/README.md) | Full API reference, Socket.io events, DB schema, deployment |
| [`frontend-web/README.md`](frontend-web/README.md) | Web app pages, API usage, RBAC, known mismatches |
| [`mobile/README.md`](mobile/README.md) | Screens, location tracking architecture, AsyncStorage keys, build guide |

---

## Troubleshooting

### Mobile can't reach backend
1. Phone and computer must be on the **same Wi-Fi network**
2. Use the machine's **LAN IP** — not `localhost` or `127.0.0.1`
3. Find your IP: `ip route get 1 | awk '{print $7}'` (Linux) or `ipconfig` (Windows)
4. Verify: `curl http://192.168.x.x:8000/health` from another device

### Database connection error
```bash
systemctl status mysql        # check MySQL is running
mysql -u root -p              # test credentials
npx prisma migrate deploy     # re-apply migrations
```

### Port already in use
```bash
pkill -f "node.*server"       # kill backend
pkill -f vite                 # kill frontend
```

### Expo / Metro cache issues
```bash
cd mobile
npx expo start --clear
```

### Background location not working on mobile
- Background GPS does **not** work in Expo Go — build a dev or production APK via EAS
- Some Android OEMs kill background processes — add the app to the battery whitelist

### JWT / 401 errors
- Token expires after 7 days (configurable via `JWT_EXPIRES_IN`)
- Web: logout and re-login — the axios interceptor clears storage on 401
- Mobile: shake device → reload, or clear app data
