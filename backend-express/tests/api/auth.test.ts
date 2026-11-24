import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import app from '../../src/app';
import prisma from '../../src/config/database';
import * as authUtils from '../../src/utils/auth';

vi.mock('../../src/config/database', () => {
  return {
    default: {
      user: {
        findUnique: vi.fn(),
        update: vi.fn(),
        create: vi.fn(),
      },
    },
  };
});

describe('Auth API Integration - /api/auth/login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should return 401 when email is not found', async () => {
    (prisma.user.findUnique as any).mockResolvedValueOnce(null);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'unknown@example.com', password: 'password123' });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/Invalid credentials/i);
  });

  it('should return 403 when user account is inactive', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'inactive@example.com',
      password: 'hashedpassword',
      status: 'inactive',
      modelHasRoles: [{ role: { name: 'admin' } }],
    };
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockUser);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'inactive@example.com', password: 'password123' });

    expect(response.status).toBe(403);
    expect(response.body.message).toMatch(/Account is inactive/i);
  });

  it('should return 401 when password does not match', async () => {
    const mockUser = {
      id: 'user-1',
      email: 'user@example.com',
      password: 'hashedpassword',
      status: 'active',
      modelHasRoles: [{ role: { name: 'admin' } }],
    };
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockUser);
    vi.spyOn(authUtils, 'comparePassword').mockResolvedValueOnce(false);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'user@example.com', password: 'wrongpassword' });

    expect(response.status).toBe(401);
    expect(response.body.message).toMatch(/Invalid credentials/i);
  });

  it('should return 200 with token and user details on valid credentials', async () => {
    const mockUser = {
      id: 'user-123',
      name: 'Super Admin',
      email: 'admin@example.com',
      password: 'hashedpassword',
      status: 'active',
      modelHasRoles: [{ role: { name: 'superadmin' } }],
    };
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockUser);
    (prisma.user.update as any).mockResolvedValueOnce({});
    vi.spyOn(authUtils, 'comparePassword').mockResolvedValueOnce(true);

    const response = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@example.com', password: 'correctpassword' });

    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('token');
    expect(response.body.user).toHaveProperty('id', 'user-123');
    expect(response.body.user).toHaveProperty('role', 'superadmin');
    expect(response.body.user).toHaveProperty('platform', 'web');
    expect(response.body.user.permissions).toContain('roles.manage');
  });

  describe('platform rule', () => {
    const userWithRole = (role: string) => ({
      id: `user-${role}`,
      name: role,
      email: `${role}@example.com`,
      password: 'hashedpassword',
      status: 'active',
      modelHasRoles: [{ role: { name: role } }],
    });

    it('blocks an employee from logging in on the web', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(userWithRole('employee'));
      (prisma.user.update as any).mockResolvedValueOnce({});
      vi.spyOn(authUtils, 'comparePassword').mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/auth/login')
        .set('x-client-type', 'web')
        .send({ email: 'employee@example.com', password: 'correctpassword' });

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/Web access is not available/i);
    });

    it('blocks a manager from logging in on mobile', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(userWithRole('manager'));
      (prisma.user.update as any).mockResolvedValueOnce({});
      vi.spyOn(authUtils, 'comparePassword').mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/auth/login')
        .set('x-client-type', 'mobile')
        .send({ email: 'manager@example.com', password: 'correctpassword' });

      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/restricted to employees only/i);
    });

    it('lets an employee log in on mobile', async () => {
      (prisma.user.findUnique as any).mockResolvedValueOnce(userWithRole('employee'));
      (prisma.user.update as any).mockResolvedValueOnce({});
      vi.spyOn(authUtils, 'comparePassword').mockResolvedValueOnce(true);

      const response = await request(app)
        .post('/api/auth/login')
        .set('x-client-type', 'mobile')
        .send({ email: 'employee@example.com', password: 'correctpassword' });

      expect(response.status).toBe(200);
      expect(response.body.user).toMatchObject({ role: 'employee', platform: 'mobile', permissions: [] });
    });
  });
});
