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
      if (prop === '$executeRaw') return (models.$executeRaw ??= vi.fn(async () => 1));
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
const EMPLOYEE = role('employee', 10, 'mobile', []);
const user = (id: string, r: any) => ({ id, email: `${id}@example.com`, name: id, status: 'active', modelHasRoles: [{ role: r }] });

const USERS: Record<string, any> = {
  budi: user('budi', EMPLOYEE),   // assigned to tt-mine
  siti: user('siti', EMPLOYEE),   // assigned to tt-mine and tt-other
  rian: user('rian', EMPLOYEE),   // assigned to tt-other only
  admin: user('admin', role('admin', 50, 'web', DEFAULT_ROLE_GRANTS.admin)),
  viewer: user('viewer', role('dashboard_only', 40, 'web', ['dashboard.view'])), // web staff without monitoring
};
const auth = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ userId, email: `${userId}@example.com` }, JWT_SECRET)}` });

const TASK = { taskId: 'task-1', title: 'Inspeksi', createdByRoleName: null, createdBy: null };
const ASSIGNMENTS: Record<string, any> = {
  'tt-mine': { takenTaskId: 'tt-mine', ticketNumber: 'ASN-0001', userIds: JSON.stringify(['budi', 'siti']), userStatuses: JSON.stringify({ budi: 'pending', siti: 'pending' }), status: 'pending', task: TASK },
  'tt-other': { takenTaskId: 'tt-other', ticketNumber: 'ASN-0002', userIds: JSON.stringify(['siti', 'rian']), userStatuses: JSON.stringify({ siti: 'pending', rian: 'pending' }), status: 'pending', task: TASK },
};
const REPORTS: Record<string, any> = {
  'rep-other': { reportId: 'rep-other', userId: 'rian', takenTaskId: 'tt-other', report: 'Selesai', image: null, user: { id: 'rian', name: 'rian' }, takenTask: ASSIGNMENTS['tt-other'] },
};

const T0 = Date.UTC(2026, 9, 21, 2, 0, 0);
const bulkPoint = (id: string, takenTaskId: string) => ({ id, takenTaskId, userId: 'budi', latitude: -7.79, longitude: 110.37, accuracy: 5, recordedAt: T0 });

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where?.id] ?? null);
  db.takenTask.findUnique.mockImplementation(async ({ where }: any) => ASSIGNMENTS[where?.takenTaskId] ?? null);
  db.takenTask.findMany.mockImplementation(async ({ where }: any = {}) => {
    const ids: string[] | undefined = where?.takenTaskId?.in;
    return ids ? ids.map((id) => ASSIGNMENTS[id]).filter(Boolean) : Object.values(ASSIGNMENTS);
  });
  db.report.findUnique.mockImplementation(async ({ where }: any) => REPORTS[where?.reportId] ?? null);
  db.location.upsert.mockImplementation(async ({ create }: any) => create);
  db.role.findMany.mockResolvedValue([]);
});

describe('GET /api/my-tasks/:id — assignment detail', () => {
  it('lets an assigned employee read their assignment', async () => {
    const res = await request(app).get('/api/my-tasks/tt-mine').set(auth('budi'));
    expect(res.status).toBe(200);
  });

  it("blocks an employee from another team's assignment", async () => {
    const res = await request(app).get('/api/my-tasks/tt-other').set(auth('budi'));
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown assignment', async () => {
    const res = await request(app).get('/api/my-tasks/missing').set(auth('budi'));
    expect(res.status).toBe(404);
  });
});

describe('GET /api/locations/tasks/:id(/route) — reading locations', () => {
  it.each(['/api/locations/tasks/tt-other', '/api/locations/tasks/tt-other/route'])(
    'blocks an employee who is not assigned: %s',
    async (path) => {
      const res = await request(app).get(path).set(auth('budi'));
      expect(res.status).toBe(403);
      expect(db.location.findMany).not.toHaveBeenCalled();
    }
  );

  it('lets teammates see each other on a shared assignment', async () => {
    const res = await request(app).get('/api/locations/tasks/tt-mine').set(auth('siti'));
    expect(res.status).toBe(200);
  });

  it('lets web staff with monitoring.view_locations read any assignment (web Monitoring page)', async () => {
    const res = await request(app).get('/api/locations/tasks/tt-other/route').set(auth('admin'));
    expect(res.status).toBe(200);
  });

  it('blocks web staff without monitoring.view_locations', async () => {
    const res = await request(app).get('/api/locations/tasks/tt-other').set(auth('viewer'));
    expect(res.status).toBe(403);
  });
});

describe('POST /api/locations(/bulk) — recording locations', () => {
  it('blocks recording a location on an assignment you are not part of', async () => {
    const res = await request(app).post('/api/locations').set(auth('budi'))
      .send({ takenTaskId: 'tt-other', latitude: -7.79, longitude: 110.37 });
    expect(res.status).toBe(403);
    expect(db.location.upsert).not.toHaveBeenCalled();
  });

  it('returns 404 for an unknown assignment', async () => {
    const res = await request(app).post('/api/locations').set(auth('budi'))
      .send({ takenTaskId: 'missing', latitude: -7.79, longitude: 110.37 });
    expect(res.status).toBe(404);
  });

  it('records a location on your own assignment', async () => {
    const res = await request(app).post('/api/locations').set(auth('budi'))
      .send({ takenTaskId: 'tt-mine', latitude: -7.79, longitude: 110.37 });
    expect(res.status).toBe(201);
  });

  it('rejects the whole batch if any point belongs to an assignment you are not part of', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('budi'))
      .send([bulkPoint('p1', 'tt-mine'), bulkPoint('p2', 'tt-other')]);
    expect(res.status).toBe(403);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('rejects a batch for an unknown assignment', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('budi')).send([bulkPoint('p1', 'missing')]);
    expect(res.status).toBe(400);
    expect(db.$executeRaw).not.toHaveBeenCalled();
  });

  it('saves a batch for your own assignment', async () => {
    const res = await request(app).post('/api/locations/bulk').set(auth('budi')).send([bulkPoint('p1', 'tt-mine')]);
    expect(res.status).toBe(200);
    expect(db.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

describe('Reports', () => {
  it('blocks creating a report on an assignment you are not part of', async () => {
    const res = await request(app).post('/api/reports').set(auth('budi')).send({ takenTaskId: 'tt-other', report: 'Palsu' });
    expect(res.status).toBe(403);
    expect(db.report.create).not.toHaveBeenCalled();
  });

  it("blocks reading another team's report", async () => {
    const res = await request(app).get('/api/reports/rep-other').set(auth('budi'));
    expect(res.status).toBe(403);
  });

  it.each([
    ['the reporter', 'rian'],
    ['a teammate on the same assignment', 'siti'],
    ['staff with monitoring.view_reports', 'admin'],
  ])('lets %s read the report', async (_label, userId) => {
    const res = await request(app).get('/api/reports/rep-other').set(auth(userId));
    expect(res.status).toBe(200);
  });
});

describe('Chat per assignment (/api/chat)', () => {
  it('requires login', async () => {
    const res = await request(app).get('/api/chat/tt-mine');
    expect(res.status).toBe(401);
  });

  it('lets an assigned employee read the chat', async () => {
    db.chatMessage.findMany.mockResolvedValueOnce([{ id: 'm1', takenTaskId: 'tt-mine', message: 'halo' }]);
    const res = await request(app).get('/api/chat/tt-mine').set(auth('budi'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveLength(1);
  });

  it("blocks reading another team's chat", async () => {
    const res = await request(app).get('/api/chat/tt-other').set(auth('budi'));
    expect(res.status).toBe(403);
    expect(db.chatMessage.findMany).not.toHaveBeenCalled();
  });

  it('lets staff with monitoring.view_reports read any chat', async () => {
    const res = await request(app).get('/api/chat/tt-other').set(auth('admin'));
    expect(res.status).toBe(200);
  });

  it.each(['/api/chat/read', '/api/chat/typing'])('%s requires login and an assignment', async (path) => {
    expect((await request(app).post(path).send({ takenTaskId: 'tt-mine' })).status).toBe(401);
    expect((await request(app).post(path).set(auth('budi')).send({ takenTaskId: 'tt-other' })).status).toBe(403);
    expect((await request(app).post(path).set(auth('budi')).send({ takenTaskId: 'tt-mine', userId: 'rian' })).status).toBe(200);
  });
});

describe('GET /api/admin/assignments/user/:userId', () => {
  it("returns the requested user's assignments, not the admin's own", async () => {
    const res = await request(app).get('/api/admin/assignments/user/rian').set(auth('admin'));
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: any) => t.takenTaskId)).toEqual(['tt-other']);
  });

  it("returns the caller's own assignments on /api/my-tasks", async () => {
    const res = await request(app).get('/api/my-tasks').set(auth('budi'));
    expect(res.status).toBe(200);
    expect(res.body.tasks.map((t: any) => t.takenTaskId)).toEqual(['tt-mine']);
  });
});
