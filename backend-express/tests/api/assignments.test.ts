import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';
import * as notifications from '../../src/utils/notifications';

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

// Push notifications, leaderboard and Expo are side effects outside this test's scope
vi.mock('../../src/utils/notifications', () => ({
  sendTaskAssignmentNotification: vi.fn(async () => undefined),
  sendTaskCompletionNotification: vi.fn(async () => undefined),
  sendPartialCompletionNotification: vi.fn(async () => undefined),
  sendColleagueCompletionNotification: vi.fn(async () => undefined),
  sendTaskStatusNotification: vi.fn(async () => undefined),
  sendNotificationToUser: vi.fn(async () => undefined),
  sendNotificationToUsers: vi.fn(async () => undefined),
}));
vi.mock('../../src/utils/achievementHandler', () => ({
  checkLeaderboardAchievement: vi.fn(async () => undefined),
}));
vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken = () => false;
    chunkPushNotifications = (messages: unknown[]) => (messages.length ? [messages] : []);
    sendPushNotificationsAsync = vi.fn(async () => []);
  }
  return { Expo, default: Expo };
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const db = prisma as any;

const ADMIN_ID = 'user-admin';
const role = (name: string, level: number, platform: 'web' | 'mobile', permissions: string[]) => ({
  id: BigInt(level),
  name,
  guardName: 'web',
  displayName: name,
  level,
  platform,
  color: null,
  showTaskBadge: false,
  roleHasPermissions: permissions.map((p) => ({ permission: { name: p } })),
});
const ADMIN_ROLE = role('admin', 50, 'web', DEFAULT_ROLE_GRANTS.admin);
const EMPLOYEE_ROLE = role('employee', 10, 'mobile', []);

const USERS: Record<string, any> = {
  [ADMIN_ID]: { id: ADMIN_ID, email: 'admin@example.com', name: 'Admin', status: 'active', modelHasRoles: [{ role: ADMIN_ROLE }] },
  e1: { id: 'e1', email: 'e1@example.com', name: 'Budi', status: 'active', modelHasRoles: [{ role: EMPLOYEE_ROLE }] },
  e2: { id: 'e2', email: 'e2@example.com', name: 'Siti', status: 'active', modelHasRoles: [{ role: EMPLOYEE_ROLE }] },
  e3: { id: 'e3', email: 'e3@example.com', name: 'Rian', status: 'active', modelHasRoles: [{ role: EMPLOYEE_ROLE }] },
};

const tokenFor = (userId: string) => jwt.sign({ userId, email: USERS[userId].email }, JWT_SECRET);
const asAdmin = { Authorization: `Bearer ${tokenFor(ADMIN_ID)}` };
const asEmployee = (id: string) => ({ Authorization: `Bearer ${tokenFor(id)}` });

const TASK = { taskId: 'task-1', title: 'Inspeksi Tower A', createdByRoleName: null, createdBy: null };

/** Assignment row as stored in the DB (JSON string columns) */
const assignmentRow = (overrides: Record<string, unknown> = {}) => ({
  takenTaskId: 'tt-1',
  ticketNumber: 'ASN-0007',
  taskId: TASK.taskId,
  teamId: null,
  userIds: JSON.stringify(['e1', 'e2']),
  userStatuses: JSON.stringify({ e1: 'pending', e2: 'pending' }),
  status: 'pending',
  startTime: null,
  endTime: null,
  date: null,
  task: TASK,
  ...overrides,
});

/** Make takenTask.update echo the written data merged onto `base` */
const echoUpdate = (base: Record<string, unknown>) =>
  db.takenTask.update.mockImplementation(async ({ data }: any) => ({ ...base, ...data, task: TASK }));

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where?.id] ?? null);
  db.user.findMany.mockImplementation(async ({ where }: any) => {
    // findUsersWithPermission (notification recipients) filters on roles
    if (where?.modelHasRoles) return [{ id: ADMIN_ID, name: 'Admin', pushToken: null }];
    const ids: string[] = where?.id?.in ?? [];
    return ids.filter((id) => USERS[id]).map((id) => ({ id, name: USERS[id].name, email: USERS[id].email, pushToken: null }));
  });
  db.role.findMany.mockResolvedValue([]);
});

describe('POST /api/admin/assignments (assignTask)', () => {
  beforeEach(() => {
    db.task.findUnique.mockResolvedValue(TASK);
    db.takenTask.findFirst.mockResolvedValue({ ticketNumber: 'ASN-0006' });
    db.takenTask.create.mockImplementation(async ({ data }: any) => ({ ...data, task: TASK }));
  });

  it('rejects an assignment without users or team', async () => {
    const res = await request(app).post('/api/admin/assignments').set(asAdmin).send({ taskId: TASK.taskId, userIds: [] });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/At least one user/i);
    expect(db.takenTask.create).not.toHaveBeenCalled();
  });

  it('merges explicit users with team members without duplicates, all starting as pending', async () => {
    db.team.findUnique.mockResolvedValueOnce({ id: 'team-1', users: [{ id: 'e1' }, { id: 'e2' }] });

    const res = await request(app).post('/api/admin/assignments').set(asAdmin)
      .send({ taskId: TASK.taskId, userIds: ['e1'], teamId: 'team-1' });

    expect(res.status).toBe(201);
    const { data } = db.takenTask.create.mock.calls[0][0];
    expect(JSON.parse(data.userIds)).toEqual(['e1', 'e2']);
    expect(JSON.parse(data.userStatuses)).toEqual({ e1: 'pending', e2: 'pending' });
    expect(data.teamId).toBe('team-1');
    expect(data.ticketNumber).toBe('ASN-0007');
    expect(res.body.takenTask.userIds).toEqual(['e1', 'e2']);
  });

  it('returns 404 when the team does not exist', async () => {
    db.team.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/admin/assignments').set(asAdmin)
      .send({ taskId: TASK.taskId, userIds: ['e1'], teamId: 'missing' });
    expect(res.status).toBe(404);
  });

  it('returns 404 when the task does not exist', async () => {
    db.task.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).post('/api/admin/assignments').set(asAdmin).send({ taskId: 'missing', userIds: ['e1'] });
    expect(res.status).toBe(404);
    expect(db.takenTask.create).not.toHaveBeenCalled();
  });

  it('notifies every assigned employee in-app', async () => {
    await request(app).post('/api/admin/assignments').set(asAdmin).send({ taskId: TASK.taskId, userIds: ['e1', 'e2'] });
    const { data } = db.notification.createMany.mock.calls[0][0];
    expect(data.map((n: any) => n.userId)).toEqual(['e1', 'e2']);
  });
});

describe('PUT /api/admin/assignments/:id (updateAssignment)', () => {
  it('returns 404 for an unknown assignment', async () => {
    db.takenTask.findUnique.mockResolvedValueOnce(null);
    const res = await request(app).put('/api/admin/assignments/missing').set(asAdmin).send({ userIds: ['e1'] });
    expect(res.status).toBe(404);
  });

  it('refuses to change a completed assignment', async () => {
    db.takenTask.findUnique.mockResolvedValueOnce(assignmentRow({ status: 'completed' }));
    const res = await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ userIds: ['e1'] });
    expect(res.status).toBe(409);
    expect(db.takenTask.update).not.toHaveBeenCalled();
  });

  it('keeps retained users\' progress, adds new users as pending and drops removed users', async () => {
    const existing = assignmentRow({
      status: 'in_progress',
      userStatuses: JSON.stringify({ e1: 'in_progress', e2: 'pending' }),
    });
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    const res = await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ userIds: ['e1', 'e3'] });

    expect(res.status).toBe(200);
    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(JSON.parse(data.userIds)).toEqual(['e1', 'e3']);
    expect(JSON.parse(data.userStatuses)).toEqual({ e1: 'in_progress', e3: 'pending' });
    expect(res.body.takenTask.users.map((u: any) => u.id)).toEqual(['e1', 'e3']);
  });

  it('only notifies employees who were newly added', async () => {
    const existing = assignmentRow();
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ userIds: ['e1', 'e2', 'e3'] });

    expect(db.notification.createMany).toHaveBeenCalledTimes(1);
    const { data } = db.notification.createMany.mock.calls[0][0];
    expect(data.map((n: any) => n.userId)).toEqual(['e3']);
  });

  it('changing only the date leaves the assigned users untouched and sends no notification', async () => {
    const existing = assignmentRow();
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    const res = await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ date: '2026-11-01' });

    expect(res.status).toBe(200);
    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(data).not.toHaveProperty('userIds');
    expect(data).not.toHaveProperty('userStatuses');
    expect(data.date).toEqual(new Date('2026-11-01'));
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('rejects removing every user', async () => {
    db.takenTask.findUnique.mockResolvedValueOnce(assignmentRow());
    const res = await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ userIds: [] });
    expect(res.status).toBe(400);
    expect(db.takenTask.update).not.toHaveBeenCalled();
  });

  it('adds team members to the current users when only a team is given', async () => {
    const existing = assignmentRow({ userIds: JSON.stringify(['e1']), userStatuses: JSON.stringify({ e1: 'pending' }) });
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    db.team.findUnique.mockResolvedValueOnce({ id: 'team-2', users: [{ id: 'e3' }] });
    echoUpdate(existing);

    const res = await request(app).put('/api/admin/assignments/tt-1').set(asAdmin).send({ teamId: 'team-2' });

    expect(res.status).toBe(200);
    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(JSON.parse(data.userIds)).toEqual(['e1', 'e3']);
    expect(data.teamId).toBe('team-2');
  });
});

describe('PATCH /api/my-tasks/:id/status (updateTakenTaskStatus)', () => {
  it('requires a status', async () => {
    const res = await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({});
    expect(res.status).toBe(400);
  });

  it.each(['selesai', 'cancelled', 'COMPLETED', 'abc'])('rejects an unknown status value: %s', async (status) => {
    const res = await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/Status must be one of/);
    expect(db.takenTask.update).not.toHaveBeenCalled();
  });

  it('rejects an employee who is not assigned to the task', async () => {
    db.takenTask.findUnique.mockResolvedValueOnce(assignmentRow());
    const res = await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e3')).send({ status: 'in_progress' });
    expect(res.status).toBe(400);
    expect(res.body.message).toMatch(/not assigned/i);
    expect(db.takenTask.update).not.toHaveBeenCalled();
  });

  it('only changes the caller\'s own status', async () => {
    const existing = assignmentRow();
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status: 'in_progress' });

    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(JSON.parse(data.userStatuses)).toEqual({ e1: 'in_progress', e2: 'pending' });
  });

  it('starting work moves the assignment to in_progress and records the start time once', async () => {
    const existing = assignmentRow();
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status: 'in_progress' });

    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(data.status).toBe('in_progress');
    expect(data.startTime).toBeInstanceOf(Date);
  });

  it('does not overwrite an existing start time', async () => {
    const existing = assignmentRow({ status: 'in_progress', startTime: new Date('2026-10-20T01:00:00Z'), userStatuses: JSON.stringify({ e1: 'pending', e2: 'in_progress' }) });
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status: 'in_progress' });

    expect(db.takenTask.update.mock.calls[0][0].data).not.toHaveProperty('startTime');
  });

  it('a partial completion keeps the assignment open and notifies teammates, not admins', async () => {
    const existing = assignmentRow({ status: 'in_progress', userStatuses: JSON.stringify({ e1: 'in_progress', e2: 'in_progress' }) });
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    const res = await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status: 'completed' });

    expect(res.status).toBe(200);
    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(data.status).toBe('in_progress');
    expect(notifications.sendPartialCompletionNotification).toHaveBeenCalledWith('e1', TASK.title, 'tt-1');
    expect(notifications.sendColleagueCompletionNotification).toHaveBeenCalledWith(['e2'], 'Budi', TASK.title, 'tt-1');
    expect(notifications.sendTaskCompletionNotification).not.toHaveBeenCalled();
    expect(db.notification.createMany).not.toHaveBeenCalled();
  });

  it('the last completion closes the assignment and notifies staff with assignments.view', async () => {
    const existing = assignmentRow({ status: 'in_progress', userStatuses: JSON.stringify({ e1: 'in_progress', e2: 'completed' }) });
    db.takenTask.findUnique.mockResolvedValueOnce(existing);
    echoUpdate(existing);

    const res = await request(app).patch('/api/my-tasks/tt-1/status').set(asEmployee('e1')).send({ status: 'completed' });

    expect(res.status).toBe(200);
    const { data } = db.takenTask.update.mock.calls[0][0];
    expect(data.status).toBe('completed');
    expect(data.endTime).toBeInstanceOf(Date);
    expect(notifications.sendTaskCompletionNotification).toHaveBeenCalledWith(['e1', 'e2'], TASK.title, 'tt-1');

    const { data: staffNotifications } = db.notification.createMany.mock.calls[0][0];
    expect(staffNotifications).toEqual([expect.objectContaining({ userId: ADMIN_ID, category: 'TASK_COMPLETED', relatedId: 'tt-1' })]);
    // Recipients are resolved by permission, not by role name
    const recipientQuery = db.user.findMany.mock.calls.find(([args]: any[]) => args?.where?.modelHasRoles)?.[0];
    expect(JSON.stringify(recipientQuery.where)).toContain('assignments.view');
  });
});
