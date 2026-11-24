import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';
import { getLeaderboard } from '../../src/services/leaderboard.service';

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
const T0 = Date.UTC(2026, 9, 21, 1, 0, 0);

const EMPLOYEES = [
  { id: 'budi', name: 'Budi', email: 'budi@example.com', pushToken: null },
  { id: 'siti', name: 'Siti', email: 'siti@example.com', pushToken: null },
  { id: 'rian', name: 'Rian', email: 'rian@example.com', pushToken: null },
];

const assignment = (takenTaskId: string, statuses: Record<string, string>) => ({
  takenTaskId, userStatuses: JSON.stringify(statuses), task: { title: takenTaskId },
});
const loc = (takenTaskId: string, userId: string, lat: number, minutes: number) => ({
  takenTaskId, userId, latitude: lat, longitude: 110.37, recordedAt: new Date(T0 + minutes * 60_000),
});

const seed = ({ takenTasks = [] as any[], reports = [] as any[], locations = [] as any[] } = {}) => {
  db.user.findMany.mockResolvedValueOnce(EMPLOYEES);
  db.takenTask.findMany.mockResolvedValueOnce(takenTasks);
  db.report.findMany.mockResolvedValueOnce(reports);
  db.location.findMany.mockResolvedValueOnce(locations);
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('getLeaderboard', () => {
  it('computes completion, report and activity rates and the weighted behavior score', async () => {
    seed({
      takenTasks: [
        assignment('t1', { budi: 'completed' }),
        assignment('t2', { budi: 'completed' }),
        assignment('t3', { budi: 'in_progress' }),
        assignment('t4', { budi: 'pending' }),
      ],
      reports: [{ userId: 'budi' }],
      // 0.09° latitude ≈ 10 km over 60 minutes on t1
      locations: [loc('t1', 'budi', -7.80, 0), loc('t1', 'budi', -7.71, 60)],
    });

    const [budi] = await getLeaderboard();

    expect(budi).toMatchObject({
      rank: 1, userId: 'budi', name: 'Budi',
      totalTasks: 4, completedTasks: 2, inProgressTasks: 1, pendingTasks: 1,
      totalReports: 1,
      completionRate: 50,   // 2/4
      reportRate: 50,       // 1 report / 2 completed
      activityRate: 50,     // ~10 km * 5
      totalDurationMs: 3_600_000,
    });
    expect(budi.totalDistanceKm).toBeCloseTo(10.01, 1);
    // 50*0.45 + 50*0.35 + 50*0.2 = 50
    expect(budi.behaviorScore).toBe(50);
  });

  it('caps report and activity rates at 100', async () => {
    seed({
      takenTasks: [assignment('t1', { budi: 'completed' })],
      reports: [{ userId: 'budi' }, { userId: 'budi' }, { userId: 'budi' }],
      locations: [loc('t1', 'budi', -7.80, 0), loc('t1', 'budi', -7.50, 90)], // ~33 km
    });

    const [budi] = await getLeaderboard();
    expect(budi.reportRate).toBe(100);
    expect(budi.activityRate).toBe(100);
    expect(budi.behaviorScore).toBe(100);
  });

  it('ranks by behavior score, then by completed tasks on a tie', async () => {
    seed({
      takenTasks: [
        assignment('t1', { budi: 'completed', siti: 'completed', rian: 'pending' }),
        assignment('t2', { siti: 'completed' }),
      ],
      // Both report every completed task → same score (80); Siti completed more
      reports: [{ userId: 'budi' }, { userId: 'siti' }, { userId: 'siti' }],
    });

    const board = await getLeaderboard();

    expect(board.map((e) => [e.rank, e.userId, e.behaviorScore])).toEqual([[1, 'siti', 80], [2, 'budi', 80], [3, 'rian', 0]]);
  });

  it('a lower report rate outweighs more completed tasks', async () => {
    seed({
      takenTasks: [
        assignment('t1', { budi: 'completed', siti: 'completed' }),
        assignment('t2', { siti: 'completed' }),
      ],
      reports: [{ userId: 'budi' }, { userId: 'siti' }], // Siti reported 1 of 2
    });

    const board = await getLeaderboard();

    expect(board.map((e) => [e.userId, e.behaviorScore])).toEqual([['budi', 80], ['siti', 63]]);
  });

  it('ignores users who are not active employees (e.g. deactivated) instead of listing them nameless', async () => {
    seed({
      takenTasks: [assignment('t1', { budi: 'completed', 'former-employee': 'completed' })],
    });

    const board = await getLeaderboard();

    expect(board.map((e) => e.userId)).toEqual(['budi']);
    expect(board.every((e) => e.name)).toBe(true);
  });

  it('only counts distance for assignments with at least two GPS points', async () => {
    seed({
      takenTasks: [assignment('t1', { budi: 'completed' })],
      locations: [loc('t1', 'budi', -7.80, 0)],
    });

    const [budi] = await getLeaderboard();
    expect(budi).toMatchObject({ totalDistanceKm: 0, totalDurationMs: 0, activityRate: 0 });
  });

  it('skips assignments with corrupt status JSON', async () => {
    seed({
      takenTasks: [{ takenTaskId: 'bad', userStatuses: '{oops', task: null }, assignment('t1', { budi: 'pending' })],
    });

    const [budi] = await getLeaderboard();
    expect(budi.totalTasks).toBe(1);
  });
});

describe('GET /api/achievement/me', () => {
  const BUDI_USER = {
    id: 'budi', email: 'budi@example.com', name: 'Budi', status: 'active',
    modelHasRoles: [{ role: { id: 4n, name: 'employee', guardName: 'web', displayName: 'Employee', level: 10, platform: 'mobile', color: null, showTaskBadge: false, roleHasPermissions: [] } }],
  };
  const auth = { Authorization: `Bearer ${jwt.sign({ userId: 'budi', email: BUDI_USER.email }, JWT_SECRET)}` };

  beforeEach(() => {
    db.user.findUnique.mockImplementation(async ({ where }: any) => (where?.id === 'budi' ? BUDI_USER : null));
  });

  it('returns the caller\'s rank and score', async () => {
    seed({ takenTasks: [assignment('t1', { budi: 'completed', siti: 'completed' })], reports: [{ userId: 'siti' }] });

    const res = await request(app).get('/api/achievement/me').set(auth);

    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ rank: 2, name: 'Budi', completedTasks: 1, completionRate: 100 });
  });

  it('returns null when the caller has no assignments yet', async () => {
    seed({ takenTasks: [assignment('t1', { siti: 'completed' })] });
    const res = await request(app).get('/api/achievement/me').set(auth);
    expect(res.body).toEqual({ success: true, data: null });
  });
});
