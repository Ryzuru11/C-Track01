import { describe, it, expect, vi, beforeEach } from 'vitest';
import request from 'supertest';
import jwt from 'jsonwebtoken';
import app from '../../src/app';
import prisma from '../../src/config/database';

vi.mock('../../src/config/database', () => {
  return {
    default: {
      user: {
        findUnique: vi.fn(),
        findMany: vi.fn(),
      },
      task: {
        findMany: vi.fn(),
        create: vi.fn(),
        findUnique: vi.fn(),
        update: vi.fn(),
        delete: vi.fn(),
      },
      notification: {
        createMany: vi.fn(),
      },
    },
  };
});

describe('Task API Integration - /api/admin/tasks', () => {
  const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret-key';
  const adminToken = jwt.sign(
    { userId: 'admin-id-123', email: 'admin@example.com', role: 'admin' },
    JWT_SECRET
  );
  const employeeToken = jwt.sign(
    { userId: 'emp-id-456', email: 'emp@example.com', role: 'employee' },
    JWT_SECRET
  );

  const mockAdminUser = {
    id: 'admin-id-123',
    email: 'admin@example.com',
    name: 'Admin Name',
    status: 'active',
    modelHasRoles: [{ role: { name: 'admin' } }],
  };

  const mockEmployeeUser = {
    id: 'emp-id-456',
    email: 'emp@example.com',
    name: 'Employee Name',
    status: 'active',
    modelHasRoles: [{ role: { name: 'employee' } }],
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('GET /api/admin/tasks should return 401 when no token is provided', async () => {
    const res = await request(app).get('/api/admin/tasks');
    expect(res.status).toBe(401);
  });

  it('GET /api/admin/tasks should return 403 when user is an employee', async () => {
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockEmployeeUser);

    const res = await request(app)
      .get('/api/admin/tasks')
      .set('Authorization', `Bearer ${employeeToken}`);

    expect(res.status).toBe(403);
    // Employee is a mobile-only role, so every /admin route rejects it before the permission check
    expect(res.body.message).toMatch(/Web access is not available/i);
  });

  it('GET /api/admin/tasks should return 200 and task list when authorized as admin', async () => {
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockAdminUser);
    (prisma.task.findMany as any).mockResolvedValueOnce([
      {
        taskId: 't-1',
        ticketNumber: 'TSK-0001',
        title: 'Task Alpha',
        location: 'Site A',
        startTime: new Date('1970-01-01T08:00:00Z'),
        endTime: new Date('1970-01-01T17:00:00Z'),
        status: 'active',
        takenTasks: [],
      },
    ]);

    const res = await request(app)
      .get('/api/admin/tasks')
      .set('Authorization', `Bearer ${adminToken}`);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.tasks)).toBe(true);
    expect(res.body.tasks[0]).toHaveProperty('title', 'Task Alpha');
    expect(res.body.tasks[0]).toHaveProperty('ticketNumber', 'TSK-0001');
  });

  it('POST /api/admin/tasks should create a task and return 201', async () => {
    (prisma.user.findUnique as any).mockResolvedValueOnce(mockAdminUser);
    (prisma.task.findMany as any).mockResolvedValueOnce([]); // No existing tickets
    (prisma.task.create as any).mockResolvedValueOnce({
      taskId: 'new-task-id',
      ticketNumber: 'TSK-0001',
      title: 'Tugas Baru Lapangan',
      description: 'Cek sensor IoT',
      location: 'Gedung Lab',
      startTime: new Date('1970-01-01T08:00:00Z'),
      endTime: new Date('1970-01-01T17:00:00Z'),
      status: 'active',
    });
    (prisma.user.findMany as any).mockResolvedValueOnce([]); // Admins for notif

    const res = await request(app)
      .post('/api/admin/tasks')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        title: 'Tugas Baru Lapangan',
        description: 'Cek sensor IoT',
        location: 'Gedung Lab',
        startTime: '08:00',
        endTime: '17:00',
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('task');
    expect(res.body.task).toHaveProperty('title', 'Tugas Baru Lapangan');
    expect(res.body.task).toHaveProperty('ticketNumber', 'TSK-0001');
  });
});
