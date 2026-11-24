import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mocks (hoisted so the service sees them when it is imported) ─────────────
const h = vi.hoisted(() => {
  const storage = new Map<string, string>();
  return {
    storage,
    taskCallback: null as null | (() => Promise<void>),
    recordLocation: vi.fn(),
    getCurrentPositionAsync: vi.fn(),
    reverseGeocodeAsync: vi.fn(),
  };
});

vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (h.storage.has(k) ? h.storage.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { h.storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.storage.delete(k); }),
  },
}));
vi.mock('expo-task-manager', () => ({
  defineTask: (_name: string, cb: () => Promise<void>) => { h.taskCallback = cb; },
  isTaskRegisteredAsync: vi.fn(async () => false),
}));
vi.mock('expo-location', () => ({
  Accuracy: { Balanced: 3 },
  getCurrentPositionAsync: h.getCurrentPositionAsync,
  reverseGeocodeAsync: h.reverseGeocodeAsync,
}));
vi.mock('expo-constants', () => ({ default: { appOwnership: null } }));
vi.mock('react-native', () => ({ AppState: { currentState: 'background' } }));
vi.mock('../../services/api', () => ({ locationsAPI: { recordLocation: h.recordLocation } }));

import { getPersistedTrackingState } from '../../services/locationTrackingRefactored';

// ── Helpers ──────────────────────────────────────────────────────────────────
const USER = { id: 'u1', name: 'Budi' };
const TASK_ID = 'tt-1';
const QUEUE_KEY = `location_queue_${USER.id}_${TASK_ID}`;
const THROTTLE_KEY = 'location_last_record_time';
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** Logged-in user with an active tracking session for TASK_ID */
const seedActiveSession = () => {
  h.storage.set('user', JSON.stringify(USER));
  h.storage.set('userToken', 'jwt-token');
  h.storage.set(`active_task_${USER.id}`, TASK_ID);
  h.storage.set(`location_tracking_session_${USER.id}_${TASK_ID}`, JSON.stringify({ taskId: TASK_ID, userId: USER.id, startedAt: 1, lastRecordedAt: 1 }));
};

const queue = (): any[] => JSON.parse(h.storage.get(QUEUE_KEY) || '[]');
const queued = (id: string, extra: Record<string, unknown> = {}) =>
  ({ id, takenTaskId: TASK_ID, userId: USER.id, latitude: -7.79, longitude: 110.37, accuracy: 5, recordedAt: 1000, recordType: 'location', ...extra });
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } });

/** Run one background-task cycle the way the OS would */
const runTask = () => h.taskCallback!();

beforeEach(() => {
  h.storage.clear();
  vi.clearAllMocks();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  h.getCurrentPositionAsync.mockResolvedValue({ coords: { latitude: -7.7956, longitude: 110.3695, accuracy: 12 } });
  h.reverseGeocodeAsync.mockResolvedValue([{ street: 'Jl. Malioboro', district: 'Gedong Tengen', city: 'Yogyakarta', region: 'DIY' }]);
  h.recordLocation.mockResolvedValue({});
});

afterEach(() => {
  vi.useRealTimers();
});

describe('background location task', () => {
  it('registers a background task when the service is imported', () => {
    expect(h.taskCallback).toBeTypeOf('function');
  });

  it('skips the cycle when the last record was less than 9 minutes ago (throttle)', async () => {
    seedActiveSession();
    h.storage.set(THROTTLE_KEY, String(Date.now() - 60_000));

    await runTask();

    expect(h.getCurrentPositionAsync).not.toHaveBeenCalled();
    expect(h.recordLocation).not.toHaveBeenCalled();
  });

  it('does nothing when there is no active tracking session', async () => {
    h.storage.set('user', JSON.stringify(USER));
    await runTask();
    expect(h.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('does nothing without an auth token', async () => {
    seedActiveSession();
    h.storage.delete('userToken');
    await runTask();
    expect(h.getCurrentPositionAsync).not.toHaveBeenCalled();
  });

  it('sends the GPS fix with a client UUID, the reverse-geocoded address and the capture time', async () => {
    seedActiveSession();
    const before = Date.now();

    await runTask();

    expect(h.recordLocation).toHaveBeenCalledTimes(1);
    const [taskId, lat, lng, accuracy, address, recordedAt, id, recordType] = h.recordLocation.mock.calls[0];
    expect({ taskId, lat, lng, accuracy, recordType }).toEqual({ taskId: TASK_ID, lat: -7.7956, lng: 110.3695, accuracy: 12, recordType: 'location' });
    expect(address).toBe('Jl. Malioboro, Gedong Tengen, Yogyakarta, DIY');
    expect(recordedAt).toBeGreaterThanOrEqual(before);
    expect(id).toMatch(UUID_PATTERN);
    expect(Number(h.storage.get(THROTTLE_KEY))).toBeGreaterThanOrEqual(before);
  });

  it('still sends the location when reverse geocoding fails', async () => {
    seedActiveSession();
    h.reverseGeocodeAsync.mockRejectedValueOnce(new Error('geocoder down'));
    await runTask();
    expect(h.recordLocation.mock.calls[0][4]).toBe('');
  });

  it('queues the record offline when the upload fails, and moves the throttle window anyway', async () => {
    seedActiveSession();
    h.recordLocation.mockRejectedValueOnce(new Error('Network Error'));

    await runTask();

    expect(queue()).toHaveLength(1);
    expect(queue()[0]).toMatchObject({ takenTaskId: TASK_ID, userId: USER.id, latitude: -7.7956, recordType: 'location' });
    expect(h.storage.get(THROTTLE_KEY)).toBeDefined();
  });

  it('sends a heartbeat (null coordinates) when GPS fails', async () => {
    seedActiveSession();
    h.getCurrentPositionAsync.mockRejectedValueOnce(new Error('GPS unavailable'));

    await runTask();

    const [, lat, lng, , , , id, recordType] = h.recordLocation.mock.calls[0];
    expect({ lat, lng, recordType }).toEqual({ lat: null, lng: null, recordType: 'heartbeat' });
    expect(id).toMatch(UUID_PATTERN);
  });
});

describe('offline queue upload worker', () => {
  it('after a successful send, drains the queue oldest-first', async () => {
    seedActiveSession();
    h.storage.set(QUEUE_KEY, JSON.stringify([queued('old-1', { recordedAt: 1 }), queued('old-2', { recordedAt: 2 })]));

    await runTask();

    const sentIds = h.recordLocation.mock.calls.map((call) => call[6]);
    expect(sentIds.slice(1)).toEqual(['old-1', 'old-2']); // first call is the fresh fix
    expect(h.recordLocation.mock.calls[1][5]).toBe(1);     // original capture time is preserved
    expect(queue()).toEqual([]);
  });

  it('drops a record the server rejects permanently (4xx) and continues with the next one', async () => {
    seedActiveSession();
    h.storage.set(QUEUE_KEY, JSON.stringify([queued('rejected'), queued('ok')]));
    h.recordLocation
      .mockResolvedValueOnce({})             // fresh fix
      .mockRejectedValueOnce(httpError(400)) // 'rejected' → permanent
      .mockResolvedValueOnce({});            // 'ok'

    await runTask();

    expect(h.recordLocation.mock.calls.map((c) => c[6]).slice(1)).toEqual(['rejected', 'ok']);
    expect(queue()).toEqual([]);
  });

  it('a stuck heartbeat that the server rejects with 400 no longer blocks the queue', async () => {
    seedActiveSession();
    h.storage.set(QUEUE_KEY, JSON.stringify([
      queued('hb', { latitude: null, longitude: null, recordType: 'heartbeat' }),
      queued('loc'),
    ]));
    h.recordLocation
      .mockResolvedValueOnce({})
      .mockRejectedValueOnce(httpError(400))
      .mockResolvedValueOnce({});

    await runTask();

    expect(queue()).toEqual([]);
    expect(h.recordLocation.mock.calls.at(-1)![6]).toBe('loc');
  });

  it('on a transient error retries 3 times with backoff, then keeps the record at the front and stops', async () => {
    vi.useFakeTimers();
    seedActiveSession();
    h.storage.set(QUEUE_KEY, JSON.stringify([queued('flaky'), queued('waiting')]));
    h.recordLocation
      .mockResolvedValueOnce({}) // fresh fix
      .mockRejectedValue(httpError(503));

    const run = runTask();
    await vi.runAllTimersAsync();
    await run;

    const flakyAttempts = h.recordLocation.mock.calls.filter((c) => c[6] === 'flaky').length;
    expect(flakyAttempts).toBe(3);
    expect(h.recordLocation.mock.calls.some((c) => c[6] === 'waiting')).toBe(false);
    expect(queue().map((r) => r.id)).toEqual(['flaky', 'waiting']);
  });

  it('caps the offline queue at 288 records (24h), dropping the oldest', async () => {
    seedActiveSession();
    const full = Array.from({ length: 288 }, (_, i) => queued(`q-${i}`));
    h.storage.set(QUEUE_KEY, JSON.stringify(full));
    h.recordLocation.mockRejectedValueOnce(new Error('Network Error'));

    await runTask();

    const ids = queue().map((r) => r.id);
    expect(ids).toHaveLength(288);
    expect(ids[0]).toBe('q-1');            // oldest dropped
    expect(ids[287]).not.toMatch(/^q-/);   // newest is the fresh fix
  });
});

describe('getPersistedTrackingState', () => {
  it('returns the saved state while tracking', async () => {
    const state = { isTracking: true, takenTaskId: TASK_ID, userId: USER.id, startedAt: 123 };
    h.storage.set('c_track_active_tracking', JSON.stringify(state));
    expect(await getPersistedTrackingState()).toEqual(state);
  });

  it('returns null when not tracking, missing or corrupt', async () => {
    expect(await getPersistedTrackingState()).toBeNull();
    h.storage.set('c_track_active_tracking', JSON.stringify({ isTracking: false }));
    expect(await getPersistedTrackingState()).toBeNull();
    h.storage.set('c_track_active_tracking', '{not json');
    expect(await getPersistedTrackingState()).toBeNull();
  });
});
