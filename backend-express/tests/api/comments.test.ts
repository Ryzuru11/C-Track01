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
    get: (_target, prop: string) =>
      prop === '$transaction'
        ? (models.$transaction ??= vi.fn(async (ops: any) => (Array.isArray(ops) ? Promise.all(ops) : ops(client))))
        : model(prop),
  });
  return { default: client };
});

vi.mock('expo-server-sdk', () => {
  class Expo {
    static isExpoPushToken = () => false;
    chunkPushNotifications = () => [];
    sendPushNotificationsAsync = vi.fn(async () => []);
  }
  return { Expo, default: Expo };
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
  budi: user('budi', EMPLOYEE),   // reporter, assigned to tt-1
  siti: user('siti', EMPLOYEE),   // assigned to tt-1
  rian: user('rian', EMPLOYEE),   // not part of this forum
  admin: user('admin', role('admin', 50, 'web', DEFAULT_ROLE_GRANTS.admin)), // monitoring.view_reports
};
const auth = (userId: string) => ({ Authorization: `Bearer ${jwt.sign({ userId, email: `${userId}@example.com` }, JWT_SECRET)}` });

const reportRow = (overrides: Record<string, unknown> = {}) => ({
  reportId: 'rep-1',
  userId: 'budi',
  takenTaskId: 'tt-1',
  report: 'Pekerjaan selesai',
  image: null,
  status: 'OPEN',
  createdAt: new Date('2026-10-21T02:00:00Z'),
  user: { id: 'budi', name: 'budi' },
  takenTask: { takenTaskId: 'tt-1', userIds: JSON.stringify(['budi', 'siti']), status: 'in_progress' },
  ...overrides,
});

let report: any;
let comments: Record<string, any>;

beforeEach(() => {
  vi.clearAllMocks();
  report = reportRow();
  comments = {
    'c-budi': { commentId: 'c-budi', reportId: 'rep-1', userId: 'budi', content: 'Halo', deleted: false },
    'c-deleted': { commentId: 'c-deleted', reportId: 'rep-1', userId: 'budi', content: '', deleted: true },
  };

  // Respect `select` like real Prisma (role ids are BigInt and cannot go through socket.io)
  db.user.findUnique.mockImplementation(async ({ where, select }: any) => {
    const found = USERS[where?.id];
    if (!found) return null;
    if (!select || select.modelHasRoles) return found;
    return Object.fromEntries(Object.keys(select).map((key) => [key, found[key]]));
  });
  db.user.findMany.mockImplementation(async ({ where }: any) => {
    // findUserIdsWithPermission('monitoring.view_reports') → staff
    if (where?.modelHasRoles) return [{ id: 'admin' }];
    const ids: string[] = where?.id?.in ?? [];
    return ids.map((id) => ({ id, name: id, pushToken: null }));
  });
  db.report.findUnique.mockImplementation(async ({ where }: any) => (where?.reportId === report.reportId ? report : null));
  db.comment.findUnique.mockImplementation(async ({ where }: any) => comments[where?.commentId] ?? null);
  db.comment.create.mockImplementation(async ({ data }: any) => ({
    commentId: 'c-new', ...data, user: { id: data.userId, name: data.userId, avatar: null }, reads: [],
  }));
  db.comment.update.mockImplementation(async ({ where, data }: any) => ({ ...comments[where.commentId], ...data, reads: [] }));
});

describe('GET /api/comments/:reportId', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/comments/rep-1')).status).toBe(401);
  });

  it.each(['budi', 'siti', 'admin'])('lets participant %s read the forum', async (userId) => {
    const res = await request(app).get('/api/comments/rep-1').set(auth(userId));
    expect(res.status).toBe(200);
    expect(res.body.participantIds.sort()).toEqual(['admin', 'budi', 'siti']);
    expect(res.body.adminParticipantIds).toEqual(['admin']);
  });

  it('blocks a user who is not part of the forum', async () => {
    const res = await request(app).get('/api/comments/rep-1').set(auth('rian'));
    expect(res.status).toBe(403);
  });

  it('returns 404 for an unknown report', async () => {
    const res = await request(app).get('/api/comments/missing').set(auth('budi'));
    expect(res.status).toBe(404);
  });
});

describe('POST /api/comments', () => {
  it('blocks posting into a forum you are not part of', async () => {
    const res = await request(app).post('/api/comments').set(auth('rian')).send({ reportId: 'rep-1', content: 'spam' });
    expect(res.status).toBe(403);
    expect(db.comment.create).not.toHaveBeenCalled();
  });

  it('requires reportId and content', async () => {
    const res = await request(app).post('/api/comments').set(auth('budi')).send({ reportId: 'rep-1' });
    expect(res.status).toBe(400);
  });

  it('refuses new comments once the report forum is closed', async () => {
    report = reportRow({ status: 'DONE' });
    const res = await request(app).post('/api/comments').set(auth('siti')).send({ reportId: 'rep-1', content: 'telat' });
    expect(res.status).toBe(403);
    expect(res.body.message).toMatch(/ditutup/i);
  });

  it('creates the comment as the logged-in user and notifies everyone else in the forum', async () => {
    const res = await request(app).post('/api/comments').set(auth('siti'))
      .send({ reportId: 'rep-1', content: 'Sudah saya cek', userId: 'budi' });

    expect(res.status).toBe(201);
    expect(db.comment.create.mock.calls[0][0].data).toMatchObject({ reportId: 'rep-1', userId: 'siti', content: 'Sudah saya cek' });

    const recipients = db.notification.createMany.mock.calls[0][0].data.map((n: any) => n.userId).sort();
    expect(recipients).toEqual(['admin', 'budi']); // not the sender
  });

  it('ignores a parentId that does not exist', async () => {
    await request(app).post('/api/comments').set(auth('budi')).send({ reportId: 'rep-1', content: 'balas', parentId: 'ghost' });
    expect(db.comment.create.mock.calls[0][0].data.parentId).toBeNull();
  });

  it('threads a reply under an existing comment', async () => {
    await request(app).post('/api/comments').set(auth('siti')).send({ reportId: 'rep-1', content: 'balas', parentId: 'c-budi' });
    expect(db.comment.create.mock.calls[0][0].data.parentId).toBe('c-budi');
  });
});

describe('PUT / DELETE /api/comments/:commentId', () => {
  it("does not let someone edit another person's comment", async () => {
    const res = await request(app).put('/api/comments/c-budi').set(auth('siti')).send({ content: 'diubah' });
    expect(res.status).toBe(403);
    expect(db.comment.update).not.toHaveBeenCalled();
  });

  it('lets the author edit their comment (trimmed)', async () => {
    const res = await request(app).put('/api/comments/c-budi').set(auth('budi')).send({ content: '  Halo semua  ' });
    expect(res.status).toBe(200);
    expect(db.comment.update.mock.calls[0][0].data.content).toBe('Halo semua');
  });

  it('refuses to edit a deleted comment or with empty content', async () => {
    expect((await request(app).put('/api/comments/c-deleted').set(auth('budi')).send({ content: 'x' })).status).toBe(400);
    expect((await request(app).put('/api/comments/c-budi').set(auth('budi')).send({ content: '   ' })).status).toBe(400);
  });

  it("does not let someone delete another person's comment", async () => {
    const res = await request(app).delete('/api/comments/c-budi').set(auth('admin'));
    expect(res.status).toBe(403);
  });

  it('soft-deletes: content and image are cleared, the row stays', async () => {
    const res = await request(app).delete('/api/comments/c-budi').set(auth('budi'));
    expect(res.status).toBe(200);
    expect(db.comment.update.mock.calls[0][0].data).toMatchObject({ deleted: true, content: '', image: null });
    expect(db.comment.delete).not.toHaveBeenCalled();
  });
});

describe('POST /api/comments/typing and /read', () => {
  it.each(['/api/comments/typing', '/api/comments/read'])('%s is only for forum participants', async (path) => {
    expect((await request(app).post(path).set(auth('rian')).send({ reportId: 'rep-1', isTyping: true })).status).toBe(403);
    expect((await request(app).post(path).set(auth('siti')).send({ reportId: 'rep-1', isTyping: true })).status).toBe(200);
  });

  it('marks other people\'s comments as read for the caller', async () => {
    db.comment.findMany.mockResolvedValueOnce([{ commentId: 'c-budi' }]);
    const res = await request(app).post('/api/comments/read').set(auth('siti')).send({ reportId: 'rep-1' });
    expect(res.body).toEqual({ marked: 1 });
    expect(db.commentRead.upsert.mock.calls[0][0].create).toMatchObject({ commentId: 'c-budi', userId: 'siti' });
  });
});
