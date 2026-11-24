import { test, expect } from '@playwright/test';
import { setupAuthSession } from './helpers/auth';

const task = (overrides) => ({
  taskId: 'task-x',
  ticketNumber: 'TSK-0001',
  title: 'Task',
  description: '',
  location: 'Yogyakarta',
  status: 'active',
  startTime: '08:00',
  endTime: '17:00',
  takenTasks: [],
  createdBy: null,
  createdByRole: null,
  ...overrides,
});

const TASKS = [
  task({
    taskId: 'task-m', ticketNumber: 'TSK-0001', title: 'Inspeksi oleh Manager',
    createdBy: { id: 'manager-1', name: 'Budi' },
    createdByRole: { name: 'manager', displayName: 'Manager', color: '#0891b2', showBadge: true },
  }),
  task({
    taskId: 'task-a', ticketNumber: 'TSK-0002', title: 'Inspeksi oleh Admin',
    createdBy: { id: 'admin-1', name: 'John' },
    createdByRole: { name: 'admin', displayName: 'Admin', color: '#2563eb', showBadge: false },
  }),
];

const mockTasks = (page) =>
  page.route('**/api/admin/tasks**', (route) => {
    if (route.request().method() !== 'GET') return route.fallback();
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ tasks: TASKS }) });
  });

test.describe('Manager vs Admin access (use-case diagram)', () => {
  test('manager can open Employee Analytics but not Roles & Akses', async ({ page }) => {
    await setupAuthSession(page, 'manager');
    await page.goto('/analytics');

    await expect(page).toHaveURL(/.*analytics/);
    await expect(page.getByRole('link', { name: 'Analytics' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles & Akses' })).toHaveCount(0);

    await page.goto('/roles');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('admin has no Employee Analytics by default', async ({ page }) => {
    await setupAuthSession(page, 'admin');
    await page.goto('/analytics');

    await expect(page).toHaveURL(/.*dashboard/);
    await expect(page.getByRole('link', { name: 'Analytics' })).toHaveCount(0);
    await expect(page.getByRole('link', { name: 'Task' })).toBeVisible();
  });

  test('tasks created by a role with the badge on show "Dibuat oleh Manager"', async ({ page }) => {
    await setupAuthSession(page, 'admin');
    await mockTasks(page);
    await page.goto('/task');

    const managerRow = page.locator('tr', { hasText: 'Inspeksi oleh Manager' });
    const adminRow = page.locator('tr', { hasText: 'Inspeksi oleh Admin' });

    await expect(managerRow.getByText('Dibuat oleh Manager')).toBeVisible();
    await expect(adminRow.getByText(/Dibuat oleh/)).toHaveCount(0);
  });

  test('employee (mobile-only role) cannot use the web dashboard', async ({ page }) => {
    await setupAuthSession(page, 'employee');
    await page.goto('/dashboard');

    await expect(page).toHaveURL(/.*login/);
  });
});
