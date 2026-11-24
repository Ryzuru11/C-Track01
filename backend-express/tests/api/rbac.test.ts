import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';

// Every prisma model/method is an auto-created mock: findMany → [], everything else → null.
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

type Fixture = { name: string; level: number; platform: 'web' | 'mobile'; permissions: string[]; id: bigint };

const ROLES: Record<string, Fixture> = {
  superadmin: { id: 1n, name: 'superadmin', level: 100, platform: 'web', permissions: ALL_PERMISSION_KEYS },
  admin: { id: 2n, name: 'admin', level: 50, platform: 'web', permissions: DEFAULT_ROLE_GRANTS.admin },
  manager: { id: 3n, name: 'manager', level: 50, platform: 'web', permissions: DEFAULT_ROLE_GRANTS.manager },
  employee: { id: 4n, name: 'employee', level: 10, platform: 'mobile', permissions: [] },
  custom_empty: { id: 5n, name: 'custom_empty', level: 40, platform: 'web', permissions: [] },
  analyst: { id: 6n, name: 'analyst', level: 40, platform: 'web', permissions: ['analytics.view'] },
};

const roleRow = (role: Fixture) => ({
  id: role.id,
  name: role.name,
  guardName: 'web',
  displayName: role.name.charAt(0).toUpperCase() + role.name.slice(1),
  description: null,
  level: role.level,
  platform: role.platform,
  isSystem: ['superadmin', 'admin', 'manager', 'employee'].includes(role.name),
  color: null,
  showTaskBadge: role.name === 'manager',
  roleHasPermissions: role.permissions.map((name) => ({ permission: { name } })),
  _count: { modelHasRoles: 0 },
});

const userIdOf = (roleName: string) => `user-${roleName}`;

const userRow = (roleName: string) => ({
  id: userIdOf(roleName),
  email: `${roleName}@example.com`,
  name: `${roleName} user`,
  status: 'active',
  modelHasRoles: [{ role: roleRow(ROLES[roleName]) }],
});

const tokenFor = (roleName: string) => jwt.sign({ userId: userIdOf(roleName), email: `${roleName}@example.com` }, JWT_SECRET);

const db = prisma as any;

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: any) => {
    const roleName = Object.keys(ROLES).find((r) => userIdOf(r) === where?.id);
    return roleName ? userRow(roleName) : null;
  });
  db.role.findUnique.mockImplementation(async ({ where }: any) => {
    const role = where?.id !== undefined
      ? Object.values(ROLES).find((r) => r.id === where.id)
      : ROLES[where?.name_guardName?.name];
    return role ? roleRow(role) : null;
  });
  db.user.update.mockImplementation(async ({ where }: any) => ({ id: where.id }));
});

describe('RBAC route guards (default grants)', () => {
  const S = 'superadmin', A = 'admin', M = 'manager', AN = 'analyst';
  const ALL = Object.keys(ROLES);

  const routes: Array<[string, string, string[]]> = [
    ['get', '/api/admin/users', [S, A, M, AN]],
    ['post', '/api/admin/users', [S, A, M]],
    ['delete', '/api/admin/users/someone', [S]],
    ['get', '/api/admin/tasks', [S, A, M]],
    ['post', '/api/admin/tasks', [S, A, M]],
    ['get', '/api/admin/tasks/template', [S, A, M]],
    ['delete', '/api/admin/tasks/t1', [S, A, M]],
    ['get', '/api/admin/assignments', [S, A, M, AN]],
    ['get', '/api/admin/assignments/a1', [S, A, M]],
    ['put', '/api/admin/assignments/a1', [S, A, M]],
    ['get', '/api/admin/locations/all', [S, A, M, AN]],
    ['get', '/api/admin/locations/tasks/a1', [S, A, M]],
    ['get', '/api/locations/tasks/a1', ALL],
    ['get', '/api/admin/reports', [S, A, M, AN]],
    ['patch', '/api/admin/reports/r1/finish', [S, A, M]],
    ['get', '/api/admin/teams', [S, A, M]],
    ['get', '/api/admin/roles', [S]],
    ['get', '/api/admin/permissions', [S]],
    ['get', '/api/admin/roles/assignable', [S, A, M]],
    ['get', '/api/ai/model-limits', [S, A, M]],
    ['get', '/api/ai/prompts/system', [S]],
    ['get', '/api/geocoding/search', [S, A, M]],
  ];

  const cases = routes.flatMap(([method, path, allowed]) =>
    ALL.map((role) => ({ method, path, role, allowed: allowed.includes(role) }))
  );

  it.each(cases)('$method $path as $role → allowed=$allowed', async ({ method, path, role, allowed }) => {
    const res = await (request(app) as any)[method](path).set('Authorization', `Bearer ${tokenFor(role)}`).send({});
    expect(res.status).not.toBe(401);
    if (allowed) {
      expect(res.status).not.toBe(403);
    } else {
      expect(res.status).toBe(403);
    }
  });
});

describe('User management hierarchy & self-edit (Phase 0 security fixes)', () => {
  const auth = (role: string) => ({ Authorization: `Bearer ${tokenFor(role)}` });

  it('admin cannot deactivate a manager (same level)', async () => {
    const res = await request(app).put(`/api/admin/users/${userIdOf('manager')}/status`).set(auth('admin')).send({ status: 'inactive' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/cannot manage this user/i);
  });

  it('admin can deactivate an employee', async () => {
    const res = await request(app).put(`/api/admin/users/${userIdOf('employee')}/status`).set(auth('admin')).send({ status: 'inactive' });
    expect(res.status).toBe(200);
  });

  it('nobody can change their own status', async () => {
    const res = await request(app).put(`/api/admin/users/${userIdOf('superadmin')}/status`).set(auth('superadmin')).send({ status: 'inactive' });
    expect(res.status).toBe(403);
  });

  it('admin cannot create a superadmin or a manager', async () => {
    for (const role of ['superadmin', 'manager']) {
      const res = await request(app).post('/api/admin/users').set(auth('admin'))
        .send({ name: 'X', email: `x-${role}@example.com`, password: 'secret123', role });
      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/cannot assign this role/i);
    }
  });

  it('admin can create an employee', async () => {
    db.user.create.mockResolvedValueOnce({ id: 'new-user', name: 'X', email: 'x@example.com' });
    const res = await request(app).post('/api/admin/users').set(auth('admin'))
      .send({ name: 'X', email: 'x@example.com', password: 'secret123', role: 'employee' });
    expect(res.status).toBe(201);
    expect(res.body.user).toMatchObject({ role: 'employee', platform: 'mobile' });
  });

  it('employee editing their own profile cannot change role, status or email', async () => {
    const res = await request(app).put(`/api/profile/${userIdOf('employee')}`).set(auth('employee'))
      .send({ name: 'New Name', role: 'superadmin', status: 'inactive', email: 'hacker@example.com', department: 'X' });
    expect(res.status).toBe(200);
    expect(db.user.update).toHaveBeenCalledWith(expect.objectContaining({ data: { name: 'New Name' } }));
    expect(db.modelHasRole.create).not.toHaveBeenCalled();
  });

  it('employee cannot edit another user', async () => {
    const res = await request(app).put(`/api/profile/${userIdOf('admin')}`).set(auth('employee')).send({ name: 'X' });
    expect(res.status).toBe(403);
  });

  it('employee cannot upload another user avatar', async () => {
    const res = await request(app).post(`/api/profile/${userIdOf('admin')}/avatar`).set(auth('employee')).send({ avatar: 'data:image/png;base64,AAAA' });
    expect(res.status).toBe(403);
  });

  it('report comments require authentication', async () => {
    const res = await request(app).get('/api/comments/r1');
    expect(res.status).toBe(401);
  });

  it('self-registration is removed', async () => {
    const res = await request(app).post('/api/auth/register').send({ name: 'X', email: 'x@example.com', password: 'secret123' });
    expect(res.status).toBe(404);
  });
});

describe('Role management API', () => {
  const auth = { Authorization: `Bearer ${tokenFor('superadmin')}` };

  it('rejects reserved role names', async () => {
    const res = await request(app).post('/api/admin/roles').set(auth).send({ name: 'admin', displayName: 'Admin 2', level: 40 });
    expect(res.status).toBe(422);
  });

  it('rejects a level at or above the actor level', async () => {
    const res = await request(app).post('/api/admin/roles').set(auth).send({ name: 'supervisor', displayName: 'Supervisor', level: 100 });
    expect(res.status).toBe(422);
  });

  it('rejects granting roles.manage', async () => {
    const res = await request(app).post('/api/admin/roles').set(auth)
      .send({ name: 'supervisor', displayName: 'Supervisor', level: 40, permissions: ['roles.manage'] });
    expect(res.status).toBe(422);
  });

  it('creates a role with the badge setting and auto-adds the view permission', async () => {
    const created = { id: 10n, name: 'supervisor', level: 40, platform: 'web' as const, permissions: ['tasks.view', 'tasks.create'] };
    db.role.create.mockResolvedValueOnce({ id: created.id });
    db.permission.findMany.mockResolvedValueOnce([{ id: 1n, name: 'tasks.view' }, { id: 2n, name: 'tasks.create' }]);
    db.role.findUnique.mockImplementation(async ({ where }: any) => {
      if (where?.id === created.id) return { ...roleRow(created), displayName: 'Supervisor', isSystem: false, showTaskBadge: true };
      return null;
    });

    const res = await request(app).post('/api/admin/roles').set(auth)
      .send({ name: 'supervisor', displayName: 'Supervisor', level: 40, permissions: ['tasks.create'], showTaskBadge: true });

    expect(res.status).toBe(201);
    expect(res.body.meta.autoAdded).toEqual(['tasks.view']);
    expect(res.body.data).toMatchObject({ name: 'supervisor', showTaskBadge: true, permissions: ['tasks.view', 'tasks.create'] });
    expect(db.role.create).toHaveBeenCalledWith(expect.objectContaining({
      data: expect.objectContaining({ platform: 'web', isSystem: false, showTaskBadge: true, level: 40 }),
    }));
  });

  it('refuses to edit superadmin or employee permissions', async () => {
    for (const id of ['1', '4']) {
      const res = await request(app).put(`/api/admin/roles/${id}/permissions`).set(auth).send({ permissions: [] });
      expect(res.status).toBe(403);
    }
  });

  it('refuses to delete a system role', async () => {
    const res = await request(app).delete('/api/admin/roles/3').set(auth);
    expect(res.status).toBe(403);
  });

  it('returns 409 when deleting a custom role that still has users', async () => {
    db.role.findUnique.mockImplementationOnce(async () => ({ ...roleRow(ROLES.custom_empty), _count: { modelHasRoles: 2 } }));
    const res = await request(app).delete('/api/admin/roles/5').set(auth);
    expect(res.status).toBe(409);
    expect(res.body.userCount).toBe(2);
  });

  it('assignable roles for an admin exclude superadmin, admin and manager', async () => {
    db.role.findMany.mockResolvedValueOnce(Object.values(ROLES).map(roleRow));
    const res = await request(app).get('/api/admin/roles/assignable').set({ Authorization: `Bearer ${tokenFor('admin')}` });
    expect(res.status).toBe(200);
    expect(res.body.data.map((r: any) => r.name).sort()).toEqual(['analyst', 'custom_empty', 'employee']);
  });
});
