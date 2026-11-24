import * as TaskManager from 'expo-task-manager';
import * as Location from 'expo-location';
import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { AppState } from 'react-native';
import { locationsAPI } from './api';

/**
 * Detects current app state for logging purposes.
 * - 'foreground' : app terbuka dan aktif di layar
 * - 'background' : app diminimize (masih hidup di background)
 * - 'killed'     : app dimatikan, task berjalan di headless JS (AppState = 'unknown')
 */
function getAppStateLabel(): string {
  const state = AppState.currentState;
  if (state === 'active') return '🟢 FOREGROUND';
  if (state === 'background') return '🟡 BACKGROUND';
  return '🔴 KILLED/HEADLESS'; // 'unknown' = headless JS context (app killed)
}

/** Returns true when running inside Expo Go — background location is not supported there */
const isExpoGo = Constants.appOwnership === 'expo';

/**
 * Simple UUID v4 generator that works in background tasks
 * Generates standard 36-char UUID format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
 * Does NOT rely on crypto.getRandomValues()
 */
function generateUUID(): string {
  // Generate random hex strings of specific lengths
  const part1 = Math.random().toString(16).substring(2, 10).padEnd(8, '0'); // 8 chars
  const part2 = Math.random().toString(16).substring(2, 6).padEnd(4, '0');  // 4 chars
  const part3 = Math.random().toString(16).substring(2, 6).padEnd(4, '0');  // 4 chars
  const part4 = Math.random().toString(16).substring(2, 6).padEnd(4, '0');  // 4 chars
  const part5 = Math.random().toString(16).substring(2, 14).padEnd(12, '0'); // 12 chars
  
  // Format: xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx (36 chars total)
  return `${part1}-${part2}-${part3}-${part4}-${part5}`;
}

/**
 * Clean Location Tracking Service - Production Ready
 * 
 * TRANSPORT LAYER: REST API (stateless, no persistent connections)
 * ================================================================
 * 
 * ARCHITECTURE:
 * - Background task only (NO setInterval, NO Socket.IO)
 * - Records location every 10 minutes via GPS sensor
 * - Sends each record via REST POST /locations (stateless HTTP)
 * - Queue-based delivery for offline resilience
 * - Exponential backoff retry with jitter (no thundering herd)
 * - Reverse geocoding for address information
 * - Client-side UUID for idempotency (deduplication at server)
 * - Mutex lock prevents concurrent writes
 * - Minimal API calls (one per 10-minute interval)
 * - Battery efficient: no persistent WebSocket, only POST on data
 * 
 * TRANSPORT PROPERTIES:
 * - Each location update is a stateless HTTP request
 * - No persistent connection = survives device Doze/battery saver
 * - Queue persists across app kills (AsyncStorage)
 * - Retry worker drains queue when connectivity returns
 * - Full offline support with local queue (288 items = 24h)
 */

// ============================================
// CONSTANTS
// ============================================

const LOCATION_TRACKING_TASK = 'background-location-task';

// Session key is now scoped per userId+taskId to support multi-user tracking
const SESSION_KEY_PREFIX = 'location_tracking_session';
const QUEUE_KEY_PREFIX = 'location_queue';

// Single flat key — survives app kills, lets UI restore isTracking instantly on mount
const TRACKING_STATE_KEY = 'c_track_active_tracking';

export interface PersistedTrackingState {
  isTracking: boolean;
  takenTaskId: string;
  userId: string;
  startedAt: number;
}

/** Read the persisted tracking state without needing a userId. Returns null if not tracking. */
export async function getPersistedTrackingState(): Promise<PersistedTrackingState | null> {
  try {
    const raw = await AsyncStorage.getItem(TRACKING_STATE_KEY);
    if (!raw) return null;
    const state: PersistedTrackingState = JSON.parse(raw);
    return state.isTracking ? state : null;
  } catch {
    return null;
  }
}

/** Composite storage key scoped to one user+task combination */
function sessionKey(userId: string, taskId: string): string {
  return `${SESSION_KEY_PREFIX}_${userId}_${taskId}`;
}

/**
 * Used by background task to find the current user's active session.
 * Reads the 'user' object and 'active_task_{userId}' pointer from storage.
 */
async function getActiveSessionKey(): Promise<string | null> {
  const userJson = await AsyncStorage.getItem('user');
  if (!userJson) return null;
  const user = JSON.parse(userJson);
  const taskId = await AsyncStorage.getItem(`active_task_${user.id}`);
  if (!taskId) return null;
  return sessionKey(user.id, taskId);
}

// Mutex lock - prevents concurrent write operations
let isLocked = false;

// ============================================
// TYPES
// ============================================

interface LocationRecord {
  id: string;
  takenTaskId: string;
  userId: string;
  latitude?: number | null;
  longitude?: number | null;
  accuracy?: number;
  address?: string;
  recordedAt: number; // device timestamp (ms)
  recordType?: 'location' | 'heartbeat'; // 'location' for GPS data, 'heartbeat' for activity signal
}

interface TrackingSession {
  taskId: string;
  userId: string;
  startedAt: number;
  lastRecordedAt: number;
}

/** Extended session type that includes reliability metadata */
interface UserTrackingSession extends TrackingSession {
  sessionKey: string;           // composite key used in AsyncStorage
  lastHeartbeatAt?: number;     // updated by heartbeat()
  pendingQueueLength?: number;  // informational, updated by UploadWorker
}

// Throttle mechanism - prevents rapid recording if expo-location fires too fast
// Persisted to AsyncStorage so it survives app kills and headless task restarts
const LAST_RECORD_TIME_KEY = 'location_last_record_time';
const MIN_RECORD_INTERVAL_MS = 9 * 60 * 1000; // 9 minutes minimum between records (10 min target - 1 min buffer)

// Canonical foreground service notification config used in ALL startLocationUpdatesAsync calls
const FOREGROUND_SERVICE_OPTIONS = {
  accuracy: Location.Accuracy.Balanced,
  timeInterval: 10 * 60 * 1000,
  distanceInterval: 0,
  foregroundService: {
    notificationTitle: '📍 C-Track Tracking Aktif',
    notificationBody: 'Lokasi dicatat otomatis dicatat berkala',
    notificationColor: '#3B82F6',
    killServiceOnDestroy: false, // keep alive even when app is killed
  },
};

// ============================================
// BACKGROUND TASK DEFINITION
// ============================================

/**
 * Define background task once when service is imported
 * This runs every 10 minutes and records a location
 * 
 * NOTE: We add client-side throttling because expo-location on some devices
 * triggers the background task more frequently than timeInterval specifies.
 */
TaskManager.defineTask(LOCATION_TRACKING_TASK, async () => {
  try {
    const appStateLabel = getAppStateLabel();
    const timestamp = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    console.log(`\n========================================`);
    console.log(`📍 [INTERVAL TRACKING] ${timestamp}`);
    console.log(`📱 Kondisi HP saat ini : ${appStateLabel}`);
    console.log(`========================================`);
    
    // Client-side throttle: skip if recorded too recently
    // Read from AsyncStorage so it persists across app kills and headless JS restarts
    const now = Date.now();
    const storedRecordTime = await AsyncStorage.getItem(LAST_RECORD_TIME_KEY);
    const lastRecordTime = storedRecordTime ? parseInt(storedRecordTime, 10) : 0;
    const timeSinceLastRecord = now - lastRecordTime;
    if (timeSinceLastRecord < MIN_RECORD_INTERVAL_MS) {
      console.log(`⏳ Throttled: Only ${Math.round(timeSinceLastRecord / 1000)}s since last record (need ${Math.round(MIN_RECORD_INTERVAL_MS / 1000)}s)`);
      return;
    }
    
    // Prevent concurrent execution
    if (isLocked) {
      console.log('📍 Background task: Lock active, skipping cycle');
      return;
    }

    isLocked = true;

    // Get current tracking session (composite key: userId + taskId)
    const activeKey = await getActiveSessionKey();
    if (!activeKey) {
      console.log('📍 Background task: No active session key found');
      isLocked = false;
      return;
    }
    const sessionJson = await AsyncStorage.getItem(activeKey);
    if (!sessionJson) {
      console.log('📍 Background task: No active tracking session');
      // Don't stop the task here - it might be re-registered
      isLocked = false;
      return;
    }

    const session: TrackingSession = JSON.parse(sessionJson);
    console.log(`📍 Background task: Found session for task ${session.taskId}`);

    // Get user ID from storage (independent of in-memory state)
    const userJson = await AsyncStorage.getItem('user');
    if (!userJson) {
      console.warn('⚠️  Background task: User data missing, cannot record location');
      isLocked = false;
      return;
    }

    const user = JSON.parse(userJson);
    const userId = user.id;

    // Get token (for API call)
    const token = await AsyncStorage.getItem('userToken');
    if (!token) {
      console.warn('⚠️  Background task: No auth token, cannot record location');
      isLocked = false;
      return;
    }

    // Record location — enforce a hard timeout so the background task never hangs
    // indefinitely waiting for a GPS fix (Android gives background tasks a limited
    // execution window; exceeding it causes the OS to kill the task silently).
    const LOCATION_TIMEOUT_MS = 30000; // 30 seconds — gives low-end / old GPS chipsets time to lock
    let location: Location.LocationObject | null = null;
    try {
      location = await Promise.race([
        Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error('getCurrentPositionAsync timed out after 12s')), LOCATION_TIMEOUT_MS)
        ),
      ]);
    } catch (locTimeoutErr: any) {
      console.warn('⚠️  Background task: Location timed out or failed:', locTimeoutErr.message);
      
      // Create heartbeat record instead of silently failing
      // This ensures the server knows the device is still alive and tracking, just no GPS data
      const heartbeatRecord: LocationRecord = {
        id: generateUUID(),
        takenTaskId: session.taskId,
        userId,
        latitude: null,
        longitude: null,
        accuracy: 0,
        recordedAt: Date.now(),
        recordType: 'heartbeat',
      };

      console.log('💓 Creating heartbeat record due to GPS timeout/failure');

      // Try to send heartbeat immediately (same as normal location)
      try {
        await locationsAPI.recordLocation(
          heartbeatRecord.takenTaskId,
          heartbeatRecord.latitude,
          heartbeatRecord.longitude,
          heartbeatRecord.accuracy,
          heartbeatRecord.address,
          heartbeatRecord.recordedAt,
          heartbeatRecord.id,
          heartbeatRecord.recordType, // pass recordType so server knows this is heartbeat
        );
        console.log('✅ Heartbeat sent successfully');
        // Drain queue after successful heartbeat
        await runUploadWorker(userId, session.taskId);
      } catch (heartbeatError: any) {
        console.error('❌ Failed to send heartbeat via REST POST /locations:', heartbeatError.message);
        // Queue heartbeat for later retry using the same system
        await enqueueRecord(heartbeatRecord);
      }

      isLocked = false;
      return;
    }

    if (!location) {
      console.warn('⚠️  Background task: Could not get current location');
      
      // Create heartbeat record for null location (similar to timeout)
      const heartbeatRecord: LocationRecord = {
        id: generateUUID(),
        takenTaskId: session.taskId,
        userId,
        latitude: null,
        longitude: null,
        accuracy: 0,
        recordedAt: Date.now(),
        recordType: 'heartbeat',
      };

      console.log('💓 Creating heartbeat record due to null location');

      try {
        await locationsAPI.recordLocation(
          heartbeatRecord.takenTaskId,
          heartbeatRecord.latitude,
          heartbeatRecord.longitude,
          heartbeatRecord.accuracy,
          heartbeatRecord.address,
          heartbeatRecord.recordedAt,
          heartbeatRecord.id,
          heartbeatRecord.recordType,
        );
        console.log('✅ Heartbeat sent successfully');
        await runUploadWorker(userId, session.taskId);
      } catch (heartbeatError: any) {
        console.error('❌ Failed to send heartbeat:', heartbeatError.message);
        await enqueueRecord(heartbeatRecord);
      }

      isLocked = false;
      return;
    }

    const { latitude, longitude } = location.coords;
    const accuracy = location.coords.accuracy || 0;

    // Reverse geocoding on device (reliable, uses built-in Google/Apple geocoding)
    let address = '';
    try {
      const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
      if (geocode && geocode.length > 0) {
        const g = geocode[0];
        address = [g.street, g.district, g.city, g.region].filter(Boolean).join(', ');
      }
    } catch (geoErr) {
      console.warn('⚠️  Reverse geocoding failed:', geoErr);
    }

    // Create record with UUID (client-side idempotency)
    const record: LocationRecord = {
      id: generateUUID(),
      takenTaskId: session.taskId,
      userId,
      latitude,
      longitude,
      accuracy,
      address,
      recordedAt: Date.now(),
      recordType: 'location', // Explicit marker for GPS location record
    };

    console.log(`✓ Background task recorded location: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}, address="${address || '(none)'}"`)

    // Persist throttle time NOW — immediately after the GPS snapshot is captured.
    // This ensures the 10-minute cycle stays consistent regardless of whether the
    // subsequent API call succeeds or fails. If the API fails the record is queued
    // for retry, but we still move the window forward so two consecutive background
    // task fires cannot both snapshot GPS within the same 9-minute window.
    await AsyncStorage.setItem(LAST_RECORD_TIME_KEY, Date.now().toString());
    console.log('✅ Throttle time persisted after GPS capture');

    // Send record immediately to API (no batching)
    try {
      // REST API: POST /locations (stateless HTTP request)
      // Each request includes:
      // - record.id: client UUID for idempotency (server deduplicates by this)
      // - record.takenTaskId: task reference
      // - record.latitude/longitude: coordinates (or null for heartbeat)
      // - record.accuracy: GPS accuracy in meters
      // - record.address: reverse geocoded address
      // - record.recordedAt: device timestamp (milliseconds)
      // - record.recordType: 'location' for GPS data, 'heartbeat' for activity signal
      // 
      // This is NOT a persistent connection (unlike Socket.IO).
      // Each POST is a stateless HTTP request that:
      // 1. Survives device Doze/battery saver (no ongoing TCP connection)
      // 2. Works offline (failed requests queued for retry)
      // 3. Uses exponential backoff with jitter on retry
      // 4. Server handles idempotency via client UUID
      await locationsAPI.recordLocation(
        record.takenTaskId,
        record.latitude,
        record.longitude,
        record.accuracy,
        record.address,
        record.recordedAt, // preserve actual capture time so server stores correct timestamp
        record.id,         // client UUID — server upserts so retries never create duplicates
        record.recordType, // marker field: 'location' or 'heartbeat'
      );

      // Log sukses — tampilkan mode HP saat pencatatan berhasil
      const successState = getAppStateLabel();
      if (AppState.currentState === 'active') {
        console.log(`✅ [REST POST /locations] Lokasi dicatat saat HP di FOREGROUND`);
      } else if (AppState.currentState === 'background') {
        console.log(`✅ [REST POST /locations] Lokasi dicatat saat app di BACKGROUND`);
        console.log(`   📌 Koordinat : ${record.latitude && record.longitude ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}` : '(tidak tersedia)'}`);
        console.log(`   🏠 Alamat    : ${record.address || '(tidak tersedia)'}`);
        console.log(`   ⏱️  Waktu     : ${new Date(record.recordedAt).toLocaleTimeString('id-ID')}`);
      } else {
        console.log(`✅ [REST POST /locations] Lokasi dicatat saat app KILLED/HEADLESS`);
        console.log(`   📌 Koordinat : ${record.latitude && record.longitude ? `${record.latitude.toFixed(6)}, ${record.longitude.toFixed(6)}` : '(tidak tersedia)'}`);
        console.log(`   🏠 Alamat    : ${record.address || '(tidak tersedia)'}`);
        console.log(`   ⏱️  Waktu     : ${new Date(record.recordedAt).toLocaleTimeString('id-ID')}`);
      }
      console.log(`   Mode saat sukses: ${successState}`);

      // Drain any queued records now that connectivity is confirmed
      await runUploadWorker(userId, session.taskId);
    } catch (apiError: any) {
      console.error('❌ Failed to send location via REST POST /locations:', apiError.message);
      // Queue record for later retry instead of dropping it
      await enqueueRecord(record);
    }

    isLocked = false;
  } catch (error) {
    console.error('❌ Background task error:', error);
    isLocked = false;
  }
});

// ============================================
// INTERNAL HELPERS
// ============================================

/**
 * Helper: Acquire mutex lock (wait for availability)
 */
async function acquireLock(timeout: number = 5000): Promise<boolean> {
  const startTime = Date.now();
  while (isLocked) {
    if (Date.now() - startTime > timeout) {
      console.warn('⚠️  Could not acquire lock within timeout');
      return false;
    }
    await new Promise((resolve) => setTimeout(resolve, 100)); // yield
  }
  isLocked = true;
  return true;
}

/**
 * Release mutex lock
 */
function releaseLock(): void {
  isLocked = false;
}

// ============================================
// LOCAL QUEUE HELPERS
// ============================================

function queueKey(userId: string, taskId: string): string {
  return `${QUEUE_KEY_PREFIX}_${userId}_${taskId}`;
}

/** Push a failed record onto the persistent local queue (capped at 288 items = 24h) */
async function enqueueRecord(record: LocationRecord): Promise<void> {
  const key = queueKey(record.userId, record.takenTaskId);
  try {
    const raw = await AsyncStorage.getItem(key);
    const queue: LocationRecord[] = raw ? JSON.parse(raw) : [];
    queue.push(record);
    const capped = queue.slice(-288); // cap to 24h of 5-min records
    await AsyncStorage.setItem(key, JSON.stringify(capped));
    console.log(`📦 Queued failed record (queue length: ${capped.length})`);
  } catch (e) {
    console.error('❌ Failed to enqueue record:', e);
  }
}

/** Pop the oldest record from the queue. Returns null if empty. */
async function dequeueRecord(userId: string, taskId: string): Promise<LocationRecord | null> {
  const key = queueKey(userId, taskId);
  try {
    const raw = await AsyncStorage.getItem(key);
    if (!raw) return null;
    const queue: LocationRecord[] = JSON.parse(raw);
    if (queue.length === 0) return null;
    const [head, ...rest] = queue;
    await AsyncStorage.setItem(key, JSON.stringify(rest));
    return head;
  } catch (e) {
    console.error('❌ Failed to dequeue record:', e);
    return null;
  }
}

/** Return current queue depth without modifying it */
async function getQueueLength(userId: string, taskId: string): Promise<number> {
  const key = queueKey(userId, taskId);
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? JSON.parse(raw).length : 0;
  } catch { return 0; }
}

// ============================================
// UPLOAD WORKER - REST API BASED DELIVERY
// ============================================

/** Re-entrancy guard: only one drain loop runs at a time */
let isUploadWorkerRunning = false;

/**
 * Classifies API errors into categories for smart retry decisions
 * 
 * ERROR CATEGORIES:
 * - TRANSIENT: Network timeout, 429 (rate limit), 503 (service unavailable) → RETRY
 * - PERMANENT: 400 (bad request), 401 (auth), 404 (not found) → ABANDON (don't retry)
 * - UNKNOWN: Anything else → RETRY (assume transient for resilience)
 */
function classifyApiError(error: any): 'transient' | 'permanent' {
  const status = error.response?.status;
  const message = error.message?.toLowerCase() || '';

  // Permanent errors — no point retrying
  if (status === 400 || status === 401 || status === 403 || status === 404) {
    console.warn(`⚠️  Permanent error (${status}): ${error.message}`);
    return 'permanent';
  }

  // Transient errors — retry with backoff
  if (status === 429 || status === 503 || status === 502) {
    console.warn(`⚠️  Transient error (${status}): rate limit or service unavailable`);
    return 'transient';
  }

  // Network timeouts, ECONNREFUSED, ECONNRESET, etc.
  if (message.includes('timeout') || message.includes('econnrefused') || 
      message.includes('econnreset') || message.includes('enotfound')) {
    console.warn(`⚠️  Network error: ${error.message}`);
    return 'transient';
  }

  // Unknown — assume transient and retry (better to over-retry than lose data)
  console.warn(`⚠️  Unknown error, retrying: ${error.message}`);
  return 'transient';
}

/**
 * REST API Upload Worker
 * 
 * Drains the local offline queue by sending each location record via HTTP POST.
 * 
 * BEHAVIOR:
 * 1. Dequeue records FIFO (oldest first = preserves chronological order)
 * 2. For each record: attempt up to 3 times with exponential backoff + jitter
 * 3. On transient error: backoff & retry (1s, 3s, 6s with jitter)
 * 4. On permanent error: log & skip (don't re-enqueue)
 * 5. On success: continue to next record
 * 6. Stop immediately if all retries exhaust (network still down)
 * 
 * IDEMPOTENCY:
 * - Each record has a client UUID (record.id)
 * - Server upserts by this UUID → retries are safe (no duplicates)
 * - If request succeeds but mobile doesn't get response (timeout), server already stored it
 * 
 * CALL CONTEXT:
 * - After successful API send (from background task)
 * - On app resume (from resumeTracking)
 * - Periodically when connectivity detected (future: network listener)
 */
async function runUploadWorker(userId: string, taskId: string): Promise<void> {
  // Prevent concurrent drains (only one worker at a time)
  if (isUploadWorkerRunning) {
    console.log('ℹ️  UploadWorker already running, skipping duplicate');
    return;
  }
  isUploadWorkerRunning = true;

  const workerStartTime = Date.now();
  let queueLength = await getQueueLength(userId, taskId);
  console.log(`🔄 UploadWorker START: ${queueLength} records waiting`);

  try {
    let record = await dequeueRecord(userId, taskId);
    let successCount = 0;
    let skipCount = 0;

    while (record) {
      let uploaded = false;

      // Retry loop with exponential backoff + jitter
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          // REST API: POST /locations (stateless HTTP request, no persistent connection)
          // Supports both location records (with GPS data) and heartbeat records (activity signal)
          await locationsAPI.recordLocation(
            record.takenTaskId,
            record.latitude,
            record.longitude,
            record.accuracy,
            record.address,
            record.recordedAt, // preserve device timestamp for accuracy
            record.id,         // client UUID enables server-side deduplication
            record.recordType, // 'location' or 'heartbeat' — server handles differently
          );

          uploaded = true;
          successCount++;
          const recordTypeLabel = record.recordType === 'heartbeat' ? '💓 heartbeat' : '📍 location';
          console.log(
            `✅ UploadWorker: REST POST /locations sent ${recordTypeLabel} record ${record.id} ` +
            `(attempt ${attempt + 1}) [${successCount}/${queueLength}]`
          );
          break;
        } catch (error: any) {
          const errorClass = classifyApiError(error);

          if (errorClass === 'permanent') {
            // Don't retry — log and move on
            console.error(
              `❌ UploadWorker: Permanent error (${error.response?.status}), ` +
              `abandoning record ${record.id}: ${error.message}`
            );
            skipCount++;
            uploaded = true; // Mark uploaded to skip re-enqueue and move to next
            break;
          }

          // Transient error — retry with backoff
          if (attempt < 2) {
            // Exponential backoff with jitter to prevent thundering herd
            // Attempt 0→1: 1s + jitter (500ms-1500ms) = 1500ms-2500ms
            // Attempt 1→2: 3s + jitter (1s-3s) = 4s-6s
            const baseBackoffMs = [1000, 3000][attempt];
            const jitterMs = Math.random() * baseBackoffMs;
            const totalBackoffMs = baseBackoffMs + jitterMs;

            console.warn(
              `⚠️  UploadWorker: Transient error (${error.response?.status || 'network'}), ` +
              `attempt ${attempt + 1} failed. Backing off ${Math.round(totalBackoffMs)}ms before retry: ${error.message}`
            );

            await new Promise(resolve => setTimeout(resolve, totalBackoffMs));
          } else {
            // Final attempt failed
            console.warn(
              `⚠️  UploadWorker: attempt ${attempt + 1}/3 failed, no more retries for this record`
            );
          }
        }
      }

      if (!uploaded) {
        // All 3 retries exhausted — network is down, stop draining
        console.warn(
          `❌ UploadWorker: Record ${record.id} failed all retries, ` +
          `re-enqueueing at front of queue and pausing drain`
        );

        // Re-insert failed record at the front (so it's retried next time)
        const key = queueKey(userId, taskId);
        const raw = await AsyncStorage.getItem(key);
        const rest: LocationRecord[] = raw ? JSON.parse(raw) : [];
        await AsyncStorage.setItem(key, JSON.stringify([record, ...rest]));

        break; // Stop — assume network is still down, don't drain remaining queue
      }

      // Move to next record in queue
      record = await dequeueRecord(userId, taskId);
    }

    const elapsedMs = Date.now() - workerStartTime;
    const remainingQueue = await getQueueLength(userId, taskId);
    console.log(
      `🔄 UploadWorker COMPLETE: ✅ sent=${successCount}, ❌ skipped=${skipCount}, ` +
      `⏳ remaining=${remainingQueue}, took ${elapsedMs}ms`
    );
  } catch (error) {
    console.error('❌ UploadWorker fatal error:', error);
  } finally {
    isUploadWorkerRunning = false;
  }
}

// ============================================
// PUBLIC API
// ============================================

export const LocationTrackingService = {
  /**
   * Start tracking location for a task
   * Call this when user clicks "Start Task"
   * 
   * This now includes:
   * 1. Immediate location recording (sends initial log right away)
   * 2. Background task setup for continuous 10-minute interval tracking
   */
  async startTracking(takenTaskId: string, userId: string): Promise<boolean> {
    try {
      console.log(`🔍 startTracking called for task: ${takenTaskId}`);

      if (isExpoGo) {
        console.warn('⚠️  Expo Go detected — background location not supported. Session saved, foreground service skipped.');
        // Still save the session so the UI reflects in_progress state
        const key = sessionKey(userId, takenTaskId);
        const session: TrackingSession = { taskId: takenTaskId, userId, startedAt: Date.now(), lastRecordedAt: Date.now() };
        await AsyncStorage.setItem(key, JSON.stringify(session));
        await AsyncStorage.setItem(`active_task_${userId}`, takenTaskId);
        return true;
      }
      
      // Acquire lock to prevent duplicate starts
      if (!(await acquireLock(2000))) {
        console.warn('⚠️  Could not acquire lock to start tracking');
        return false;
      }

      // Check if already tracking this exact user+task combination
      const key = sessionKey(userId, takenTaskId);
      const existingSession = await AsyncStorage.getItem(key);
      if (existingSession) {
        const session: TrackingSession = JSON.parse(existingSession);
        // Guard on BOTH userId AND taskId — fixes multi-user initialization bug
        if (session.taskId === takenTaskId && session.userId === userId) {
          console.log('✅ Already tracking this user+task combo, skipping restart');
          releaseLock();
          return true;
        }
        // Stale entry - stop old one first
        console.log(`⚠️  Stale session detected, stopping old tracking for ${session.taskId}`);
        await LocationTrackingService.stopTracking();
      }

      // Request location permissions
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        console.error('❌ Location permission denied');
        releaseLock();
        return false;
      }

      // Request background permission (iOS 11+)
      const bgStatus = await Location.requestBackgroundPermissionsAsync();
      if (bgStatus.status !== 'granted') {
        console.warn('⚠️  Background location permission not granted (may affect background tracking)');
        // Continue anyway - foreground permission is minimum
      }

      // Create session
      const session: TrackingSession = {
        taskId: takenTaskId,
        userId,
        startedAt: Date.now(),
        lastRecordedAt: Date.now(),
      };

      // Save session under composite key (survives app restart)
      // Also save active_task pointer so background task can look up session
      await AsyncStorage.setItem(key, JSON.stringify(session));
      await AsyncStorage.setItem(`active_task_${userId}`, takenTaskId);
      
      // Pre-set throttle to NOW before starting the background task.
      // If we removed the key (throttle = 0), the OS could fire the background task
      // immediately after startLocationUpdatesAsync and it would record a location
      // in parallel with the manual initial recording below — causing a duplicate log.
      // The correct throttle timestamp will be overwritten after the GPS snapshot.
      await AsyncStorage.setItem(LAST_RECORD_TIME_KEY, Date.now().toString());
      console.log('🟢 Throttle pre-set to block background task race on start');

      // Check if already running before starting
      const isAlreadyRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      console.log(`📍 Background task already running? ${isAlreadyRunning}`);

      // Start foreground service + background location tracking (10-minute interval)
      // The foregroundService config creates the NON-DISMISSIBLE system notification
      // automatically. No need for a separate scheduleNotificationAsync call.
      if (!isAlreadyRunning) {
        console.log('🚀 Starting location foreground service...');
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, FOREGROUND_SERVICE_OPTIONS);
        console.log('✅ Location foreground service started (non-dismissible notification shown)');
      } else {
        console.log('ℹ️  Background task already running, skipping start');
      }

      // ✨ NEW: Record initial location immediately (sends first log right away)
      console.log('📍 Recording initial location immediately...');
      try {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });

        if (location) {
          const { latitude, longitude } = location.coords;
          const accuracy = location.coords.accuracy || 0;

          // Reverse geocoding on device for initial location
          let initialAddress = '';
          try {
            const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (geocode && geocode.length > 0) {
              const g = geocode[0];
              initialAddress = [g.street, g.district, g.city, g.region].filter(Boolean).join(', ');
            }
          } catch (geoErr) {
            console.warn('⚠️  Reverse geocoding failed for initial location:', geoErr);
          }

          // Send initial location to API via REST
          // Generate UUID and capture timestamp BEFORE the try so the catch
          // reuses the same values — prevents a second generateUUID() creating
          // a different ID that would produce a duplicate row on the server.
          const initialId = generateUUID();
          const initialRecordedAt = Date.now();
          try {
            // REST API: POST /locations (stateless HTTP, idempotent via UUID)
            await locationsAPI.recordLocation(
              takenTaskId,
              latitude,
              longitude,
              accuracy,
              initialAddress || undefined,
              initialRecordedAt, // device timestamp
              initialId,         // client UUID for server-side deduplication
              'location',        // explicit record type for GPS data
            );
            console.log(`✅ Initial location recorded via REST POST: address="${initialAddress || '(none)'}"`);
            // Persist throttle time so background task doesn't double-record on first fire
            await AsyncStorage.setItem(LAST_RECORD_TIME_KEY, Date.now().toString());
          } catch (apiErr: any) {
            console.error('❌ Failed to send initial location via REST POST /locations:', apiErr.message);
            // Queue the record for retry using the SAME initialId so if the
            // API call actually succeeded (e.g. timeout/network issue) the server upsert
            // will ignore the duplicate instead of creating a new row.
            await enqueueRecord({
              id: initialId,
              takenTaskId,
              userId,
              latitude,
              longitude,
              accuracy,
              address: initialAddress || undefined,
              recordedAt: initialRecordedAt, // same timestamp as original attempt
              recordType: 'location',
            });
          }
        } else {
          console.warn('⚠️  Could not get initial location');
        }
      } catch (locErr: any) {
        console.error('❌ Error getting initial location:', locErr.message);
        // Don't fail the entire tracking start
      }

      // Persist flat tracking state so UI can restore isTracking on app reopen
      await AsyncStorage.setItem(TRACKING_STATE_KEY, JSON.stringify({
        isTracking: true,
        takenTaskId,
        userId,
        startedAt: Date.now(),
      } satisfies PersistedTrackingState));

      console.log(`🔒 Location tracking started for task: ${takenTaskId}`);
      releaseLock();
      return true;
    } catch (error) {
      console.error('❌ Error starting tracking:', error);
      releaseLock();
      return false;
    }
  },

  /**
   * Stop tracking location
   * Call this when user completes or cancels task
   */
  async stopTracking(): Promise<void> {
    try {
      if (!(await acquireLock(2000))) {
        console.warn('⚠️  Could not acquire lock to stop tracking');
        return;
      }

      // Stop background task
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      if (isRunning) {
        await Location.stopLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      }

      // Clear composite session key, active task pointer, and throttle state
      const stopUserJson = await AsyncStorage.getItem('user');
      if (stopUserJson) {
        const stopUser = JSON.parse(stopUserJson);
        const stopTaskId = await AsyncStorage.getItem(`active_task_${stopUser.id}`);
        if (stopTaskId) {
          await AsyncStorage.removeItem(sessionKey(stopUser.id, stopTaskId));
          await AsyncStorage.removeItem(`active_task_${stopUser.id}`);
        }
      }
      // Clear throttle state (foreground service stops its own notification automatically)
      await AsyncStorage.removeItem(LAST_RECORD_TIME_KEY);
      // Clear persisted UI state
      await AsyncStorage.removeItem(TRACKING_STATE_KEY);

      console.log('🛑 Location tracking stopped');
      releaseLock();
    } catch (error) {
      console.error('❌ Error stopping tracking:', error);
      releaseLock();
    }
  },

  /**
   * Resume tracking if app was killed and restarted
   * Call this on app startup if there's a pending session
   */
  async resumeTracking(): Promise<boolean> {
    try {
      if (isExpoGo) {
        console.warn('⚠️  Expo Go — resumeTracking skipped (background location not supported)');
        return false;
      }
      if (!(await acquireLock(2000))) {
        console.warn('⚠️  Could not acquire lock to resume tracking');
        return false;
      }

      const resumeKey = await getActiveSessionKey();
      const sessionJson = resumeKey ? await AsyncStorage.getItem(resumeKey) : null;
      if (!sessionJson) {
        console.log('📍 No active session to resume');
        releaseLock();
        return false;
      }

      const session: TrackingSession = JSON.parse(sessionJson);
      console.log(`📍 Found session: taskId=${session.taskId}, userId=${session.userId}`);

      // Restart background task
      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      console.log(`📍 Background task running? ${isRunning}`);
      
      if (!isRunning) {
        console.log('🔄 Restarting location foreground service...');
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, FOREGROUND_SERVICE_OPTIONS);
        console.log('✅ Location foreground service restarted');
      } else {
        console.log('ℹ️  Background task already running on resume, skipping restart');
      }

      // Guard: skip immediate recording if a location was captured recently.
      // This prevents duplicates when both _layout.tsx and task-detail.tsx call resumeTracking()
      // within seconds of each other, or when startTracking() just recorded the initial log.
      const storedResumeTime = await AsyncStorage.getItem(LAST_RECORD_TIME_KEY);
      const lastResumeTime = storedResumeTime ? parseInt(storedResumeTime, 10) : 0;
      const timeSinceResumeRecord = Date.now() - lastResumeTime;

      if (timeSinceResumeRecord < MIN_RECORD_INTERVAL_MS) {
        console.log(`⏳ resumeTracking: skipping immediate record — last record was ${Math.round(timeSinceResumeRecord / 1000)}s ago`);
      } else {
      // Reset throttle so an immediate location can be recorded right after resume.
      // Without this the background task may skip the first fire because LAST_RECORD_TIME_KEY
      // still holds the timestamp from BEFORE the app was killed.
      await AsyncStorage.removeItem(LAST_RECORD_TIME_KEY);
      console.log('🟢 Throttle reset on resume');

      // Record an immediate location to fill the gap created by the kill/restart.
      // startTracking() already does this for fresh sessions; resumeTracking() must too.
      console.log('📍 Recording resume location immediately...');
      try {
        const resumeLocation = await Promise.race([
          Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }),
          new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Resume location timed out')), 12000)
          ),
        ]);

        if (resumeLocation) {
          const { latitude, longitude } = resumeLocation.coords;
          const accuracy = resumeLocation.coords.accuracy || 0;
          const resumeRecordedAt = Date.now();

          let resumeAddress = '';
          try {
            const geocode = await Location.reverseGeocodeAsync({ latitude, longitude });
            if (geocode && geocode.length > 0) {
              const g = geocode[0];
              resumeAddress = [g.street, g.district, g.city, g.region].filter(Boolean).join(', ');
            }
          } catch (geoErr) {
            console.warn('⚠️  Resume: reverse geocoding failed:', geoErr);
          }

          try {
            // REST API: POST /locations (stateless HTTP, idempotent via UUID)
            const resumeId = generateUUID();
            await locationsAPI.recordLocation(
              session.taskId,
              latitude,
              longitude,
              accuracy,
              resumeAddress || undefined,
              resumeRecordedAt,
              resumeId,  // client UUID for deduplication
              'location', // explicit record type for GPS data
            );
            console.log(`✅ Resume location recorded via REST POST: ${latitude.toFixed(6)}, ${longitude.toFixed(6)}`);
            // Persist throttle so background task doesn't double-record immediately
            await AsyncStorage.setItem(LAST_RECORD_TIME_KEY, resumeRecordedAt.toString());
          } catch (apiErr: any) {
            console.error('❌ Resume: failed to send location via REST POST, queuing:', apiErr.message);
            await enqueueRecord({
              id: generateUUID(),
              takenTaskId: session.taskId,
              userId: session.userId,
              latitude,
              longitude,
              accuracy,
              address: resumeAddress || undefined,
              recordedAt: resumeRecordedAt,
              recordType: 'location',
            });
          }
        }
      } catch (resumeLocErr: any) {
        console.warn('⚠️  Resume: could not get immediate location:', resumeLocErr.message);
      }
      } // end timeSinceResumeRecord >= MIN_RECORD_INTERVAL_MS

      // Drain any records that were queued before the app was killed
      await runUploadWorker(session.userId, session.taskId);

      console.log(`🔄 Location tracking resumed for task: ${session.taskId}`);
      releaseLock();
      return true;
    } catch (error) {
      console.error('❌ Error resuming tracking:', error);
      releaseLock();
      return false;
    }
  },

  /**
   * Get current tracking status
   */
  async getTrackingStatus(): Promise<TrackingSession | null> {
    try {
      const activeKey = await getActiveSessionKey();
      if (!activeKey) return null;
      const sessionJson = await AsyncStorage.getItem(activeKey);
      return sessionJson ? JSON.parse(sessionJson) : null;
    } catch (error) {
      console.error('Error getting tracking status:', error);
      return null;
    }
  },

  /**
   * Heartbeat: verify the background task is still alive and restart if needed.
   * Call this from AppState 'active' listener or a foreground setInterval.
   * Safe to call frequently — it is a no-op when everything is healthy.
   */
  async heartbeat(): Promise<void> {
    try {
      if (isExpoGo) return; // no-op in Expo Go
      const activeKey = await getActiveSessionKey();
      if (!activeKey) return; // no active session for this user

      const sessionJson = await AsyncStorage.getItem(activeKey);
      if (!sessionJson) return;

      const isRunning = await Location.hasStartedLocationUpdatesAsync(LOCATION_TRACKING_TASK);
      if (!isRunning) {
        console.warn('⚠️  Heartbeat: foreground service not running — restarting');
        await Location.startLocationUpdatesAsync(LOCATION_TRACKING_TASK, FOREGROUND_SERVICE_OPTIONS);
        console.log('✅ Heartbeat: foreground service restarted');
      }

      // Update heartbeat timestamp in session
      const session: UserTrackingSession = JSON.parse(sessionJson);
      session.lastHeartbeatAt = Date.now();
      await AsyncStorage.setItem(activeKey, JSON.stringify(session));
    } catch (e: any) {
      console.error('❌ Heartbeat error:', e.message);
    }
  },
};
