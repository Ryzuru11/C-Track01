import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';

// Every prisma model/method is an auto-created mock: findMany → [], everything else → null.
vi.mock('../../src/config/database', () => {
  const models: Record<string, any> = {};
  const model = (name: string) =>
    (models[name] ??= new Proxy({} as Record<string, any>, {
      get: (target, method: string) =>
        (target[method] ??= vi.fn(async () => (method === 'findMany' ? [] : null))),
    }));
  return { default: new Proxy({}, { get: (_t, prop: string) => model(prop) }) };
});

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
const db = prisma as any;

const BUDI = {
  id: 'budi', email: 'budi@example.com', name: 'Budi', status: 'active',
  modelHasRoles: [{ role: { id: 4n, name: 'employee', guardName: 'web', displayName: 'Employee', level: 10, platform: 'mobile', color: null, showTaskBadge: false, roleHasPermissions: [] } }],
};
const auth = { Authorization: `Bearer ${jwt.sign({ userId: 'budi', email: BUDI.email }, JWT_SECRET)}` };

beforeEach(() => {
  vi.clearAllMocks();
  db.user.findUnique.mockImplementation(async ({ where }: any) => (where?.id === 'budi' ? BUDI : null));
});

describe('Notifications', () => {
  it('requires login', async () => {
    expect((await request(app).get('/api/notifications')).status).toBe(401);
  });

  it('lists only the caller\'s notifications, newest first', async () => {
    db.notification.findMany.mockResolvedValueOnce([{ id: 'n2' }, { id: 'n1' }]);
    const res = await request(app).get('/api/notifications').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.map((n: any) => n.id)).toEqual(['n2', 'n1']);
    expect(db.notification.findMany).toHaveBeenCalledWith({ where: { userId: 'budi' }, orderBy: { createdAt: 'desc' } });
  });

  it('counts only the caller\'s unread notifications', async () => {
    db.notification.count.mockResolvedValueOnce(3);
    const res = await request(app).get('/api/notifications/unread-count').set(auth);
    expect(res.body).toEqual({ unreadCount: 3 });
    expect(db.notification.count).toHaveBeenCalledWith({ where: { userId: 'budi', isRead: false } });
  });

  it('marks the caller\'s own notification as read', async () => {
    db.notification.findFirst.mockResolvedValueOnce({ id: 'n1', userId: 'budi' });
    db.notification.update.mockResolvedValueOnce({ id: 'n1', isRead: true });

    const res = await request(app).patch('/api/notifications/n1/read').set(auth);

    expect(res.status).toBe(200);
    expect(db.notification.findFirst).toHaveBeenCalledWith({ where: { id: 'n1', userId: 'budi' } });
    expect(db.notification.update).toHaveBeenCalledWith({ where: { id: 'n1' }, data: { isRead: true } });
  });

  it('cannot mark someone else\'s notification (404, nothing updated)', async () => {
    db.notification.findFirst.mockResolvedValueOnce(null);
    const res = await request(app).patch('/api/notifications/n-other/read').set(auth);
    expect(res.status).toBe(404);
    expect(db.notification.update).not.toHaveBeenCalled();
  });

  it('delete all only deletes the caller\'s notifications', async () => {
    db.notification.deleteMany.mockResolvedValueOnce({ count: 4 });
    const res = await request(app).delete('/api/notifications/all').set(auth);
    expect(res.body).toMatchObject({ count: 4 });
    expect(db.notification.deleteMany).toHaveBeenCalledWith({ where: { userId: 'budi' } });
  });
});
