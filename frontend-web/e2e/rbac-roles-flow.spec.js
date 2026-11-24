import { test, expect } from '@playwright/test';
import { setupAuthSession, ROLE_SESSIONS } from './helpers/auth';

// Minimal permission catalog (same shape as GET /api/admin/permissions)
const CATALOG = {
  modules: [
    {
      module: 'dashboard',
      label: 'Dashboard Overview',
      permissions: [{ key: 'dashboard.view', label: 'Lihat Dashboard Overview', description: '', isBase: true }],
    },
    {
      module: 'tasks',
      label: 'Task Management',
      permissions: [
        { key: 'tasks.view', label: 'Lihat task', description: '', isBase: true },
        { key: 'tasks.create', label: 'Buat task', description: '', requires: ['tasks.view'] },
        { key: 'tasks.update', label: 'Ubah task', description: '', requires: ['tasks.view'] },
        { key: 'tasks.delete', label: 'Hapus task', description: '', requires: ['tasks.view'] },
      ],
    },
    {
      module: 'roles',
      label: 'Roles & Hak Akses',
      permissions: [{ key: 'roles.manage', label: 'Kelola role & hak akses', description: '', locked: true }],
    },
  ],
};

const role = (overrides) => ({
  description: null,
  platform: 'web',
  isSystem: true,
  color: '#2563eb',
  showTaskBadge: false,
  userCount: 1,
  permissions: [],
  editable: { permissions: true, details: true, showTaskBadge: true, name: false, level: false, delete: false },
  ...overrides,
});

const ROLES = [
  role({ id: '1', name: 'superadmin', displayName: 'Superadmin', level: 100, color: '#7c3aed', permissions: ROLE_SESSIONS.superadmin.permissions,
    editable: { permissions: false, details: false, showTaskBadge: false, name: false, level: false, delete: false } }),
  role({ id: '2', name: 'admin', displayName: 'Admin', level: 50, permissions: ROLE_SESSIONS.admin.permissions }),
  role({ id: '3', name: 'manager', displayName: 'Manager', level: 50, color: '#0891b2', showTaskBadge: true, permissions: ROLE_SESSIONS.manager.permissions }),
  role({ id: '4', name: 'employee', displayName: 'Employee', level: 10, platform: 'mobile', color: '#db2777', userCount: 8,
    editable: { permissions: false, details: false, showTaskBadge: false, name: false, level: false, delete: false } }),
];

test.describe('RBAC: Roles & Akses dashboard (superadmin)', () => {
  let createdRoleBody = null;

  test.beforeEach(async ({ page }) => {
    createdRoleBody = null;
    await setupAuthSession(page, 'superadmin');

    await page.route('**/api/admin/permissions', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(CATALOG) }));

    // List + create (exact /admin/roles path, with or without query string)
    await page.route(/\/api\/admin\/roles(\?.*)?$/, async (route) => {
      if (route.request().method() === 'POST') {
        createdRoleBody = route.request().postDataJSON();
        const created = role({ id: '10', isSystem: false, userCount: 0, ...createdRoleBody });
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({ data: created, meta: { autoAdded: ['tasks.view'] } }),
        });
      }
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ data: ROLES }) });
    });
  });

  test('shows system roles and the Roles & Akses menu', async ({ page }) => {
    await page.goto('/roles');

    await expect(page.getByRole('heading', { name: /Roles & Hak Akses/i })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Roles & Akses' })).toBeVisible();
    for (const name of ['Superadmin', 'Admin', 'Manager', 'Employee']) {
      await expect(page.getByRole('button', { name: new RegExp(`role ${name}$`) }).first()).toBeVisible();
    }
  });

  test('creates a role with the task badge and auto-ticks "Lihat" when an action is ticked', async ({ page }) => {
    await page.goto('/roles');
    await page.getByRole('button', { name: /Buat Role Baru/i }).click();

    // Detail tab: display name auto-generates the role code
    await page.getByLabel(/Nama tampilan/i).fill('Supervisor Lapangan');
    await expect(page.getByLabel('Kode role')).toHaveValue('supervisor_lapangan');
    await page.getByLabel(/Tampilkan badge pada task/i).check();
    await expect(page.getByText('Dibuat oleh Supervisor Lapangan').first()).toBeVisible();

    // Permission matrix: ticking "Buat" also ticks "Lihat" (include Read)
    await page.getByRole('tab', { name: 'Hak Akses' }).click();
    const viewTasks = page.getByLabel('Task Management — Lihat');
    await expect(viewTasks).not.toBeChecked();
    await page.getByLabel('Task Management — Buat').check();
    await expect(viewTasks).toBeChecked();

    await page.getByRole('button', { name: 'Buat Role', exact: true }).click();

    await expect.poll(() => createdRoleBody).not.toBeNull();
    expect(createdRoleBody).toMatchObject({
      name: 'supervisor_lapangan',
      displayName: 'Supervisor Lapangan',
      showTaskBadge: true,
    });
    expect(createdRoleBody.permissions).toEqual(expect.arrayContaining(['tasks.view', 'tasks.create']));
    expect(createdRoleBody.permissions).not.toContain('roles.manage');
  });

  test('opens superadmin read-only (always has every permission)', async ({ page }) => {
    await page.goto('/roles');
    await page.getByRole('button', { name: 'Lihat role Superadmin' }).click();

    await expect(page.getByText(/selalu memiliki semua akses/i).first()).toBeVisible();
    await page.getByRole('tab', { name: 'Hak Akses' }).click();
    await expect(page.getByLabel('Task Management — Buat')).toBeDisabled();
  });
});

test.describe('RBAC: a custom role only sees what it was granted', () => {
  const supervisor = {
    id: 'supervisor-e2e-id',
    name: 'Supervisor E2E',
    email: 'supervisor.e2e@example.com',
    role: 'supervisor',
    roleDisplayName: 'Supervisor',
    roleLevel: 40,
    roleColor: '#16a34a',
    platform: 'web',
    permissions: ['dashboard.view', 'tasks.view'],
  };

  test('sidebar shows only permitted pages', async ({ page }) => {
    await setupAuthSession(page, supervisor);
    await page.goto('/dashboard');

    await expect(page.getByRole('link', { name: 'Dashboard' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Task' })).toBeVisible();
    for (const hidden of ['Analytics', 'Taken', 'Users', 'Teams', 'Roles & Akses', 'AI Assistant']) {
      await expect(page.getByRole('link', { name: hidden })).toHaveCount(0);
    }
  });

  test('a page without permission redirects to the first allowed page', async ({ page }) => {
    await setupAuthSession(page, supervisor);

    await page.goto('/users');
    await expect(page).toHaveURL(/.*dashboard/);

    await page.goto('/roles');
    await expect(page).toHaveURL(/.*dashboard/);
  });

  test('read-only task access hides the create and upload buttons', async ({ page }) => {
    await setupAuthSession(page, supervisor);
    await page.goto('/task');

    await expect(page).toHaveURL(/.*task/);
    await expect(page.getByRole('button', { name: /Create Task/i })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /Upload Task/i })).toHaveCount(0);
  });

  test('granting tasks.create shows the create button (control)', async ({ page }) => {
    await setupAuthSession(page, { ...supervisor, permissions: [...supervisor.permissions, 'tasks.create'] });
    await page.goto('/task');

    await expect(page.getByRole('button', { name: /Create Task/i })).toBeVisible();
    await expect(page.getByRole('button', { name: /Upload Task/i })).toHaveCount(0);
  });
});
