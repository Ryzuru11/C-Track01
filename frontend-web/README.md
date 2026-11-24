# Ctrack — Frontend Web (Admin Dashboard)

React 19 + Vite admin dashboard for the Ctrack worker tracking system. Provides real-time monitoring, task management, and user administration for admin and superadmin roles.

- **Framework**: React 19 + Vite 7
- **Routing**: React Router v7
- **HTTP client**: Axios (with Bearer token interceptors)
- **Maps**: Leaflet + react-leaflet
- **Charts**: Chart.js + react-chartjs-2
- **Auth**: JWT stored in `localStorage` with 8-hour session expiry
- **Roles**: `superadmin`, `admin` — employee accounts are mobile-only and blocked on web

---

## Project Structure

```
frontend-web/
├── public/
│   ├── Ctrack.png              # App logo
│   └── icon/                  # Sidebar/feature icons (PNG)
├── src/
│   ├── App.jsx                 # Router setup + ProtectedRoute wrappers
│   ├── components/
│   │   ├── ProtectedRoute.jsx  # Auth + session + role guards (wraps all pages)
│   │   └── ResponsiveTable/    # Horizontal-scrollable table wrapper
│   ├── pages/
│   │   ├── Login/              # Login form (email/password)
│   │   ├── Dashboard/          # Analytics overview + issues alert
│   │   ├── Task/               # Task CRUD + Leaflet map picker
│   │   ├── Taken/              # Assignment management
│   │   ├── Monitoring/         # Per-assignment live map + activity panel
│   │   ├── UserManagement/     # User CRUD + role/status management
│   │   ├── Analytics/          # (disabled, route commented out)
│   │   └── shared/
│   │       ├── Sidebar.jsx     # Navigation + user menu + session timer
│   │       └── DataTable.jsx
│   ├── services/
│   │   └── api.js              # All API calls (axios instance + all service functions)
│   └── utils/
│       └── auth.js             # Auth state, RBAC helpers, session management
├── .env
├── .env.example
├── vite.config.js
└── package.json
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
# Local development (proxied through Vite to avoid CORS)
VITE_API_BASE_URL=http://localhost:8000/api

# Production backend
# VITE_API_BASE_URL=https://your-backend.com/api
```

> When using the local backend, the Vite dev server proxies `/api` → `http://localhost:8000` automatically. You may leave the env var unset in that case since `api.js` defaults to `http://localhost:8000/api`.

### 3. Run

```bash
# Development (hot reload, available at http://127.0.0.1:5173)
npm run dev

# Production build
npm run build

# Preview production build locally
npm run preview

# Show your local network URL (for cross-device testing)
npm run network
```

---

## Pages & Routes

| Route | Page | Auth | Roles |
|-------|------|------|-------|
| `/login` | Login | None | — |
| `/` | Redirect → `/dashboard` | — | — |
| `/dashboard` | Dashboard | ✅ | admin, superadmin |
| `/task` | Task Management | ✅ | admin, superadmin |
| `/taken` | Assignment Management | ✅ | admin, superadmin |
| `/monitoring/:takenTaskId` | Live Monitoring | ✅ | admin, superadmin |
| `/users` | User Management | ✅ | admin, superadmin |
| `/analytics` | Analytics | — | (disabled, commented out) |

All protected routes are wrapped in `ProtectedRoute`, which:
1. Checks session validity (8-hour expiry tracked in `localStorage`)
2. Verifies JWT token + user object exist
3. Blocks employee accounts (`role === 'employee'`) and clears auth
4. Checks page-level `PERMISSIONS` from `utils/auth.js`
5. Renders `<Sidebar>` + the page content

---

## Page Details

### Login (`/login`)
- Email + password form
- Calls `POST /api/auth/login` via `api.js`
- On success: saves `token` + `user` to `localStorage`, calls `initSession()`, redirects to `/dashboard`
- Blocks employee accounts with an inline error message
- Handles 401, 422 (validation), and network error states

### Dashboard (`/dashboard`)
Fetches all data in parallel on mount: tasks, users, assignments, latest 5 reports, latest locations.

Panels:
- **6 Metric Cards**: Issues Detected, Completion Rate, Active Assignments, Completed, Total Tasks, Team Size
- **Issue Breakdown**: Bar chart of 4 issue types + Health Score
- **Assignment Funnel**: Pending / In Progress / Completed counts + Completion Rate
- **Report Activity**: Weekly bar chart (reports + completed tasks per day)
- **Top Performers**: Top 5 users by completed assignment count
- **Issues Alert**: Auto-detected employee issues (see logic below)
- **Recent Reports**: Last 5 reports submitted

**Issue detection logic** (runs client-side against `getAssignments` + `getLatestLocations` + `getReports`):

| Issue | Trigger | Severity |
|-------|---------|----------|
| Pending Too Long | Status = `pending` AND assigned > 2h ago | High |
| No Activity | Status = `in_progress` AND no location + no report for > 2h | High |
| No Report Submitted | Has GPS tracking but 0 reports | Medium |
| Report Overdue | Last report submitted > 2h ago | Medium |

Clicking **Monitor** on an issue row navigates to `/monitoring/:takenTaskId`.

### Task (`/task`)
Full CRUD for tasks.

- Search/filter bar (search by title, description, location; filter by status)
- Client-side filtering and sorting (by `ticketNumber` ascending)
- Create/edit modal with:
  - Leaflet map picker (click to pin → reverse-geocodes via `/api/geocoding/reverse`)
  - Google Maps link extractor (paste a Maps URL → backend extracts coordinates via `/api/geocoding/extract-coordinates`)
  - Geocode-on-open: if a text address is in the form, it queries `/api/geocoding/search` to pre-center the map
- Mark task as completed (changes status to `completed`)
- Delete (blocked by backend if task has active assignments — shows specific warning)
- Pagination: 6 items per page (client-side)

### Taken (`/taken`)
Assignment management.

- Create assignment modal: searchable task picker + multi-user picker (employees only) + date + datetime-local start time
- Assignments sorted by status priority: `in_progress` → `pending` → `completed`, then by ticket number
- Per-row **Monitor** button → navigates to `/monitoring/:takenTaskId`
- Delete with confirmation modal

### Monitoring (`/monitoring/:takenTaskId`)
Per-assignment live view. No sidebar (fullscreen layout).

- Fetches assignment details, reports, and current locations on mount
- **MapView**: Leaflet map showing user markers at their latest tracked position + task location marker
- **ActivityPanel**: Tabs for Reports, Location History (with per-user filter)
- Clicking a user in ActivityPanel centers the map on their location
- Clicking a location in the history list centers the map at that point
- Avatar preloading (in-memory cache via `preloadAvatars()`)

### User Management (`/users`)
Full user CRUD.

- Filters: search (name/email), department (from DB), status, role
- Sorting: superadmin → admin → employee
- Permission-gated actions:
  - **Edit**: superadmin can edit any user except themselves; admin can only edit employees
  - **Toggle status**: same rules as edit
  - **Delete**: superadmin only (cannot delete self)
- Create user modal: name, email, password (with confirmation), role (limited by caller's role), phone, department, position, status
- Edit modal: same fields but email disabled, password optional
- Role creation limits: superadmin can create admin/employee; admin can only create employee

---

## API Client (`src/services/api.js`)

Single axios instance configured with:
- `baseURL`: `VITE_API_BASE_URL` (or `http://localhost:8000/api`)
- Request interceptor: attaches `Authorization: Bearer <token>` from `localStorage`
- Response interceptor: on 401 → calls `clearAuth()` + redirects to `/login`

### Exported image base URL

```js
export const STORAGE_BASE_URL = API_BASE_URL.replace('/api', '');
// Used to construct image URLs: `${STORAGE_BASE_URL}/uploads/reports/<filename>`
```

### Stale / unused API functions

Several functions in `api.js` call backend endpoints that don't exist or are unused by any current page:

| Function | Endpoint | Status |
|----------|----------|--------|
| `logoutAll()` | `POST /auth/logout-all` | ❌ Not in backend |
| `refreshToken()` | `POST /auth/refresh-token` | ❌ Not in backend |
| `updateUserStatus()` | `PUT /admin/users/:id/status` | ❌ Not in backend |
| `getDepartments()` | `GET /admin/departments` | ❌ Not in backend |
| `assignTask()` | `POST /admin/tasks/:id/assign` | ❌ Not in backend (use `createAssignment()`) |
| `getTasksByLocation()` | `GET /admin/tasks/by-location` | ❌ Not in backend |
| `updateAssignment()` | `PUT /admin/assignments/:id` | ❌ Not in backend |
| `cancelAssignment()` | `PUT /admin/assignments/:id/cancel` | ❌ Not in backend |
| `getUserStatistics()` | `GET /admin/users/:id/statistics` | ❌ Not in backend |
| `recordLocation()` | `POST /locations` | Exists, but web never tracks |
| `recordBatchLocations()` | `POST /locations/batch` | ❌ Not in backend (backend uses `/locations/bulk`) |
| `getMyLocations()` | `GET /locations/my` | ❌ Not in backend |
| `getMyLocationStatistics()` | `GET /locations/my/statistics` | ❌ Not in backend |
| `getTaskLocations()` | `GET /locations/tasks/:id` | Exists, unused on web |
| `getTaskRoute()` | `GET /locations/tasks/:id/route` | Exists, unused on web |
| `getTaskLocationStatistics()` | `GET /admin/locations/tasks/:id/statistics` | ❌ Not in backend |
| `getUserLocationStatistics()` | `GET /admin/locations/users/:id/statistics` | ❌ Not in backend |
| `findNearbyLocations()` | `GET /admin/locations/nearby` | ❌ Not in backend |
| `deleteLocation()` | `DELETE /admin/locations/:id` | ❌ Not in backend |
| `testConnection()` | `GET /test` | ❌ Not in backend |
| `getReportsByTask()` | `GET /admin/reports/tasks/:taskId` | Duplicate of `getReportsByTakenTask()` |
| `getMyReports()` | `GET /reports/my` | Exists, unused on web |
| `getLocationsForAnalytics()` | `GET /admin/locations/all` | Exists, unused (Analytics page disabled) |

### Functions actually called by the app

| Function | Backend route | Called from |
|----------|--------------|-------------|
| `login()` | `POST /auth/login` | Login |
| `logout()` | `POST /auth/logout` | Sidebar |
| `getUsers()` | `GET /admin/users` | Dashboard, Taken, UserManagement |
| `createUser()` | `POST /admin/users` | UserManagement |
| `getUserDetails()` | `GET /admin/users/:id` | UserManagement |
| `updateUserProfile()` | `PUT /profile/:id` | UserManagement (edit) |
| `deleteUser()` | `DELETE /admin/users/:id` | UserManagement |
| `getUserAvatar()` | `GET /admin/users/:id/avatar` | Monitoring (preload) |
| `preloadAvatars()` | (batch `getUserAvatar`) | Monitoring |
| `getTasks()` | `GET /admin/tasks` | Dashboard, Task, Taken |
| `createTask()` | `POST /admin/tasks` | Task |
| `getTaskDetails()` | `GET /admin/tasks/:id` | Task (edit) |
| `updateTask()` | `PUT /admin/tasks/:id` | Task |
| `deleteTask()` | `DELETE /admin/tasks/:id` | Task |
| `markTaskAsCompleted()` | `POST /admin/tasks/:id/mark-completed` | Task |
| `getAssignments()` | `GET /admin/assignments` | Dashboard, Taken |
| `createAssignment()` | `POST /admin/assignments` | Taken |
| `getAssignmentDetails()` | `GET /admin/assignments/:id` | Monitoring |
| `deleteAssignment()` | `DELETE /admin/assignments/:id` | Taken |
| `getReports()` | `GET /admin/reports` | Dashboard |
| `getReportsByTakenTask()` | `GET /admin/reports/tasks/:id` | Monitoring |
| `getCurrentLocationsByTakenTask()` / `getCurrentTaskLocations()` | `GET /admin/locations/tasks/:id/current` | Monitoring |
| `getLocationsByTakenTask()` | `GET /admin/locations/tasks/:id` | ActivityPanel |
| `getLatestLocations()` | `GET /admin/locations/latest` | Dashboard |
| `getAllLocations()` | `GET /admin/locations/all` | (unused, Analytics disabled) |
| `reverseGeocode()` | `GET /geocoding/reverse` | Task (map picker) |
| `extractCoordinatesFromMapsLink()` | `POST /geocoding/extract-coordinates` | Task |

---

## Auth & Session (`src/utils/auth.js`)

Auth state is stored entirely in `localStorage`:

| Key | Value |
|-----|-------|
| `token` | JWT string |
| `user` | JSON-stringified user object |
| `isAuthenticated` | `"true"` |
| `sessionExpiry` | Unix timestamp (ms) |
| `rememberMe` | `"true"` (if remember-me was checked — UI currently disabled) |

**Session timeout**: 8 hours. Refreshes on `mousedown`, `keydown`, `scroll`, `touchstart` events (via `setupSessionListener()`).

### Role utilities

```js
getUserRole()         // Returns 'superadmin' | 'admin' | 'employee' | null
isAdmin()             // true if role is admin or superadmin
isSuperAdmin()        // true if role is superadmin
canAccessPage(name)   // checks PERMISSIONS map
canAccessWeb()        // false for employee role
canEditUser(target)   // superadmin: anyone except self; admin: employees only
canDeleteUser(target) // superadmin only, not self
canChangeUserStatus() // same rules as canEditUser
getAllowedRolesToCreate() // superadmin → [admin, employee]; admin → [employee]
```

---

## Known API Mismatches (Frontend vs Backend)

Beyond the stale functions listed above, these are active mismatches that will cause runtime errors:

1. **`updateUserStatus()`** is called from `UserManagement.handleToggleStatus()` but the backend has no `PUT /admin/users/:id/status` route. The backend only updates status via `PUT /profile/:id` (full profile update).

2. **`getDepartments()`** is called from `loadDepartments()` but that function is commented out in `UserManagement`. The backend has no departments endpoint. Department is a free-text field in the DB.

3. **`getReportsByTakenTask(takenTaskId)`** and **`getReportsByTask(taskId)`** both call the same endpoint `GET /admin/reports/tasks/:id`, but the backend route is actually mounted under employee routes as `GET /reports/tasks/:takenTaskId`. The admin path does not exist — reports are fetched via `GET /admin/reports?takenTaskId=...`.

---

## Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `VITE_API_BASE_URL` | `http://localhost:8000/api` | Backend API base URL |

---

## Vite Dev Server

```js
// vite.config.js
server: {
  host: '127.0.0.1',
  port: 5173,
  proxy: {
    '/api': { target: 'http://localhost:8000', changeOrigin: true }
  }
}
```

The `/api` proxy means all `fetch('/api/...')` calls (like in the geocoding map picker) route to the local backend without CORS issues. Axios calls use the full `http://localhost:8000/api` URL directly.
