import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';

// Every prisma model/method is an auto-created mock: findMany → [], everything else → null.
vi.mock('../../src/config/database', () => {
  const models: Record<string, any> = {};
  const model = (name: string) =>
    (models[name] ??= new Proxy({} as Record<string, any>, {
      get: (target, method: string) =>
        (target[method] ??= vi.fn(async () => (method === 'findMany' ? [] : null))),
    }));
  const client: any = new Proxy({}, {
    get: (_target, prop: string) => {
      if (prop === '$executeRaw') return (models.$executeRaw ??= vi.fn(async () => 0));
      if (prop === '$transaction') {
        return (models.$transaction ??= vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(client))));
      }
      return model(prop);
    },
  });
  return { default: client };
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const db = prisma as any;

const role = (name: string, level: number, platform: 'web' | 'mobile', permissions: string[]) => ({
  id: BigInt(level), name, guardName: 'web', displayName: name, level, platform, color: null, showTaskBadge: false,
  roleHasPermissions: permissions.map((p) => ({ permission: { name: p } })),
});
const USERS: Record<string, any> = {
  e1: { id: 'e1', email: 'e1@example.com', name: 'Budi', status: 'active', modelHasRoles: [{ role: role('employee', 10, 'mobile', []) }] },
  admin: { id: 'admin', email: 'admin@example.com', name: 'Admin', status: 'active', modelHasRoles: [{ role: role('admin', 50, 'web', DEFAULT_ROLE_GRANTS.admin) }] },
};
const auth = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ userId, email: USERS[userId].email }, JWT_SECRET)}` });

// Jakarta area, ~111 m per 0.001° latitude
const BASE_LAT = -7.7956;
const BASE_LNG = 110.3695;
const T0 = Date.UTC(2026, 9, 21, 2, 0, 0); // 2026-10-21 02:00:00 UTC

const point = (id: string, overrides: Record<string, unknown> = {}) => ({
  id,
  takenTaskId: 'tt-1',
  userId: 'e1',
  latitude: BASE_LAT,
  longitude: BASE_LNG,
  accuracy: 10,
  recordedAt: T0,
  ...overrides,
});

// Each VALUES row binds: id, takenTaskId, userId, latitude, longitude, accuracy, address, unix seconds
const VALUES_PER_ROW = 8;

/** The parameterized query passed to prisma.$executeRaw (a Prisma.Sql object) */
const bulkQuery = (): { sql: string; values: unknown[] } => db.$executeRaw.mock.calls[0][0];

/** Bound rows of the bulk INSERT, in order */
const insertedRows = () => {
  const { values } = bulkQuery();
  const rows = [];
  for (let i = 0; i < values.length; i += VALUES_PER_ROW) {
    const [id, takenTaskId, userId, latitude, longitude, accuracy, address, seconds] = values.slice(i, i + VALUES_PER_ROW);
    rows.push({ id, takenTaskId, userId, latitude, longitude, accuracy, address, seconds });
  }
  return rows;
};
const insertedIds = () => insertedRows().map((r) => r.id);

// Assignments e1 is part of; `taskStatus` drives the route end-time tests
const ASSIGNMENTS: Record<string, { takenTaskId: string; userIds: string }> = {
  'tt-1': { takenTaskId: 'tt-1', userIds: JSON.stringify(['e1', 'e9']) },
  'tt-2': { takenTaskId: 'tt-2', userIds: JSON.stringify(['e1']) },
  'tt-other': { takenTaskId: 'tt-other', userIds: JSON.stringify(['e9']) },
};
let taskStatus = 'completed';

beforeEach(() => {
  vi.clearAllMocks();
  taskStatus = 'completed';
  db.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where?.id] ?? null);
  db.takenTask.findUnique.mockImplementation(async ({ where }: any) =>
    ASSIGNMENTS[where?.takenTaskId] ? { ...ASSIGNMENTS[where.takenTaskId], status: taskStatus } : null);
  db.takenTask.findMany.mockImplementation(async ({ where }: any) =>
    (where?.takenTaskId?.in ?? []).map((id: string) => ASSIGNMENTS[id]).filter(Boolean));
  db.$executeRaw.mockImplementation(async (query: { values: unknown[] }) => query.values.length / VALUES_PER_ROW);
});

describe('POST /api/locations (saveLocation)', () => {
  beforeEach(() => {
    db.location.upsert.mockImplementation(async ({ create }: any) => create);
  });

  it('uses the client-generated id so a retried request does not create a duplicate', async () => {
    const res = await request(app).post('/api/locations').set(auth('e1')).send({
      id: 'client-uuid-1', takenTaskId: 'tt-1', latitude: BASE_LAT, longitude: BASE_LNG, accuracy: 8, recordedAt: new Date(T0).toISOString(),
    });

    expect(res.status).toBe(201);
    const args = db.location.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ locationId: 'client-uuid-1' });
    expect(args.update).toEqual({}); // first write wins
    expect(args.create).toMatchObject({ locationId: 'client-uuid-1', userId: 'e1', takenTaskId: 'tt-1', accuracy: 8 });
    expect(args.create.recordedAt.toISOString()).toBe(new Date(T0).toISOString());
  });

  it('generates an id when the client does not send one', async () => {
    await request(app).post('/api/locations').set(auth('e1')).send({ takenTaskId: 'tt-1', latitude: BASE_LAT, longitude: BASE_LNG });
    const { where } = db.location.upsert.mock.calls[0][0];
    expect(where.locationId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('records the location for the logged-in user, ignoring any userId in the body', async () => {
    await request(app).post('/api/locations').set(auth('e1')).send({ takenTaskId: 'tt-1', userId: 'someone-else', latitude: BASE_LAT, longitude: BASE_LNG });
    expect(db.location.upsert.mock.calls[0][0].create.userId).toBe('e1');
  });

  it('falls back to formatted coordinates when no address is sent', async () => {
    await request(app).post('/api/locations').set(auth('e1')).send({ takenTaskId: 'tt-1', latitude: '-7.795612', longitude: '110.369534' });
    expect(db.location.upsert.mock.calls[0][0].create.address).toBe('-7.795612, 110.369534');
  });

  it.each([
    ['a heartbeat with null coordinates', { latitude: null, longitude: null }],
    ['non-numeric coordinates', { latitude: 'abc', longitude: 110.37 }],
    ['latitude out of range', { latitude: 95, longitude: 110.37 }],
  ])('rejects %s with 400 (so the mobile worker drops it instead of retrying forever)', async (_label, coords) => {
    const res = await request(app).post('/api/locations').set(auth('e1')).send({ takenTaskId: 'tt-1', ...coords });
    expect(res.status).toBe(400);
    expect(db.location.upsert).not.toHaveBeenCalled();
  });

  it('defaults the tracking status to auto', async () => {
    await request(app).post('/api/locations').set(auth('e1')).send({ takenTaskId: 'tt-1', latitude: BASE_LAT, longitude: BASE_LNG });
    expect(db.location.upsert.mock.calls[0][0].create.trackingStatus).toBe('auto');
  });
});

describe('POST /api/locations/bulk (offline queue upload)', () => {
  it('rejects an empty or non-array body', async () => {
    for (const body of [[], { id: 'x' }]) {
      const res = await request(app).post('/api/locations/bulk').set(auth('e1')).send(body);
      expect(res.status).toBe(400);
    }
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a record with missing fields or non-numeric coordinates', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('e1'))
      .send([point('p1'), point('p2', { latitude: '-7.79' })]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid location record format/);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it.each([
    ['latitude out of range', { latitude: 91 }],
    ['longitude out of range', { longitude: -181 }],
    ['negative accuracy', { accuracy: -1 }],
    ['non-numeric accuracy', { accuracy: '5' }],
    ['non-numeric recordedAt', { recordedAt: '2026-10-21' }],
    ['missing id', { id: '' }],
    ['overlong address', { address: 'x'.repeat(256) }],
  ])('rejects a record with %s', async (_label, override) => {
    const res = await request(app).post('/api/locations/bulk').set(auth('e1')).send([point('p1', override)]);
    expect(res.status).toBe(400);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('keeps one point per minute, preferring the best accuracy', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point('a', { accuracy: 20, recordedAt: T0 + 5_000 }),
      point('b', { accuracy: 5, recordedAt: T0 + 20_000 }),
      point('c', { accuracy: 12, recordedAt: T0 + 40_000 }),
    ]);

    expect(res.status).toBe(200);
    expect(insertedIds()).toEqual(['b']);
    expect(res.body).toMatchObject({ count: 1, dropped: 2, status: 'success' });
  });

  it('drops points that moved less than 10 m from the previous kept point', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point('start', { recordedAt: T0 }),
      point('still', { recordedAt: T0 + 60_000, latitude: BASE_LAT + 0.00005 }), // ~5.5 m
      point('moved', { recordedAt: T0 + 120_000, latitude: BASE_LAT + 0.0005 }), // ~55 m
    ]);

    expect(insertedIds()).toEqual(['start', 'moved']);
    expect(res.body.dropped).toBe(1);
  });

  it('writes points in chronological order even if the queue sends them out of order', async () => {
    await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point('third', { recordedAt: T0 + 240_000, latitude: BASE_LAT + 0.002 }),
      point('first', { recordedAt: T0 }),
      point('second', { recordedAt: T0 + 120_000, latitude: BASE_LAT + 0.001 }),
    ]);
    expect(insertedIds()).toEqual(['first', 'second', 'third']);
  });

  it('deduplicates per assignment, not across assignments', async () => {
    await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point('u1', { recordedAt: T0 }),
      point('u1-other-task', { recordedAt: T0, takenTaskId: 'tt-2', latitude: BASE_LAT + 0.001 }),
    ]);
    expect(insertedRows()).toHaveLength(2);
  });

  it('is idempotent: re-sending the same ids only touches updated_at', async () => {
    await request(app).post('/api/locations/bulk').set(auth('e1')).send([point('same-id')]);
    expect(bulkQuery().sql).toMatch(/ON DUPLICATE KEY UPDATE\s+updated_at = NOW\(\)/);
    expect(insertedRows()[0]).toMatchObject({ id: 'same-id', seconds: Math.floor(T0 / 1000) });
  });

  it('records every point for the logged-in user, ignoring the userId in the body', async () => {
    await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point('spoofed', { userId: 'admin' }),
    ]);
    expect(insertedRows()[0].userId).toBe('e1');
  });

  it('binds every value as a parameter, so SQL in a field is stored as plain text', async () => {
    const payload = "x'); DROP TABLE users; -- \\'";
    await request(app).post('/api/locations/bulk').set(auth('e1')).send([
      point("id'1", { address: payload }),
    ]);

    const { sql } = bulkQuery();
    expect(sql).not.toContain('DROP TABLE');
    expect(sql).not.toContain("id'1");
    expect(insertedRows()[0]).toMatchObject({ id: "id'1", address: payload });
  });

  it('returns 400 when the assignment or user does not exist (foreign key)', async () => {
    db.$executeRaw.mockRejectedValueOnce(new Error('Foreign key constraint fails'));
    const res = await request(app).post('/api/locations/bulk').set(auth('e1')).send([point('fk')]);
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Invalid takenTaskId or userId/);
  });
});

describe('GET /api/locations/tasks/:id/route (route statistics)', () => {
  const loc = (lat: number, lng: number, minutes: number) => ({
    latitude: lat, longitude: lng, address: null, recordedAt: new Date(T0 + minutes * 60_000),
  });

  it('returns empty statistics when there is no location yet', async () => {
    db.location.findMany.mockResolvedValueOnce([]);
    const res = await request(app).get('/api/locations/tasks/tt-1/route').set(auth('e1'));
    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      route: [],
      statistics: { total_points: 0, distance_km: 0, start_time: null, end_time: null, duration_hours: 0 },
    });
  });

  it('sums the distance between consecutive points (haversine)', async () => {
    // 0.01° of latitude ≈ 1.112 km; two legs ≈ 2.224 km
    db.location.findMany.mockResolvedValueOnce([loc(-7.80, 110.37, 0), loc(-7.79, 110.37, 30), loc(-7.78, 110.37, 90)]);
    taskStatus = 'completed';

    const res = await request(app).get('/api/locations/tasks/tt-1/route').set(auth('e1'));

    expect(res.body.route).toHaveLength(3);
    expect(res.body.statistics.total_points).toBe(3);
    expect(res.body.statistics.distance_km).toBeCloseTo(2.224, 2);
  });

  it('uses the last point as end time for a finished assignment', async () => {
    db.location.findMany.mockResolvedValueOnce([loc(-7.80, 110.37, 0), loc(-7.79, 110.37, 90)]);
    taskStatus = 'completed';

    const res = await request(app).get('/api/locations/tasks/tt-1/route').set(auth('e1'));

    expect(res.body.statistics.start_time).toBe(new Date(T0).toISOString());
    expect(res.body.statistics.end_time).toBe(new Date(T0 + 90 * 60_000).toISOString());
    expect(res.body.statistics.duration_hours).toBe(1.5);
  });

  it('leaves the end time open while the assignment is in progress', async () => {
    db.location.findMany.mockResolvedValueOnce([loc(-7.80, 110.37, 0), loc(-7.79, 110.37, 10)]);
    taskStatus = 'in_progress';

    const res = await request(app).get('/api/locations/tasks/tt-1/route').set(auth('e1'));

    expect(res.body.statistics.end_time).toBeNull();
    expect(res.body.statistics.duration_hours).toBeGreaterThan(0);
  });

  it('filters by userId on the admin mount', async () => {
    db.location.findMany.mockResolvedValueOnce([]);
    await request(app).get('/api/admin/locations/tasks/tt-1/route?userId=e1').set(auth('admin'));
    expect(db.location.findMany.mock.calls[0][0].where).toEqual({ takenTaskId: 'tt-1', userId: 'e1' });
  });
});
