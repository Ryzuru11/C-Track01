/**
 * RBAC v2 permission catalog (mirror of backend-express/src/rbac/permissions.ts)
 */
export const ALL_PERMISSIONS = [
  'dashboard.view', 'analytics.view',
  'tasks.view', 'tasks.create', 'tasks.update', 'tasks.delete', 'tasks.toggle_status', 'tasks.import', 'tasks.export',
  'assignments.view', 'assignments.create', 'assignments.update', 'assignments.delete',
  'monitoring.view_reports', 'monitoring.view_locations', 'monitoring.manage_reports',
  'users.view', 'users.create', 'users.update', 'users.delete', 'users.toggle_status',
  'teams.view', 'teams.create', 'teams.update', 'teams.delete',
  'ai.use', 'roles.manage',
];

const ADMIN_PERMISSIONS = ALL_PERMISSIONS.filter(
  (key) => !['analytics.view', 'users.delete', 'roles.manage'].includes(key)
);

/** Default grants per system role (docs/rbac/03-permission-matrix.md §1) */
export const ROLE_SESSIONS = {
  superadmin: {
    id: 'admin-e2e-id', name: 'Super Admin E2E', email: 'admin.e2e@example.com',
    role: 'superadmin', roleDisplayName: 'Superadmin', roleLevel: 100, roleColor: '#7c3aed',
    platform: 'web', permissions: ALL_PERMISSIONS,
  },
  admin: {
    id: 'admin2-e2e-id', name: 'Admin E2E', email: 'admin2.e2e@example.com',
    role: 'admin', roleDisplayName: 'Admin', roleLevel: 50, roleColor: '#2563eb',
    platform: 'web', permissions: ADMIN_PERMISSIONS,
  },
  manager: {
    id: 'manager-e2e-id', name: 'Manager E2E', email: 'manager.e2e@example.com',
    role: 'manager', roleDisplayName: 'Manager', roleLevel: 50, roleColor: '#0891b2',
    platform: 'web', permissions: [...ADMIN_PERMISSIONS, 'analytics.view'],
  },
  employee: {
    id: 'employee-e2e-id', name: 'Employee E2E', email: 'employee.e2e@example.com',
    role: 'employee', roleDisplayName: 'Employee', roleLevel: 10, roleColor: '#db2777',
    platform: 'mobile', permissions: [],
  },
};

/**
 * Helper to setup authenticated session for Playwright tests.
 * @param {import('@playwright/test').Page} page
 * @param {string|Object|null} roleOrUser - 'superadmin' (default) | 'admin' | 'manager' | 'employee',
 *   or a custom user object (missing `platform` / `permissions` default to the superadmin's)
 */
export const setupAuthSession = async (page, roleOrUser = null) => {
  const base = ROLE_SESSIONS.superadmin;
  const user = typeof roleOrUser === 'string'
    ? (ROLE_SESSIONS[roleOrUser] || base)
    : { platform: base.platform, permissions: base.permissions, ...(roleOrUser || base) };

  await page.addInitScript(({ mockUser }) => {
    localStorage.setItem('token', 'e2e-mock-jwt-token-xyz');
    localStorage.setItem('user', JSON.stringify(mockUser));
    localStorage.setItem('userId', mockUser.id);
    localStorage.setItem('isAuthenticated', 'true');
    // Set expiry far into the future (e.g. 24 hours from now)
    localStorage.setItem('sessionExpiry', (Date.now() + 86400000).toString());
  }, { mockUser: user });

  // Mock global fallback for all API requests to prevent 401 unauthenticated redirect
  await page.route('**/api/**', async (route) => {
    const url = route.request().url();
    const method = route.request().method();

    if (url.includes('/auth/me') || url.includes('/users/profile')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user }) });
    }
    if (url.includes('/users/avatar')) {
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ avatar: null }) });
    }
    if (url.includes('/tasks') || url.includes('/admin/tasks')) {
      if (method === 'POST') {
        const body = route.request().postDataJSON() || {};
        return route.fulfill({
          status: 201,
          contentType: 'application/json',
          body: JSON.stringify({
            task: {
              taskId: 'task-new-1',
              ticketNumber: 'TSK-0099',
              title: body.title || 'New Task',
              description: body.description || '',
              location: body.location || '',
              status: 'active',
              startTime: body.startTime || '08:00',
              endTime: body.endTime || '17:00',
            },
          }),
        });
      }
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          tasks: [
            {
              taskId: 'task-101',
              ticketNumber: 'TSK-0001',
              title: 'Pemeriksaan Rutin Tower A',
              description: 'Pengecekan perangkat keras dan kabel transmisi',
              location: 'Gedung Cyber 1 Lt. 5',
              status: 'active',
              startTime: '08:00',
              endTime: '17:00',
              takenTasks: [],
            },
          ],
        }),
      });
    }
    if (url.includes('/assignments') || url.includes('/taken')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          takenTasks: [
            {
              id: 'taken-1',
              taskId: 'task-101',
              ticketNumber: 'TSK-0001',
              title: 'Pemeriksaan Rutin Tower A',
              status: 'in_progress',
              location: 'Gedung Cyber 1 Lt. 5',
              date: '2026-10-13',
              users: [{ id: 'u1', name: 'Budi Santoso', email: 'budi@example.com' }],
              userStatuses: { u1: 'in_progress' },
              task: {
                taskId: 'task-101',
                title: 'Pemeriksaan Rutin Tower A',
                location: 'Gedung Cyber 1 Lt. 5',
              },
            },
          ],
          assignment: {
            id: 'taken-1',
            taskId: 'task-101',
            ticketNumber: 'TSK-0001',
            title: 'Pemeriksaan Rutin Tower A',
            status: 'in_progress',
            location: 'Gedung Cyber 1 Lt. 5',
            date: '2026-10-13',
            users: [{ id: 'u1', name: 'Budi Santoso', email: 'budi@example.com' }],
            task: {
              taskId: 'task-101',
              title: 'Pemeriksaan Rutin Tower A',
              location: 'Gedung Cyber 1 Lt. 5',
            },
          },
          takenTask: {
            id: 'taken-1',
            taskId: 'task-101',
            ticketNumber: 'TSK-0001',
            title: 'Pemeriksaan Rutin Tower A',
            status: 'in_progress',
            location: 'Gedung Cyber 1 Lt. 5',
            date: '2026-10-13',
            users: [{ id: 'u1', name: 'Budi Santoso', email: 'budi@example.com' }],
            task: {
              taskId: 'task-101',
              title: 'Pemeriksaan Rutin Tower A',
              location: 'Gedung Cyber 1 Lt. 5',
            },
          },
        }),
      });
    }
    if (url.includes('/users')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          users: [
            { id: 'u-1', name: 'Ahmad Dahlan', email: 'ahmad@example.com', role: 'superadmin', status: 'active' },
            { id: 'u-2', name: 'Siti Aminah', email: 'siti@example.com', role: 'admin', status: 'active' },
          ],
        }),
      });
    }
    if (url.includes('/teams')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          teams: [
            { id: 'team-1', name: 'Alpha Response Team', description: 'Tim Cepat', status: 'active', members: [] },
          ],
        }),
      });
    }
    if (url.includes('/reports')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ reports: [] }),
      });
    }
    if (url.includes('/locations')) {
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ locations: [], current_locations: [] }),
      });
    }

    // Default 200 fallback
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({}),
    });
  });
};
