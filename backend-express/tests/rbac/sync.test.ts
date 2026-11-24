import { describe, it, expect, beforeEach } from 'vitest';
import { syncRbac } from '../../src/rbac/sync';
import { ALL_PERMISSION_KEYS, DEFAULT_ROLE_GRANTS } from '../../src/rbac/permissions';

/**
 * Tiny in-memory stand-in for the Prisma calls syncRbac makes
 * (permissions, roles, role_has_permissions), so runs can be compared.
 */
const createFakeDb = () => {
  let nextId = 1n;
  const permissions: any[] = [];
  const roles: any[] = [];
  let grants: Array<{ roleId: bigint; permissionId: bigint }> = [];

  const matchesRole = (where: any) => (r: any) =>
    where.id !== undefined ? r.id === where.id : r.name === where.name_guardName.name && r.guardName === where.name_guardName.guardName;

  const db: any = {
    permission: {
      upsert: async ({ where, create, update }: any) => {
        const existing = permissions.find((p) => p.name === where.name_guardName.name && p.guardName === where.name_guardName.guardName);
        if (existing) return Object.assign(existing, update);
        const row = { id: nextId++, ...create };
        permissions.push(row);
        return row;
      },
      deleteMany: async ({ where }: any) => {
        const doomed = permissions.filter((p) => !where.name.notIn.includes(p.name));
        doomed.forEach((p) => {
          permissions.splice(permissions.indexOf(p), 1);
          grants = grants.filter((g) => g.permissionId !== p.id); // ON DELETE CASCADE
        });
        return { count: doomed.length };
      },
      findMany: async () => permissions.map(({ id, name }) => ({ id, name })),
    },
    role: {
      findUnique: async ({ where }: any) => roles.find(matchesRole(where)) ?? null,
      update: async ({ where, data }: any) => Object.assign(roles.find(matchesRole(where)), data),
      create: async ({ data }: any) => {
        const row = { id: nextId++, ...data };
        roles.push(row);
        return row;
      },
    },
    roleHasPermission: {
      deleteMany: async ({ where }: any) => {
        const before = grants.length;
        grants = grants.filter((g) => g.roleId !== where.roleId);
        return { count: before - grants.length };
      },
      createMany: async ({ data }: any) => {
        grants.push(...data);
        return { count: data.length };
      },
    },
    $transaction: async (ops: Promise<unknown>[]) => Promise.all(ops),
  };

  const grantsOf = (roleName: string) => {
    const role = roles.find((r) => r.name === roleName);
    return grants
      .filter((g) => g.roleId === role.id)
      .map((g) => permissions.find((p) => p.id === g.permissionId).name)
      .sort();
  };

  /** Simulate an edit made in the Role dashboard */
  const setGrants = (roleName: string, keys: string[]) => {
    const role = roles.find((r) => r.name === roleName);
    grants = grants.filter((g) => g.roleId !== role.id);
    keys.forEach((k) => grants.push({ roleId: role.id, permissionId: permissions.find((p) => p.name === k).id }));
  };

  return { db, permissions, roles, grantsOf, setGrants, addPermission: (name: string) => permissions.push({ id: nextId++, name, guardName: 'web' }) };
};

const sorted = (keys: string[]) => [...keys].sort();

describe('syncRbac', () => {
  let fake: ReturnType<typeof createFakeDb>;

  beforeEach(() => {
    fake = createFakeDb();
  });

  it('on an empty database creates the catalog, the four system roles and their default grants', async () => {
    const summary = await syncRbac(fake.db);

    expect(summary.permissionsUpserted).toBe(ALL_PERMISSION_KEYS.length);
    expect(summary.rolesCreated).toEqual(['superadmin', 'admin', 'manager', 'employee']);
    expect(summary.rolesInitialized).toEqual(['superadmin', 'admin', 'manager', 'employee']);

    expect(fake.permissions.map((p) => p.name).sort()).toEqual(sorted(ALL_PERMISSION_KEYS));
    expect(fake.grantsOf('superadmin')).toEqual(sorted(ALL_PERMISSION_KEYS));
    expect(fake.grantsOf('admin')).toEqual(sorted(DEFAULT_ROLE_GRANTS.admin));
    expect(fake.grantsOf('manager')).toEqual(sorted(DEFAULT_ROLE_GRANTS.manager));
    expect(fake.grantsOf('employee')).toEqual([]);

    const byName = Object.fromEntries(fake.roles.map((r) => [r.name, r]));
    expect(byName.manager).toMatchObject({ level: 50, platform: 'web', isSystem: true, showTaskBadge: true, displayName: 'Manager' });
    expect(byName.employee).toMatchObject({ level: 10, platform: 'mobile' });
    expect(byName.superadmin).toMatchObject({ level: 100 });
    expect(byName.admin.showTaskBadge).toBe(false);
  });

  it('is idempotent: a second run creates and initializes nothing and changes no grant', async () => {
    await syncRbac(fake.db);
    const snapshot = ['superadmin', 'admin', 'manager', 'employee'].map((r) => fake.grantsOf(r));

    const summary = await syncRbac(fake.db);

    expect(summary.rolesCreated).toEqual([]);
    expect(summary.rolesInitialized).toEqual([]);
    expect(summary.permissionsDeleted).toBe(0);
    expect(['superadmin', 'admin', 'manager', 'employee'].map((r) => fake.grantsOf(r))).toEqual(snapshot);
    expect(fake.roles).toHaveLength(4);
  });

  it('keeps changes made in the Role dashboard across deploys', async () => {
    await syncRbac(fake.db);

    // Superadmin gives Admin Employee Analytics, removes Manager's user creation and turns its badge off
    fake.setGrants('admin', [...DEFAULT_ROLE_GRANTS.admin, 'analytics.view']);
    fake.setGrants('manager', DEFAULT_ROLE_GRANTS.manager.filter((k) => k !== 'users.create'));
    fake.roles.find((r) => r.name === 'manager').showTaskBadge = false;
    fake.roles.find((r) => r.name === 'manager').displayName = 'Manajer Lapangan';

    await syncRbac(fake.db);

    expect(fake.grantsOf('admin')).toContain('analytics.view');
    expect(fake.grantsOf('manager')).not.toContain('users.create');
    expect(fake.roles.find((r) => r.name === 'manager')).toMatchObject({ showTaskBadge: false, displayName: 'Manajer Lapangan' });
  });

  it('always resets superadmin to the full catalog', async () => {
    await syncRbac(fake.db);
    fake.setGrants('superadmin', ['dashboard.view']);

    await syncRbac(fake.db);

    expect(fake.grantsOf('superadmin')).toEqual(sorted(ALL_PERMISSION_KEYS));
  });

  it('removes old-style permissions that are not in the catalog', async () => {
    fake.addPermission('view users');
    fake.addPermission('manage settings');

    const summary = await syncRbac(fake.db);

    expect(summary.permissionsDeleted).toBe(2);
    expect(fake.permissions.map((p) => p.name)).not.toContain('view users');
  });

  it('initializes a role row that existed before the RBAC migration (display_name still NULL)', async () => {
    // Pre-migration admin role with only legacy columns and a legacy grant
    fake.addPermission('view users');
    await fake.db.role.create({ data: { name: 'admin', guardName: 'web', displayName: null, level: 10, platform: 'web', isSystem: false } });

    const summary = await syncRbac(fake.db);

    expect(summary.rolesCreated).not.toContain('admin');
    expect(summary.rolesInitialized).toContain('admin');
    expect(fake.roles.find((r) => r.name === 'admin')).toMatchObject({ displayName: 'Admin', level: 50, isSystem: true });
    expect(fake.grantsOf('admin')).toEqual(sorted(DEFAULT_ROLE_GRANTS.admin));
  });

  it('re-applies level and platform of system roles even if they were altered', async () => {
    await syncRbac(fake.db);
    Object.assign(fake.roles.find((r) => r.name === 'employee'), { platform: 'web', level: 99 });

    await syncRbac(fake.db);

    expect(fake.roles.find((r) => r.name === 'employee')).toMatchObject({ platform: 'mobile', level: 10 });
  });
});
