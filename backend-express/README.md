# Ctrack — Backend (Express)

Node.js / Express backend with real-time Socket.io, JWT auth, Prisma ORM, and Expo push notifications.

- **Runtime**: Node.js ≥ 18, TypeScript
- **Database**: MySQL via Prisma ORM
- **Auth**: JWT (Bearer token)
- **Realtime**: Socket.io
- **Push Notifications**: Expo Server SDK
- **Image processing**: Sharp (compress + thumbnail on save)
- **Timezone**: Asia/Jakarta (UTC+7) — set via `process.env.TZ` at boot

## AI Copilot Module

The backend now includes a production-oriented AI analytics module for CTrack:

- Routes: `/api/ai/agent`, `/api/ai/tools`, `/api/ai/retrieval`, `/api/ai/prompts/system`
- 3-stage optimization pipeline: analytics engine → context builder → AI reasoning
- AI guard to avoid model calls for data/analytics-only questions
- Redis cache (6h) and BullMQ sequential queue (`ai-processing`) for explanation requests
- Token-efficient short prompt and retry-aware Gemini multi-model AI service
- Gemini model router with limit guard + fallback (`gemini-2.5-flash`, `gemini-1.5-flash`, `gemini-2.5-pro`)
- Usage monitoring endpoints: `/api/ai/model-limits`, `/api/ai/usage-stats`

See detailed architecture + examples in `docs/ai-copilot.md`.

---

## Project Structure

```
backend-express/
├── prisma/
│   ├── schema.prisma       # Database schema (source of truth)
│   └── seed.ts             # Seeder
├── src/
│   ├── app.ts              # Entry point: Express + Socket.io setup
│   ├── config/
│   │   └── database.ts     # Prisma client singleton
│   ├── controllers/        # Business logic per domain
│   │   ├── authController.ts
│   │   ├── taskController.ts
│   │   ├── takenTaskController.ts
│   │   ├── locationController.ts
│   │   ├── reportController.ts
│   │   └── userController.ts
│   ├── middleware/
│   │   ├── auth.ts         # JWT authentication (populates req.user)
│   │   ├── permissions.ts  # requirePermission / requireAnyPermission / requireWeb (RBAC)
│   │   ├── validate.ts     # Request validation (zod)
│   │   └── errorHandler.ts # Global error handler + AppError class
│   ├── routes/
│   │   ├── index.ts        # Route mount points
│   │   ├── auth.ts
│   │   ├── tasks.ts
│   │   ├── takenTasks.ts   # Exports employeeRouter + adminRouter
│   │   ├── locations.ts
│   │   ├── reports.ts      # Exports employeeReportRoutes + adminReportRoutes
│   │   ├── users.ts
│   │   └── geocoding.ts
│   ├── sockets/
│   │   └── index.ts        # Socket.io event handlers
│   └── utils/
│       ├── auth.ts         # hashPassword, comparePassword, generateToken
│       ├── encryption.ts   # AES encryption (optional, unused by default)
│       ├── fileStorage.ts  # Save/delete base64 images to disk via Sharp
│       ├── imageProcessor.ts
│       ├── json.ts         # formatTakenTaskResponse (parses JSON fields)
│       ├── network.ts      # Display server URLs on boot
│       ├── notifications.ts # Expo push notification helpers
│       └── timezone.ts     # getJakartaTime(), toJakartaTime()
├── uploads/
│   ├── reports/            # Full-size report images (served at /uploads/reports)
│   └── thumbnails/         # 300×300 JPEG thumbnails (served at /uploads/thumbnails)
├── .env
├── .env.example
├── ecosystem.config.js     # PM2 configuration (production)
├── package.json
└── tsconfig.json
```

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env`:

```env
DATABASE_URL="mysql://user:password@localhost:3306/trackingapp?timezone=Z"
JWT_SECRET="your-secret-key"
JWT_EXPIRES_IN="7d"
PORT=8000
NODE_ENV=development
TZ=Asia/Jakarta
CORS_ORIGINS="http://localhost:5173,http://127.0.0.1:5173"
```

### Realtime DB via `.env` (Direct Connection)

To read realtime production data, point `DATABASE_URL` directly to your production database host/port:

```env
DATABASE_URL="mysql://<db_user>:<db_password>@<db_host>:<db_port>/<db_name>?timezone=Z"
```

Example:

```env
DATABASE_URL="mysql://ctrack:<password>@202.169.232.241:3306/cleon_tracking?timezone=Z"
```

Notes:
- Restart backend after changing `DATABASE_URL`.
- Ensure DB host allows inbound connection from your backend runtime.
- Operational AI questions (active users/tasks/reports) bypass AI cache to preserve realtime answers.

> **Important:** `?timezone=Z` in `DATABASE_URL` makes MySQL return UTC timestamps, which is required for correct timezone handling.

### 3. Generate Prisma client and sync schema

```bash
npm run prisma:generate
npm run prisma:push       # push schema to DB (dev only)
# OR
npx prisma db pull        # introspect existing DB

npm run rbac:sync         # sync permission catalog + system roles (idempotent, run after every deploy)
```

> **Fresh (empty) database:** `prisma/migrations` only contains incremental changes, not a baseline, so `prisma migrate deploy` fails on an empty database (P3009, "Table … doesn't exist"). Create the schema with `db push`, then record the migrations as applied:
>
> ```bash
> npx prisma db push
> npx prisma migrate resolve --applied 20261021000000_rbac
> npm run rbac:sync          # or npm run prisma:seed for sample data
> ```
>
> If a failed attempt is already recorded, first run `npx prisma migrate resolve --rolled-back 20261021000000_rbac`. `clean-install.sh` does all of this automatically.

### 4. Create upload directories

```bash
mkdir -p uploads/reports uploads/thumbnails
```

### 5. (Optional) Seed sample data

```bash
npm run prisma:seed
```

---

## Running

```bash
# Development (ts-node + nodemon, auto-reload)
npm run dev

# Production (compile first, then run JS)
npm run build
npm start

# Show network URLs only (without starting server)
npm run urls
```

Default port: **8000** (override with `PORT` env var).

---

## API Reference

All routes are prefixed with `/api`. Protected routes require:

```
Authorization: Bearer <jwt_token>
```

"web + permission" in the tables below means the route needs a web-platform role (`requireWeb`) **and** a permission from the RBAC catalog. The exact permission per endpoint is in `src/routes/*.ts` (`requirePermission` / `requireAnyPermission`) and in the Swagger docs at `/docs`.

### Health Check

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Returns `{ status, timestamp, timezone }` |

---

### Auth — `/api/auth`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/login` | None | — | Login, returns JWT + user object |
| GET | `/me` | ✅ | Any | Get current authenticated user |
| POST | `/logout` | ✅ | Any | Logout (client-side token removal) |
| POST | `/change-password` | ✅ | Any | Change own password |
| POST | `/register-push-token` | ✅ | Any | Save Expo push token for mobile notifications |

**Login body:**
```json
{ "email": "user@example.com", "password": "secret" }
```

**Login response:**
```json
{
  "message": "Login successful",
  "user": {
    "id": "uuid", "name": "...", "email": "...", "phoneNumber": null,
    "department": null, "position": null, "address": null,
    "avatar": null, "status": "active", "role": "employee"
  },
  "token": "eyJ..."
}
```

> **Platform rule:** With `x-client-type: mobile` only mobile-platform roles (`employee`) can log in; without it (or with `web`) only web-platform roles can. The login and `/auth/me` responses include `roleDisplayName`, `roleLevel`, `roleColor`, `platform` and `permissions[]`.
>
> **No self-registration:** accounts are created through `POST /api/admin/users` (`users.create`).

---

### Admin — Users — `/api/admin/users`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/` | ✅ | web + permission | List all users (query: `?status=active&role=employee`) |
| POST | `/` | ✅ | web + permission | Create user |
| GET | `/:userId` | ✅ | web + permission | Get user by ID |
| DELETE | `/:userId` | ✅ | web + permission | Delete user |
| GET | `/:userId/avatar` | ✅ | Any | Get avatar only (for lazy loading) |

### Profile — `/api/profile`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| PUT | `/:userId` | ✅ | Any | Update own profile |
| POST | `/:userId/avatar` | ✅ | Any | Upload avatar (base64) |

---

### Admin — Tasks — `/api/admin/tasks`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/` | ✅ | web + permission | List all tasks (query: `?status=active`) |
| POST | `/` | ✅ | web + permission | Create task |
| GET | `/statistics` | ✅ | web + permission | `{ total, active, inactive }` |
| GET | `/:taskId` | ✅ | web + permission | Get task by ID (includes takenTasks, locations, reports) |
| PUT | `/:taskId` | ✅ | web + permission | Update task |
| DELETE | `/:taskId` | ✅ | web + permission | Delete task (cascades to takenTasks) |
| POST | `/:taskId/mark-completed` | ✅ | web + permission | Set task status to `completed` |

**Task object:**
```json
{
  "taskId": "uuid",
  "ticketNumber": "TSK-0001",
  "title": "...",
  "description": "...",
  "location": "...",
  "latitude": -6.2,
  "longitude": 106.8,
  "start_time": "08:00",
  "end_time": "17:00",
  "status": "active",
  "manualOverride": false
}
```

> `start_time` / `end_time` are stored as MySQL `TIME` fields and returned as `"HH:MM"` strings (both camelCase and snake_case variants).

---

### Admin — Assignments — `/api/admin/assignments`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/` | ✅ | web + permission | List all assignments (query: `?status=&userId=`) |
| POST | `/` | ✅ | web + permission | Create assignment (assign task to users) |
| GET | `/:takenTaskId` | ✅ | web + permission | Get assignment by ID |
| DELETE | `/:takenTaskId` | ✅ | web + permission | Delete assignment |
| GET | `/user/:userId` | ✅ | web + permission | Get all tasks for a specific user |

**Assign task body:**
```json
{
  "taskId": "uuid",
  "userIds": ["uuid1", "uuid2"],
  "date": "2026-03-10",
  "startTime": "2026-03-10T08:00:00Z"
}
```

When an assignment is created:
- All users get initial `userStatuses: { userId: "pending" }`
- A Socket.io `task:assigned` event is emitted to all clients
- Expo push notifications are sent to assigned users

---

### Employee — My Tasks — `/api/my-tasks`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| GET | `/` | ✅ | Any | Get own assigned tasks |
| GET | `/statistics` | ✅ | Any | `{ totalTasks, completedTasks, inProgressTasks, pendingTasks, cancelledTasks }` |
| GET | `/:takenTaskId` | ✅ | Any | Get specific assignment detail |
| PATCH | `/:takenTaskId/start` | ✅ | Any | Start tracking (sets user status to `in_progress`) |
| PATCH | `/:takenTaskId/status` | ✅ | Any | Update own status (`pending`, `in_progress`, `completed`) |

**Assignment / TakenTask object:**
```json
{
  "takenTaskId": "uuid",
  "ticketNumber": "ASN-0001",
  "taskId": "uuid",
  "userIds": ["uuid1", "uuid2"],
  "userStatuses": { "uuid1": "in_progress", "uuid2": "pending" },
  "status": "pending",
  "date": "2026-03-10T00:00:00.000Z",
  "startTime": null,
  "endTime": null,
  "users": [{ "id": "uuid", "name": "...", "email": "..." }],
  "task": { ... }
}
```

**Overall status logic (auto-computed):**
- `completed` — all users' statuses are `completed`
- `in_progress` — at least one user is `in_progress`
- Otherwise stays as-is

---

### Locations — `/api/locations` and `/api/admin/locations`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/` | ✅ | Any | Save a single location point |
| POST | `/bulk` | ✅ | Any | Bulk save location points (idempotent via `ON DUPLICATE KEY`) |
| GET | `/tasks/:takenTaskId` | ✅ | Any | Get location history for a task |
| GET | `/tasks/:takenTaskId/route` | ✅ | Any | Get route + stats (distance_km, duration_hours) |
| GET | `/tasks/:takenTaskId/current` | ✅ | web + permission | Get latest location per user in task |
| GET | `/all` | ✅ | web + permission | Get all locations (query: `?userId=&limit=100`) |
| GET | `/latest` | ✅ | web + permission | Get latest location per active user |

**Save location body:**
```json
{
  "takenTaskId": "uuid",
  "latitude": -6.2,
  "longitude": 106.8,
  "accuracy": 5.0,
  "address": "Jl. Example No. 1",
  "trackingStatus": "auto",
  "recordedAt": "2026-03-10T08:30:00.000Z"
}
```

**Bulk save body:**
```json
[
  {
    "id": "client-generated-uuid",
    "takenTaskId": "uuid",
    "userId": "uuid",
    "latitude": -6.2,
    "longitude": 106.8,
    "accuracy": 5.0,
    "recordedAt": 1710000000000
  }
]
```

> Addresses are resolved on the mobile device via `reverseGeocodeAsync`. If not provided, the backend falls back to `"lat, lon"` string format.

When a location is saved via HTTP, a `location:updated` Socket.io event is emitted to the `admins` room.

---

### Reports — `/api/reports` and `/api/admin/reports`

| Method | Path | Auth | Roles | Description |
|--------|------|------|-------|-------------|
| POST | `/` | ✅ | Any | Create report (1–3 GPS-verified camera photos) |
| GET | `/my` | ✅ | Any | Get own reports (paginated: `?page=1&perPage=15&startDate=&endDate=`) |
| GET | `/my-tasks` | ✅ | Any | Get tasks grouped with report stats |
| GET | `/tasks/:takenTaskId` | ✅ | Any | Get all reports for a specific task (full team) |
| GET | `/statistics/my` | ✅ | Any | `{ total_reports, reports_this_month, reports_this_week }` |
| PUT | `/:reportId` | ✅ | Any | Update own report (admin can edit any) |
| GET | `/:reportId` | ✅ | Any | Get report by ID |
| GET | `/` (admin) | ✅ | web + permission | Get all reports (query: `?takenTaskId=&userId=`) |
| DELETE | `/:reportId` (admin) | ✅ | web + permission | Delete report + image files |

**Create report body:**
```json
{
  "takenTaskId": "uuid",
  "report": "Report text...",
  "photos": [
    {
      "image": "data:image/jpeg;base64,...",
      "latitude": -6.2,
      "longitude": 106.8,
      "accuracy": 8.5,
      "capturedAt": "2026-11-24T10:00:00.000Z",
      "mocked": false
    }
  ]
}
```

The backend rejects more than three photos, missing or mock-location metadata, accuracy worse than 100 m, captures older than 15 minutes, tasks without coordinates, and capture locations farther than 100 m from the task. It burns a server timestamp, GPS coordinates, and a locally rendered schematic inset (task and capture markers) into each image. The inset does not request map tiles or send coordinates to a map provider.

**Image storage:** Watermarked photos are compressed via Sharp (max 1920px wide, 75% JPEG quality) and saved to `uploads/reports/`. Filenames (UUID) are stored as a JSON array in the `image` column. Thumbnails (300×300) are generated from the watermarked image and saved to `uploads/thumbnails/`.

**Integrity limitation:** GPS metadata and the Android mock-location flag originate from the mobile device and can be forged on a rooted or modified device or by a custom API client. The distance check and watermark are deterrents, not cryptographic proof of physical presence.

**Image access URLs:**
- Full image: `GET /uploads/reports/<filename>.jpg`
- Thumbnail: `GET /uploads/thumbnails/thumb_<filename>.jpg`
- Legacy alias: `GET /storage/<filename>.jpg` → maps to `uploads/reports/`

When a report is created, Socket.io events are emitted:
- `report:created` → each assigned user's room (`user:<userId>`)
- `report:new` → `admins` room

---

## Socket.io

### Connection

```javascript
import { io } from 'socket.io-client';

const socket = io('http://localhost:8000', {
  auth: { token: '<jwt_token>' }
});
```

Authentication uses the same JWT as HTTP. On connect, the socket server:
- Verifies the token and loads the user
- Joins permission rooms: `perm:monitoring.view_locations`, `perm:monitoring.view_reports`, `perm:assignments.view` (if the role has that permission) and `user:<userId>` (for everyone)
- Emits `rbac:updated` to `user:<userId>` when that user's role or role permissions change; the client answers with `rbac:refresh` to re-join rooms

### Events — Client → Server

| Event | Payload | Description |
|-------|---------|-------------|
| `location:update` | `{ takenTaskId, latitude, longitude, accuracy, address, trackingStatus }` | Save a location + broadcast to admins |
| `task:status_change` | `{ takenTaskId, status }` | Update user's task status |
| `report:created` | `{ reportId, takenTaskId }` | Notify admins of new report |
| `location:subscribe` | `{ userId }` | Admin subscribes to a user's location room |
| `location:unsubscribe` | `{ userId }` | Admin unsubscribes |
| `admin:broadcast` | `{ message }` | Admin sends message to all users |
| `admin:message_user` | `{ userId, message }` | Admin sends message to a specific user |
| `user:online` | — | Announce presence to admins |

### Events — Server → Client

| Event | Sent to | Payload | Description |
|-------|---------|---------|-------------|
| `connected` | sender | `{ message, userId, role }` | Connection confirmed |
| `location:updated` | `admins` | `{ locationId, takenTaskId, userId, userName, latitude, longitude, accuracy, address, recordedAt, task }` | New location from employee |
| `location:saved` | sender | `{ locationId, recordedAt }` | Location save acknowledged |
| `task:assigned` | all | `{ takenTaskId, taskId, userIds, taskTitle }` | New task assignment |
| `task:status_updated` | `admins` | `{ takenTaskId, userId, status, overallStatus }` | Task status changed |
| `task:tracking_started` | all | `{ takenTaskId, userId, allUsersInProgress, overallStatus, userStatuses }` | Tracking started |
| `task:colleague_update` | `user:<uid>` | `{ takenTaskId, userId, userName, status }` | Teammate changed status |
| `task:status_saved` | sender | `{ takenTaskId, status, overallStatus }` | Status change acknowledged |
| `report:new` | `admins` | `{ reportId, takenTaskId, userId, userName, ... }` | New report submitted |
| `report:created` | `user:<uid>` | `{ reportId, takenTaskId, ... }` | Report confirmed to team |
| `report:updated` | `admins`, `user:<uid>` | `{ reportId, takenTaskId, userId, updatedAt }` | Report was edited |
| `user:status` | `admins` | `{ userId, userName, status: 'online'|'offline' }` | User connected/disconnected |
| `admin:message` | all | `{ from, message, timestamp }` | Admin broadcast |
| `admin:direct_message` | `user:<uid>` | `{ from, message, timestamp }` | Direct message from admin |
| `error` | sender | `{ message, error? }` | Error from server |

---

## Database Schema

> **Source of truth:** `prisma/schema.prisma`

| Table | Description |
|-------|-------------|
| `users` | User accounts. `avatar` stored as base64 `LongText`. `push_token` for Expo notifications. |
| `tasks` | Task templates. `start_time` / `end_time` are MySQL `TIME` columns. `ticket_number` format: `TSK-NNNN`. |
| `taken_tasks` | Assignments linking a task to one or more users. `user_ids` and `user_statuses` are JSON columns. `ticket_number` format: `ASN-NNNN`. |
| `locations` | GPS tracking records. `tracking_status` enum: `auto` / `manual`. |
| `reports` | Reports linked to a taken task. `image` stores a JSON array of filenames. `ticket_number` format: `RPT-NNNN`. |
| `roles` | Roles: `superadmin`, `admin`, `employee`. |
| `model_has_roles` | Spatie-style pivot (mirrors Laravel's role package schema). |
| `permissions`, `model_has_permissions`, `role_has_permissions` | Permission tables (managed by Laravel, read-only from Express). |

---

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `DATABASE_URL` | ✅ | — | MySQL connection string (must include `?timezone=Z`) |
| `JWT_SECRET` | ✅ | — | Secret for signing JWTs |
| `JWT_EXPIRES_IN` | | `7d` | JWT expiration |
| `PORT` | | `8000` | HTTP port |
| `NODE_ENV` | | `development` | `development` or `production` |
| `TZ` | | `Asia/Jakarta` | Server timezone |
| `CORS_ORIGINS` | | `http://localhost:5173` | Comma-separated allowed origins |
| `UPLOAD_DIR` | | `<root>/uploads` | Custom upload directory path |

---

## Roles & Permissions (RBAC)

Access is checked per permission (`module.action`), never by role name. The catalog, default grants and system roles are defined in `src/rbac/permissions.ts`; `npm run rbac:sync` writes them to the `permissions` / `roles` tables (default grants are only applied when a system role is first initialized, so changes made in the Role dashboard survive deploys).

| Role | Level | Platform | Default access |
|------|-------|----------|----------------|
| `superadmin` | 100 | web | Everything, incl. `roles.manage` (Role dashboard) |
| `admin` | 50 | web | Everything except `analytics.view`, `users.delete`, `roles.manage` |
| `manager` | 50 | web | Admin defaults + `analytics.view`; `show_task_badge` on |
| `employee` | 10 | mobile | Own tasks, locations and reports only |
| custom | 1–99 | web | Set by the Superadmin |

- `middleware/auth.ts` reloads the user's role and permissions on every request, so changes apply immediately.
- Role hierarchy: users can only manage users / assign roles with a **lower** level; nobody can change their own role or status.
- Platform rule: mobile login only for `platform = mobile`, web login and every `/admin` route only for `platform = web`.
- Role management API: `/api/admin/roles`, `/api/admin/permissions` (see Swagger tag "13. Admin - Roles & Hak Akses").

---

## Push Notifications

Uses **Expo Server SDK**. Tokens are registered via `POST /api/auth/register-push-token`.

- Invalid tokens are auto-removed from the database (`DeviceNotRegistered` error)
- Notifications are sent in batches of 100 (Expo's limit)
- Notifications are sent on: task assignment

---

## Troubleshooting

**Database connection fails**
```bash
npx prisma db pull   # validates connection + introspects schema
```

**Port already in use**
```bash
lsof -ti:8000 | xargs kill -9
```

**CORS error from frontend or mobile**
Add origin to `.env`:
```env
CORS_ORIGINS="http://localhost:5173,http://192.168.1.x:5173"
```

**JWT expired**
```env
JWT_EXPIRES_IN="30d"
```

**Images not loading**
- Confirm `uploads/reports/` exists and is writable (see **VPS: Fix image permissions** below)
- Check that `/uploads` and `/storage` static paths are configured in `app.ts`
- Verify `UPLOAD_DIR` env var if using a custom path

---

## Production (VPS with PM2)

### Start / manage process

```bash
# Start (uses ecosystem.config.js)
pm2 start ecosystem.config.js

# Restart after code change
npm run build && pm2 restart ecosystem.config.js

# View logs
pm2 logs backend-express --lines 100

# Check status
pm2 status

# Save PM2 config so it survives reboots
pm2 save
pm2 startup   # follow the printed command to enable on boot
```

### Auto-recovery via cron

`restart-backend.sh` checks PM2 status and restarts the process if it's down. `setup-cron.sh` registers it as a cron job (run **once** on the VPS).

```bash
# On VPS — run once to install the cron job
cd /var/www/C-Track/backend-express
bash setup-cron.sh
```

The cron job runs `restart-backend.sh` every 5 minutes. Actions are logged to `backend-recovery.log`.

```bash
# Monitor recovery log
tail -f backend-recovery.log

# Check active cron jobs
crontab -l
```

### VPS: Fix image permissions

Run this after first deploy or if Sharp/image errors appear:

```bash
cd /var/www/C-Track/backend-express

# Fix uploads folder ownership and permissions
sudo chown -R cleon:cleon uploads/
chmod -R 755 uploads/
find uploads/ -type f -exec chmod 644 {} \;

# If Sharp fails (native binding issue)
sudo apt-get update && sudo apt-get install -y libvips-dev
npm install sharp --save --force

# Verify Sharp works
node -e "const sharp = require('sharp'); console.log('Sharp OK:', sharp.versions);"
```

> **SFTP / sync warning:** Never sync `uploads/` via SFTP or file-sync tools. Binary files can get corrupted in transit. Only the running Node.js process should write to `uploads/`. Add `uploads/**` to your SFTP ignore list.

### Deployment checklist

- [ ] `JWT_SECRET` changed to a strong production value
- [ ] `NODE_ENV=production` in `.env`
- [ ] `CORS_ORIGINS` set to production frontend URL(s)
- [ ] `npm run build` ran successfully
- [ ] `uploads/reports/` and `uploads/thumbnails/` exist and are writable
- [ ] PM2 started with `ecosystem.config.js`
- [ ] `pm2 save` + `pm2 startup` configured
- [ ] Cron auto-recovery installed via `setup-cron.sh`
- [ ] Nginx reverse proxy configured (port 8000 → public port)
- [ ] Health check passes: `curl http://localhost:8000/health`
- [ ] `uploads/**` excluded from SFTP sync

