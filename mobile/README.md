# Ctrack — Mobile App (Employee)

React Native (Expo) mobile app for the Ctrack worker tracking system. Used exclusively by **employees** to view task assignments, submit reports, and allow real-time location tracking.

- **Framework**: React Native 0.81 + Expo SDK ~54 + Expo Router ~6
- **Language**: TypeScript
- **HTTP Client**: Axios (Bearer token, AsyncStorage)
- **Real-Time**: Socket.io client
- **Maps**: react-native-maps + OSRM routing + Carto tiles + Nominatim geocoding
- **Location**: expo-location + expo-task-manager (background)
- **Notifications**: expo-notifications (FCM/APNs via EAS)
- **Auth**: JWT stored in `AsyncStorage` (`userToken` key)
- **Backend**: `https://ctrack.wikolabs.biz.id/api` (production) or local IP:port for development

---

## Project Structure

```
mobile/
├── app/                            # Expo Router screens
│   ├── _layout.tsx                 # Root layout: splash, onboarding, push notifications, socket, tracking resume
│   ├── index.tsx                   # Auth redirect → login | /(tabs)
│   ├── login.tsx                   # Login screen
│   ├── task-detail.tsx             # Task detail + start/complete + location tracking UI
│   ├── task-reports.tsx            # Reports list for a specific assignment
│   ├── report-detail.tsx           # Single report view + edit
│   ├── modal.tsx                   # Generic modal placeholder
│   └── (tabs)/
│       ├── _layout.tsx             # Bottom tab bar (4 tabs)
│       ├── index.tsx               # Beranda (Home) — task list + quick stats
│       ├── laporan.tsx             # Laporan — reports dashboard (grouped by task)
│       ├── map.tsx                 # Peta — live map of active task destination
│       └── profile.tsx             # Profil — user info, edit profile, change password, avatar, logout
├── components/
│   ├── CustomSplash.tsx            # Animated branded splash screen
│   ├── StartingScreen.tsx          # First-launch onboarding + permission requests
│   ├── TrackingMap.tsx             # Map with routing (OSRM), user location, destination pin
│   ├── SuccessCheckOverlay.tsx     # Animated success overlay (used on task completion)
│   ├── swipeable-button.tsx        # Swipeable "slide to start/complete" button component
│   └── ui/
│       ├── AppAlert.tsx            # Global toast/dialog overlay (used via utils/alert.ts)
│       ├── icon-symbol.tsx         # SF Symbols / Vector Icons wrapper
│       └── ...
├── services/
│   ├── api.ts                      # All API calls (authAPI, tasksAPI, locationsAPI, profileAPI, reportsAPI)
│   ├── locationTrackingRefactored.ts # Background location tracking service (LocationTrackingService)
│   ├── socketService.ts            # Socket.io client + real-time event handlers
│   └── notificationService.ts     # Push notification setup (FCM/APNs)
├── config/
│   └── api.config.ts              # API_BASE_URL, SOCKET_CONFIG, MAP_CONFIG
├── types/
│   ├── index.ts                   # Re-exports all types
│   ├── auth.ts                    # Auth request/response types
│   ├── common.ts                  # Shared types (UserProfile, etc.)
│   ├── tasks.ts                   # Task/assignment types
│   └── locations.ts               # Location types
├── utils/
│   └── alert.ts                   # Global toast/dialog helpers (showToast, showDialog, appAlertRef)
├── hooks/
│   └── use-color-scheme.ts        # Color scheme hook
├── constants/
│   └── theme.ts                   # Color tokens (Colors.light.yellow, Colors.light.yellowAccent, etc.)
├── app.json                       # Expo app config (permissions, plugins, EAS project ID)
├── eas.json                       # EAS Build profiles (development, preview, production)
├── config/api.config.ts           # URL configuration
└── package.json
```

---

## Setup

### 1. Install dependencies

```bash
cd mobile
npm install
```

### 2. Configure API URL

Set `EXPO_PUBLIC_API_BASE_URL` in `.env.local` to override the production API URL for local development:

```env
# Android emulator: http://10.0.2.2:8000/api
# Physical device: use the computer's LAN IP, e.g.
EXPO_PUBLIC_API_BASE_URL=http://192.168.1.xxx:8000/api
```

Without this environment variable, the app uses the production API URL.

> **Note:** The port in the current production URL is 443 (HTTPS). For local dev the backend runs on port **8000**. The old `API_MIGRATION_EXPRESS.md` docs reference port 5000 — that was a temporary dev setup, now resolved.

### 3. Start the dev server

```bash
npm start
# Then: press 'a' for Android, 'i' for iOS, or scan QR in Expo Go
```

### 4. Clear cache (if needed)

```bash
npm start -- --clear
```

### 5. Running Tests

Unit tests use **Vitest**. Test suites are located in `__tests__/`.

```bash
# Run all tests once
npm test

# Run tests in interactive watch mode
npm run test:watch

# Run a specific test file
npx vitest run __tests__/utils/alert.test.ts
```

---

## Screens & Navigation

### Boot flow (`_layout.tsx` → `index.tsx`)

1. `_layout.tsx` runs on every app start:
   - Shows `CustomSplash` animated screen
   - Registers for push notifications (`registerForPushNotificationsAsync`)
   - If `userToken` exists in AsyncStorage → calls `initializeSocket()`
   - On first launch (`onboardingDone` missing) → shows `StartingScreen` (onboarding + permissions)
   - 1 second after ready → calls `LocationTrackingService.resumeTracking()` (restores tracking if app was killed mid-task)
2. `index.tsx` checks `userToken`:
   - Token exists → redirect to `/(tabs)`
   - No token → redirect to `/login`

### Tab screens

| Tab | File | Purpose |
|-----|------|---------|
| Beranda | `(tabs)/index.tsx` | Task list with status filter, quick stats, active task banner. Auto-refreshes every 2 minutes when tasks are active. |
| Laporan | `(tabs)/laporan.tsx` | Reports grouped by assignment. Shows total reports, monthly/weekly counts. Calls `reportsAPI.getMyTasksWithReports()`. |
| Peta | `(tabs)/map.tsx` | Live map showing route from current position to active task destination using OSRM + Carto tiles. No active task → empty state. |
| Profil | `(tabs)/profile.tsx` | User info, edit name/phone/address, change password, upload avatar (camera/gallery, resized to 400×400 JPEG, base64 encoded), logout. |

### Stack screens (outside tabs)

| Route | File | Purpose |
|-------|------|---------|
| `/login` | `app/login.tsx` | Login form with email/password validation, remember-me (AsyncStorage), push token registration, socket init, spinner animation. |
| `/task-detail?taskId=<takenTaskId>` | `app/task-detail.tsx` | Full task detail: status, location, team members, swipeable start/complete buttons, countdown timer, location history. Triggers `LocationTrackingService.startTracking()` on start and `stopTracking()` on complete. |
| `/task-reports?takenTaskId=<id>` | `app/task-reports.tsx` | List of reports for an assignment. Navigates to `/report-detail`. |
| `/report-detail?reportId=<id>` | `app/report-detail.tsx` | Full report view with photos, report text editing, photo add/remove. |

### Report photo verification

- Report photos can only be added through the in-app camera; gallery selection is disabled.
- Each report accepts at most three photos. A photo is accepted only with foreground GPS permission, Android mock-location checks, GPS accuracy of 100 m or better, and a position within 100 m of the task coordinates.
- Capture time and GPS metadata are sent with each photo. The backend validates the task radius and burns a server timestamp, coordinates, and a local schematic mini-map into the photo and thumbnail.
- The schematic map is rendered locally by the backend and does not send coordinates to a map-tile provider.
- This is a deterrent, not proof against rooted devices or modified clients: GPS metadata and the mock-location flag are supplied by the device and can be forged.

---

## API Client (`services/api.ts`)

Single Axios instance configured with:
- `baseURL`: `API_BASE_URL` from `config/api.config.ts`
- `timeout`: 30 seconds
- `X-Client-Type: mobile` header
- Request interceptor: reads `userToken` from AsyncStorage, attaches `Authorization: Bearer <token>`
- Response interceptor: on 401 → clears `userToken`, `userEmail`, `user`, `pushToken` from AsyncStorage and throws `INVALID_TOKEN` code

### API groups

| Export | Base path | Functions |
|--------|-----------|-----------|
| `authAPI` | `/auth/*` | `login`, `logout`, `getCurrentUser`, `refreshToken`, `register`, `registerPushToken` |
| `tasksAPI` | `/my-tasks/*` | `getMyTasks`, `startTask`, `startTracking`, `completeTask`, `getMyStatistics`, `getTakenTaskDetail` |
| `locationsAPI` | `/locations/*` | `recordLocation`, `recordBatchLocations` (→ `/locations/bulk`), `getMyLocations`, `getTaskLocations`, `getTaskRoute`, `getLocationStatistics` |
| `profileAPI` | `/profile/*`, `/auth/me`, `/auth/change-password` | `getProfile`, `updateProfile`, `changePassword`, `uploadAvatar` |
| `reportsAPI` | `/reports/*` | `createReport`, `getMyReports`, `getTaskReports`, `getReportDetails`, `updateReport`, `getMyStatistics`, `getMyTasksWithReports`, `getReportsForTakenTask` |

### API mismatches and stubs

Several functions have graceful fallbacks or call unimplemented backend endpoints:

| Function | Backend route | Notes |
|----------|--------------|-------|
| `tasksAPI.startTracking()` | `PATCH /my-tasks/:id/start` | ❌ Not in backend. All status changes go through `PATCH /my-tasks/:id/status`. Use `startTask()` instead. |
| `locationsAPI.recordBatchLocations()` | `POST /locations/bulk` | ✅ Backend implemented (named `/bulk` not `/batch`) |
| `locationsAPI.getMyLocations()` | `GET /locations/my` | Returns empty array fallback |
| `locationsAPI.getTaskRoute()` | `GET /locations/tasks/:id/route` | Returns empty route fallback |
| `locationsAPI.getLocationStatistics()` | `GET /locations/my/statistics` | Returns zero-stats fallback |
| `authAPI.registerPushToken()` | `POST /auth/register-push-token` | ⚠️ Endpoint may not exist in backend |
| `profileAPI.changePassword()` | `POST /auth/change-password` | ⚠️ Verify route exists in backend |
| `reportsAPI.getMyTasksWithReports()` | `GET /reports/my-tasks` | ⚠️ Verify route exists in backend |
| `reportsAPI.getReportsForTakenTask()` | `GET /reports/tasks/:takenTaskId` | Same as employee route `GET /reports/tasks/:id` |

---

## Location Tracking (`services/locationTrackingRefactored.ts`)

`LocationTrackingService` is the single source of truth for GPS tracking.

### Architecture

```
TaskManager.defineTask('background-location-task')
    ↓ fires every 10 minutes (configurable)
    ↓ client-side throttle: MIN 9 min between records (skips if called sooner)
    ↓ mutex lock (isLocked) prevents concurrent execution
    ↓ reads session from AsyncStorage: user → active_task_{userId} → session key
    ↓ Location.getCurrentPositionAsync → reverseGeocodeAsync
    ↓ POST /locations (locationsAPI.recordLocation)
        → success: persist throttle timestamp
        → failure: enqueue to local persistent queue (capped at 288 records = 24h)
    ↓ runUploadWorker: drain any queued failed records
```

### AsyncStorage keys used

| Key | Value | Purpose |
|-----|-------|---------|
| `userToken` | JWT string | Auth token |
| `user` | JSON string | User object (id, name, etc.) |
| `active_task_{userId}` | taskId string | Pointer to current active task |
| `location_tracking_session_{userId}_{taskId}` | JSON TrackingSession | Session state |
| `location_queue_{userId}_{taskId}` | JSON LocationRecord[] | Failed upload queue (offline) |
| `location_last_record_time` | timestamp ms | Throttle guard |

### Public API

```typescript
LocationTrackingService.startTracking(takenTaskId, userId)   // Start GPS + foreground service
LocationTrackingService.stopTracking()                        // Stop GPS, clear session
LocationTrackingService.resumeTracking()                      // Called on app restart to resume
LocationTrackingService.getTrackingStatus()                   // Returns current TrackingSession or null
LocationTrackingService.heartbeat()                           // Called on socket reconnect to verify service alive
```

### Expo Go limitations

Background tracking does **not** work in Expo Go. The service detects `Constants.appOwnership === 'expo'` and skips the native location task while still saving the session so UI stays consistent.

| Mode | Foreground tracking | Background tracking |
|------|-------|-----|
| Expo Go | ✅ (app open) | ❌ |
| Development build | ✅ | ✅ |
| Production build | ✅ | ✅ |

To enable background tracking in a dev/production build, the `TaskManager.defineTask` block is already active — just build via EAS:

```bash
# Development build (for testing background)
eas build --profile development --platform android

# Production
eas build --profile production --platform android
```

---

## Socket.io (`services/socketService.ts`)

Connects to the same host as the API (URL minus `/api`). Authenticated with the same JWT token.

### Connection lifecycle
- `initializeSocket()` — called on app startup if token exists, and after login
- `reconnectSocket()` — called after login to establish fresh connection
- `disconnectSocket()` — called on app unmount

### Events listened to (server → client)

| Event | Action |
|-------|--------|
| `report:created` | Local push notification: team member submitted a report |
| `task:assigned` | Local push notification: new task assigned |
| `task:status_updated` | Local push notification (only on `completed`/`cancelled`) |
| `tracking:force_stop` | Calls `LocationTrackingService.stopTracking()` + notifies user |
| `admin:broadcast` | Local push notification: admin message |

### Events emitted (client → server)

| Event | When |
|-------|------|
| `user:join` | On connect (joins user-specific room) |
| `tracking:start` | After `LocationTrackingService.startTracking()` succeeds (via `emitTrackingStart()`) |
| `tracking:stop` | After `LocationTrackingService.stopTracking()` succeeds (via `emitTrackingStop()`) |

---

## Push Notifications (`services/notificationService.ts`)

Uses Expo Notifications (FCM on Android, APNs on iOS).

### Notification channels (Android)

| Channel ID | Importance | Sound | Use |
|-----------|-----------|------|-----|
| `default` | MAX | ✅ | General notifications |
| `location-tracking` | MAX | ❌ | Persistent tracking notification |
| `task-notifications` | HIGH | ✅ | New task assignments |

### Setup flow (called from `_layout.tsx`)

1. `registerForPushNotificationsAsync()` — sets up channels, requests permission, gets Expo push token, saves to AsyncStorage `pushToken`
2. After login → `registerPushTokenAfterLogin()` — sends token to `POST /auth/register-push-token`

### Notification tap navigation

Handled in `_layout.tsx`:
- `type: 'task_assignment'` + `takenTaskId` → `/task-detail?taskId=...`
- `type: 'report_created'` + `takenTaskId` → `/task-reports?takenTaskId=...`

---

## AsyncStorage Keys Reference

| Key | Set by | Read by | Purpose |
|-----|--------|---------|---------|
| `userToken` | `authAPI.login()` | All API requests | JWT auth token |
| `userEmail` | `authAPI.login()` | Login screen (remember me) | Cached email |
| `user` | `authAPI.login()`, `profileAPI.updateProfile()` | Home, Map, Monitoring | User object |
| `pushToken` | `notificationService.registerForPushNotificationsAsync()` | `registerPushTokenAfterLogin()` | FCM/APNs token |
| `pushTokenRegistered` | `registerPushTokenAfterLogin()` | `retryTokenRegistration()` | Backend reg flag |
| `rememberMe` | Login screen | Login screen | Remember me flag |
| `savedEmail` | Login screen | Login screen | Remembered email |
| `savedPassword` | Login screen | Login screen | ⚠️ Plaintext password stored (security concern) |
| `onboardingDone` | `StartingScreen` (first launch) | `_layout.tsx` | First-launch gate |
| `active_task_{userId}` | `LocationTrackingService` | `LocationTrackingService` | Active task pointer |
| `location_tracking_session_{userId}_{taskId}` | `LocationTrackingService` | `LocationTrackingService` | Tracking session |
| `location_queue_{userId}_{taskId}` | `LocationTrackingService` | `LocationTrackingService` | Offline queue |
| `location_last_record_time` | `LocationTrackingService` | `LocationTrackingService` | Throttle guard |

---

## Build & Distribution

### Development (Expo Go)

```bash
npm start
# Press 'a' / 'i' / scan QR
```

### Development build (enables background location)

```bash
eas build --profile development --platform android
# Install APK from EAS dashboard → open with Expo Dev Client
```

### Production build

```bash
eas build --profile production --platform android
eas build --profile production --platform ios
```

### Submit to stores

```bash
eas submit --platform android
eas submit --platform ios
```

---

## Troubleshooting

### "Network Error" / Cannot connect

1. Check `config/api.config.ts` — URL must match the running backend
2. For physical device on local dev: ensure device and machine are on same Wi-Fi
3. Test backend health: `GET http://YOUR_IP:8000/health`
4. Android emulator: use `10.0.2.2` instead of `localhost`

### Token / Auth issues

1. Shake device → "Clear Cache & Reload"
2. Or manually: AsyncStorage.clear() in dev console

### Location not recording

1. Grant **precise location** permission (not just approximate)
2. For background: ensure development/production build (not Expo Go)
3. Check `active_task_{userId}` exists in AsyncStorage

### Background tracking stops on some Android devices

- Some OEMs (Xiaomi, Huawei, Samsung) aggressively kill background services
- User needs to add app to battery whitelist: Settings → Battery → App Battery → C-Track → Unrestricted

### Push notifications not arriving

Run `verifyNotificationSetup()` from `notificationService.ts` to log a full diagnostic:
- Physical device required (not simulator)
- `extra.eas.projectId` must match production EAS project in `app.json`
- FCM credentials must be uploaded to Expo (`firebase-adminsdk-xxx.json`)
- `google-services.json` must have correct sender ID

---

## Known Issues / Security Notes

1. **Plaintext password in AsyncStorage**: The "Remember Me" feature saves the raw password to `AsyncStorage` under `savedPassword`. This is a security risk — passwords should never be stored in plaintext. Should be replaced with a refresh token mechanism.

2. **`tasksAPI.startTracking()` calls a non-existent endpoint** (`PATCH /my-tasks/:id/start`). The correct endpoint is `PATCH /my-tasks/:id/status`. If this function is called anywhere it will always fail with 404.

3. **`authAPI.registerPushToken()`** calls `POST /auth/register-push-token` — verify this endpoint exists in the backend before relying on push notifications.

4. **`reportsAPI.getMyTasksWithReports()`** calls `GET /reports/my-tasks` — verify this endpoint exists in the backend (it is used by the Laporan tab).

5. **Old API migration docs** (`API_MIGRATION_EXPRESS.md`, `MOBILE_API_DOCUMENTATION.md`) reference port 5000 and are outdated. The current backend runs on port 8000 locally and is deployed at `ctrack.wikolabs.biz.id`.
