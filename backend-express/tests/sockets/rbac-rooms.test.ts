import { describe, it, expect, vi, beforeAll, afterAll, beforeEach } from 'vitest';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { AddressInfo } from 'net';
import jwt from 'jsonwebtoken';
import { httpServer, io } from '../../src/app';
import prisma from '../../src/config/database';
import { PERMISSION_ROOMS } from '../../src/sockets';
import { notifyRbacUpdated } from '../../src/rbac/notify';
import { DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';

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

const role = (name: string, level: number, platform: 'web' | 'mobile', permissions: string[]) => ({
  id: BigInt(level), name, guardName: 'web', displayName: name, level, platform, color: null, showTaskBadge: false,
  roleHasPermissions: permissions.map((p) => ({ permission: { name: p } })),
});
const user = (id: string, permissions: string[], r = role('admin', 50, 'web', permissions)) =>
  ({ id, email: `${id}@example.com`, name: id, status: 'active', modelHasRoles: [{ role: r }] });

let USERS: Record<string, any>;
const resetUsers = () => {
  USERS = {
    admin: user('admin', DEFAULT_ROLE_GRANTS.admin),
    viewer: user('viewer', ['dashboard.view'], role('dashboard_only', 40, 'web', ['dashboard.view'])),
    budi: user('budi', [], role('employee', 10, 'mobile', [])),
    rian: user('rian', [], role('employee', 10, 'mobile', [])),
  };
};
resetUsers();

const ASSIGNMENT = { takenTaskId: 'tt-1', userIds: JSON.stringify(['budi']), status: 'in_progress' };
const REPORT = { reportId: 'rep-1', userId: 'budi', takenTask: { userIds: JSON.stringify(['budi']) } };

let port: number;
const clients: ClientSocket[] = [];

const connect = (userId?: string) =>
  new Promise<ClientSocket>((resolve, reject) => {
    const client = Client(`http://localhost:${port}`, {
      transports: ['websocket'],
      ...(userId
        ? { auth: { token: jwt.sign({ userId, email: `${userId}@example.com` }, JWT_SECRET) } }
        : { query: { userId: 'budi' } }), // no token: dev-mode guest pretending to be budi
      forceNew: true,
    });
    clients.push(client);
    client.once('connected', () => resolve(client));
    client.once('connect_error', reject);
  });

/** Resolves with the payload, or `null` if the event does not arrive within `ms` */
const nextEvent = <T = any>(client: ClientSocket, event: string, ms = 400) =>
  new Promise<T | null>((resolve) => {
    const timer = setTimeout(() => { client.off(event, handler); resolve(null); }, ms);
    const handler = (payload: T) => { clearTimeout(timer); resolve(payload); };
    client.once(event, handler);
  });

beforeAll(async () => {
  await new Promise<void>((resolve) => httpServer.listen(0, () => {
    port = (httpServer.address() as AddressInfo).port;
    resolve();
  }));
});

afterAll(async () => {
  clients.forEach((c) => c.connected && c.disconnect());
  await new Promise<void>((resolve) => httpServer.close(() => resolve()));
});

beforeEach(() => {
  vi.clearAllMocks();
  resetUsers();
  db.user.findUnique.mockImplementation(async ({ where }: any) => USERS[where?.id] ?? null);
  db.takenTask.findUnique.mockImplementation(async ({ where }: any) => (where?.takenTaskId === 'tt-1' ? ASSIGNMENT : null));
  db.report.findUnique.mockImplementation(async ({ where }: any) => (where?.reportId === 'rep-1' ? REPORT : null));
  db.chatMessage.create.mockImplementation(async ({ data }: any) => ({ ...data, createdAt: new Date() }));
});

describe('Permission rooms', () => {
  it('only users with monitoring.view_locations receive live location updates', async () => {
    const [admin, viewer, budi] = await Promise.all([connect('admin'), connect('viewer'), connect('budi')]);

    const received = Promise.all([
      nextEvent(admin, 'location:updated'),
      nextEvent(viewer, 'location:updated'),
      nextEvent(budi, 'location:updated'),
    ]);
    io.to(PERMISSION_ROOMS.LOCATIONS).emit('location:updated', { userId: 'budi', latitude: -7.79 });

    const [adminGot, viewerGot, budiGot] = await received;
    expect(adminGot).toMatchObject({ userId: 'budi' });
    expect(viewerGot).toBeNull();
    expect(budiGot).toBeNull();
  });

  it('an unauthenticated (no token) socket joins no permission room', async () => {
    const guest = await connect();
    const received = nextEvent(guest, 'report:new');
    io.to(PERMISSION_ROOMS.REPORTS).emit('report:new', { reportId: 'rep-1' });
    expect(await received).toBeNull();
  });

  it('a permission change takes effect live: rbac:updated is sent and rooms are re-joined', async () => {
    const admin = await connect('admin');

    // Superadmin removes monitoring.view_locations from the admin role
    USERS.admin = user('admin', DEFAULT_ROLE_GRANTS.admin.filter((k) => k !== 'monitoring.view_locations'));
    const updated = nextEvent(admin, 'rbac:updated');
    await notifyRbacUpdated(['admin'], 'role_permissions', '2');
    expect(await updated).toEqual({ reason: 'role_permissions', roleId: '2' });

    const received = nextEvent(admin, 'location:updated');
    io.to(PERMISSION_ROOMS.LOCATIONS).emit('location:updated', { userId: 'budi' });
    expect(await received).toBeNull();

    // ...and still gets the rooms it keeps (reports)
    const stillReports = nextEvent(admin, 'report:new');
    io.to(PERMISSION_ROOMS.REPORTS).emit('report:new', { reportId: 'rep-1' });
    expect(await stillReports).toMatchObject({ reportId: 'rep-1' });
  });

  it('a deactivated user is disconnected when their access is refreshed', async () => {
    const budi = await connect('budi');
    USERS.budi = { ...USERS.budi, status: 'inactive' };
    const disconnected = nextEvent(budi, 'disconnect', 1000);
    await notifyRbacUpdated(['budi'], 'role_assignment');
    expect(await disconnected).not.toBeNull();
  });

  it('location:subscribe requires monitoring.view_locations', async () => {
    const viewer = await connect('viewer');
    const error = nextEvent(viewer, 'error');
    viewer.emit('location:subscribe', { userId: 'budi' });
    expect(await error).toMatchObject({ message: expect.stringMatching(/Unauthorized/) });
  });
});

describe('Forum and chat rooms', () => {
  it('a forum participant can join and receives new comments', async () => {
    const budi = await connect('budi');
    const error = nextEvent(budi, 'forum:error', 300);
    budi.emit('forum:join', { reportId: 'rep-1' });
    expect(await error).toBeNull();

    const received = nextEvent(budi, 'forum:new_comment');
    io.to('forum:rep-1').emit('forum:new_comment', { commentId: 'c1' });
    expect(await received).toMatchObject({ commentId: 'c1' });
  });

  it('a non-participant cannot join the forum room', async () => {
    const rian = await connect('rian');
    const error = nextEvent(rian, 'forum:error');
    rian.emit('forum:join', { reportId: 'rep-1' });
    expect(await error).toMatchObject({ message: expect.stringMatching(/tidak memiliki akses/) });

    const received = nextEvent(rian, 'forum:new_comment');
    io.to('forum:rep-1').emit('forum:new_comment', { commentId: 'c2' });
    expect(await received).toBeNull();
  });

  it('a guest pretending to be a participant (no token) cannot join the forum', async () => {
    const guest = await connect();
    const error = nextEvent(guest, 'forum:error');
    guest.emit('forum:join', { reportId: 'rep-1' });
    expect(await error).not.toBeNull();
  });

  it('an assigned employee can join the chat and send a message as themselves', async () => {
    const budi = await connect('budi');
    budi.emit('chat:join', { takenTaskId: 'tt-1' });
    await new Promise((r) => setTimeout(r, 150));

    const received = nextEvent(budi, 'chat:receive');
    budi.emit('chat:send', { takenTaskId: 'tt-1', message: 'Sudah di lokasi', senderId: 'admin' });
    expect(await received).toMatchObject({ senderId: 'budi', senderRole: 'employee', message: 'Sudah di lokasi' });
    expect(db.chatMessage.create.mock.calls[0][0].data).toMatchObject({ senderId: 'budi', takenTaskId: 'tt-1' });
  });

  it('an employee not on the assignment cannot join its chat', async () => {
    const rian = await connect('rian');
    const error = nextEvent(rian, 'chat:error');
    rian.emit('chat:join', { takenTaskId: 'tt-1' });
    expect(await error).not.toBeNull();
  });
});
