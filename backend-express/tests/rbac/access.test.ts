import { describe, it, expect, vi, beforeEach } from 'vitest';
import prisma from '../../src/config/database';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_GRANTS,
  PERMISSION_DEFINITIONS,
  getPermissionCatalog,
  withRequiredPermissions,
} from '../../src/rbac/permissions';
import { can, canAssignRole, canManageUser, resolveRoleAccess } from '../../src/rbac/access';
import { attachTaskCreators } from '../../src/rbac/taskCreator';

vi.mock('../../src/config/database', () => ({
  default: {
    role: { findMany: vi.fn() },
  },
}));

describe('RBAC permission catalog', () => {
  it('has 27 unique module.action keys', () => {
    expect(ALL_PERMISSION_KEYS).toHaveLength(27);
    expect(new Set(ALL_PERMISSION_KEYS).size).toBe(27);
    for (const key of ALL_PERMISSION_KEYS) {
      expect(key).toMatch(/^[a-z]+\.[a-z_]+$/);
    }
  });

  it('every non-view action requires an existing permission', () => {
    for (const def of PERMISSION_DEFINITIONS) {
      for (const required of def.requires || []) {
        expect(ALL_PERMISSION_KEYS).toContain(required);
      }
    }
  });

  it('admin defaults exclude analytics, user deletion and role management', () => {
    expect(DEFAULT_ROLE_GRANTS.admin).not.toContain('analytics.view');
    expect(DEFAULT_ROLE_GRANTS.admin).not.toContain('users.delete');
    expect(DEFAULT_ROLE_GRANTS.admin).not.toContain('roles.manage');
    expect(DEFAULT_ROLE_GRANTS.admin).toHaveLength(24);
  });

  it('manager defaults equal admin plus Employee Analytics', () => {
    expect(DEFAULT_ROLE_GRANTS.manager).toContain('analytics.view');
    expect(DEFAULT_ROLE_GRANTS.manager).not.toContain('roles.manage');
    expect(DEFAULT_ROLE_GRANTS.manager).toHaveLength(25);
    expect(DEFAULT_ROLE_GRANTS.employee).toEqual([]);
  });

  it('auto-adds the module view permission ("include Read")', () => {
    const result = withRequiredPermissions(['tasks.create', 'tasks.delete', 'teams.view']);
    expect(result.permissions).toEqual(['tasks.view', 'tasks.create', 'tasks.delete', 'teams.view']);
    expect(result.autoAdded).toEqual(['tasks.view']);
  });

  it('groups the catalog by module and marks roles.manage as locked', () => {
    const catalog = getPermissionCatalog();
    const roles = catalog.modules.find((m) => m.module === 'roles');
    expect(roles?.permissions[0]).toMatchObject({ key: 'roles.manage', locked: true });
    const tasks = catalog.modules.find((m) => m.module === 'tasks');
    expect(tasks?.permissions[0]).toMatchObject({ key: 'tasks.view', isBase: true });
  });
});

describe('resolveRoleAccess', () => {
  it('gives superadmin every permission regardless of rows', () => {
    const access = resolveRoleAccess({ name: 'superadmin', displayName: 'Superadmin', level: 100, platform: 'web', roleHasPermissions: [] });
    expect(access.permissions).toEqual(ALL_PERMISSION_KEYS);
  });

  it('uses role_has_permissions for a synced role, in catalog order', () => {
    const access = resolveRoleAccess({
      id: 7n,
      name: 'supervisor',
      displayName: 'Supervisor',
      level: 40,
      platform: 'web',
      color: '#16a34a',
      showTaskBadge: true,
      roleHasPermissions: [{ permission: { name: 'tasks.view' } }, { permission: { name: 'dashboard.view' } }, { permission: { name: 'view users' } }],
    });
    expect(access).toMatchObject({ roleId: '7', role: 'supervisor', level: 40, platform: 'web', showTaskBadge: true });
    expect(access.permissions).toEqual(['dashboard.view', 'tasks.view']);
  });

  it('falls back to catalog defaults for a system role that was not synced yet', () => {
    const access = resolveRoleAccess({ name: 'admin', displayName: null, roleHasPermissions: [{ permission: { name: 'view users' } }] });
    expect(access.permissions).toEqual(DEFAULT_ROLE_GRANTS.admin);
    expect(access.level).toBe(50);
    expect(access.platform).toBe('web');
  });

  it('treats a user without a role as a mobile employee', () => {
    const access = resolveRoleAccess(undefined);
    expect(access).toMatchObject({ role: 'employee', platform: 'mobile', level: 10, permissions: [] });
  });
});

describe('authorization helpers', () => {
  const admin = { userId: 'a', role: 'admin', level: 50, permissions: DEFAULT_ROLE_GRANTS.admin };

  it('can() checks permissions and short-circuits superadmin', () => {
    expect(can(admin, 'tasks.create')).toBe(true);
    expect(can(admin, 'analytics.view')).toBe(false);
    expect(can({ role: 'superadmin', permissions: [] }, 'roles.manage')).toBe(true);
    expect(can(undefined, 'tasks.view')).toBe(false);
  });

  it('canManageUser only allows lower levels and never yourself', () => {
    expect(canManageUser(admin, { userId: 'e', level: 10 })).toBe(true);
    expect(canManageUser(admin, { userId: 'm', level: 50 })).toBe(false);
    expect(canManageUser(admin, { userId: 's', level: 100 })).toBe(false);
    expect(canManageUser({ userId: 's', level: 100 }, { userId: 's', level: 100 })).toBe(false);
  });

  it('canAssignRole never allows superadmin and requires a lower level', () => {
    expect(canAssignRole({ level: 100 }, { name: 'superadmin', level: 100 })).toBe(false);
    expect(canAssignRole({ level: 100 }, { name: 'admin', level: 50 })).toBe(true);
    expect(canAssignRole({ level: 50 }, { name: 'manager', level: 50 })).toBe(false);
    expect(canAssignRole({ level: 50 }, { name: 'supervisor', level: 40 })).toBe(true);
  });
});

describe('attachTaskCreators', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('shows the badge only when the creator role currently has showTaskBadge on', async () => {
    (prisma.role.findMany as any).mockResolvedValueOnce([
      { name: 'manager', displayName: 'Manager', color: '#0891b2', showTaskBadge: true },
      { name: 'admin', displayName: 'Admin', color: '#2563eb', showTaskBadge: false },
    ]);

    const [byManager, byAdmin, byDeletedRole, legacy] = await attachTaskCreators([
      { taskId: '1', createdByRoleName: 'manager', createdBy: { id: 'u1', name: 'Budi' } },
      { taskId: '2', createdByRoleName: 'admin', createdBy: { id: 'u2', name: 'John' } },
      { taskId: '3', createdByRoleName: 'old_role', createdBy: null },
      { taskId: '4', createdByRoleName: null },
    ]);

    expect(byManager.createdByRole).toEqual({ name: 'manager', displayName: 'Manager', color: '#0891b2', showBadge: true });
    expect(byAdmin.createdByRole?.showBadge).toBe(false);
    expect(byDeletedRole.createdByRole).toEqual({ name: 'old_role', displayName: 'old_role', color: null, showBadge: false });
    expect(legacy.createdByRole).toBeNull();
    expect(legacy.createdBy).toBeNull();
  });
});
