import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';

// Every prisma model/method is an auto-created mock: findMany → [], everything else → null.
// $transaction(callback) runs the callback with the same mocked client.
vi.mock('../../src/config/database', () => {
  const models: Record<string, any> = {};
  const model = (name: string) =>
    (models[name] ??= new Proxy({} as Record<string, any>, {
      get: (target, method: string) =>
        (target[method] ??= vi.fn(async () => (method === 'findMany' ? [] : null))),
    }));
  const client: any = new Proxy({}, {
    get: (_target, prop: string) =>
      prop === '$transaction'
        ? (models.$transaction ??= vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(client))))
        : model(prop),
  });
  return { default: client };
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const db = prisma as any;

const ADMIN = {
  id: 'admin-1', email: 'admin@example.com', name: 'Admin', status: 'active', teamId: null,
  modelHasRoles: [{ role: {
    id: 2n, name: 'admin', guardName: 'web', displayName: 'Admin', level: 50, platform: 'web', color: null, showTaskBadge: false,
    roleHasPermissions: DEFAULT_ROLE_GRANTS.admin.map((name) => ({ permission: { name } })),
  } }],
};
const auth = { Authorization: `Bearer ${jwt.sign({ userId: ADMIN.id, email: ADMIN.email }, JWT_SECRET)}` };

// Employees: e1, e2 in team-1; e3 in team-2
const EMPLOYEES: Record<string, any> = {
  e1: { id: 'e1', name: 'Budi', teamId: 'team-1' },
  e2: { id: 'e2', name: 'Siti', teamId: 'team-1' },
  e3: { id: 'e3', name: 'Rian', teamId: 'team-2' },
};
const teamRow = (id: string, overrides: Record<string, unknown> = {}) => ({
  id, name: `Tim ${id}`, description: null, leaderId: null, status: 'active',
  createdAt: new Date(), updatedAt: new Date(),
  leader: null, users: Object.values(EMPLOYEES).filter((u) => u.teamId === id),
  _count: { users: 0, takenTasks: 0 },
  ...overrides,
});

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: any) =>
    where?.id === ADMIN.id ? ADMIN : (EMPLOYEES[where?.id] ?? null));
  db.user.findMany.mockImplementation(async ({ where }: any) =>
    (where?.id?.in ?? []).filter((id: string) => EMPLOYEES[id]).map((id: string) => ({ id })));
  db.team.findUnique.mockImplementation(async ({ where }: any) =>
    (['team-1', 'team-2', 'team-new'].includes(where?.id) ? teamRow(where.id) : null));
  db.team.create.mockImplementation(async ({ data }: any) => ({ ...data, id: 'team-new' }));
});

describe('Teams', () => {
  it('lists teams with member and task counts', async () => {
    db.team.findMany.mockResolvedValueOnce([teamRow('team-1', { _count: { users: 2, takenTasks: 5 } })]);
    const res = await request(app).get('/api/admin/teams').set(auth);
    expect(res.status).toBe(200);
    expect(res.body.teams[0]).toMatchObject({ id: 'team-1', memberCount: 2, taskCount: 5 });
    expect(res.body.teams[0].members.map((m: any) => m.id)).toEqual(['e1', 'e2']);
  });

  it('requires a non-empty team name', async () => {
    const res = await request(app).post('/api/admin/teams').set(auth).send({ name: '   ' });
    expect(res.status).toBe(400);
    expect(db.team.create).not.toHaveBeenCalled();
  });

  it('rejects an unknown leader', async () => {
    const res = await request(app).post('/api/admin/teams').set(auth).send({ name: 'Tim Baru', leaderId: 'ghost' });
    expect(res.status).toBe(404);
  });

  it('creates a team and moves only existing users into it (one team per user)', async () => {
    const res = await request(app).post('/api/admin/teams').set(auth)
      .send({ name: '  Tim Baru  ', memberIds: ['e3', 'ghost'], status: 'weird' });

    expect(res.status).toBe(201);
    expect(db.team.create.mock.calls[0][0].data).toMatchObject({ name: 'Tim Baru', status: 'active', leaderId: null });
    expect(db.user.updateMany).toHaveBeenCalledWith({ where: { id: { in: ['e3'] } }, data: { teamId: 'team-new' } });
  });

  it('update reconciles members: adds new ones and releases the ones left out', async () => {
    const res = await request(app).put('/api/admin/teams/team-1').set(auth).send({ memberIds: ['e1', 'e3'] });

    expect(res.status).toBe(200);
    const calls = db.user.updateMany.mock.calls.map(([args]: any[]) => args);
    expect(calls).toContainEqual({ where: { id: { in: ['e3'] } }, data: { teamId: 'team-1' } });
    // e2 is released, but only if it is still in this team (does not steal from another team)
    expect(calls).toContainEqual({ where: { id: { in: ['e2'] }, teamId: 'team-1' }, data: { teamId: null } });
  });

  it('update without memberIds leaves membership untouched', async () => {
    await request(app).put('/api/admin/teams/team-1').set(auth).send({ name: 'Nama Baru' });
    expect(db.user.updateMany).not.toHaveBeenCalled();
    expect(db.team.update.mock.calls[0][0].data).toEqual({ name: 'Nama Baru' });
  });

  it('update can clear the leader with null', async () => {
    await request(app).put('/api/admin/teams/team-1').set(auth).send({ leaderId: null });
    expect(db.team.update.mock.calls[0][0].data).toEqual({ leaderId: null });
  });

  it('delete releases the members first, then deletes the team', async () => {
    db.user.findMany.mockResolvedValueOnce([{ id: 'e1' }, { id: 'e2' }]);
    const res = await request(app).delete('/api/admin/teams/team-1').set(auth);

    expect(res.status).toBe(200);
    expect(db.user.updateMany).toHaveBeenCalledWith({ where: { teamId: 'team-1' }, data: { teamId: null } });
    expect(db.team.delete).toHaveBeenCalledWith({ where: { id: 'team-1' } });
  });

  it('returns 404 for an unknown team', async () => {
    expect((await request(app).get('/api/admin/teams/ghost').set(auth)).status).toBe(404);
    expect((await request(app).delete('/api/admin/teams/ghost').set(auth)).status).toBe(404);
  });

  it('add members requires at least one existing user', async () => {
    expect((await request(app).post('/api/admin/teams/team-1/members').set(auth).send({ userIds: [] })).status).toBe(400);
    expect((await request(app).post('/api/admin/teams/team-1/members').set(auth).send({ userIds: ['ghost'] })).status).toBe(400);
  });

  it('remove member only works for a user who is actually in that team', async () => {
    const wrongTeam = await request(app).delete('/api/admin/teams/team-1/members/e3').set(auth);
    expect(wrongTeam.status).toBe(400);
    expect(db.user.update).not.toHaveBeenCalled();

    const ok = await request(app).delete('/api/admin/teams/team-1/members/e1').set(auth);
    expect(ok.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith({ where: { id: 'e1' }, data: { teamId: null } });
  });
});
