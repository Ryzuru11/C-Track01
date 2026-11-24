/**
 * Pemuatan hak akses user & helper otorisasi (RBAC v2).
 *
 * `loadAccess` dipanggil di setiap request (middleware authenticate) dan koneksi socket,
 * sehingga perubahan role/hak akses langsung berlaku tanpa login ulang.
 */
import prisma from '../config/database';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_GRANTS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFINITIONS,
} from './permissions';

export type Platform = 'web' | 'mobile';

export interface UserAccess {
  userId: string;
  email: string;
  name: string;
  status: string;
  roleId: string | null;
  role: string;
  roleDisplayName: string;
  roleColor: string | null;
  level: number;
  platform: Platform;
  permissions: string[];
}

/** Subset yang dibutuhkan helper `can` (cocok untuk req.user maupun socket.user) */
export interface AccessSubject {
  userId: string;
  role: string;
  level: number;
  permissions: string[];
}

export const roleWithPermissionsInclude = {
  role: {
    include: {
      roleHasPermissions: {
        include: { permission: { select: { name: true } } },
      },
    },
  },
} as const;

const SYSTEM_ROLE_BY_NAME = new Map(SYSTEM_ROLE_DEFINITIONS.map((r) => [r.name, r]));

/**
 * Hitung atribut akses dari baris role. Role sistem yang belum di-sync
 * (display_name NULL, mis. sebelum `npm run rbac:sync`) memakai default katalog
 * agar user tidak terkunci di jendela deploy.
 */
export const resolveRoleAccess = (role: any | null | undefined) => {
  const name: string = role?.name || SYSTEM_ROLES.EMPLOYEE;
  const systemDef = SYSTEM_ROLE_BY_NAME.get(name);
  const synced = role?.displayName !== null && role?.displayName !== undefined;

  let permissions: string[];
  if (name === SYSTEM_ROLES.SUPERADMIN) {
    permissions = ALL_PERMISSION_KEYS;
  } else if (synced && Array.isArray(role?.roleHasPermissions)) {
    const granted = new Set<string>(role.roleHasPermissions.map((rp: any) => rp.permission?.name));
    permissions = ALL_PERMISSION_KEYS.filter((key) => granted.has(key));
  } else {
    permissions = DEFAULT_ROLE_GRANTS[name] || [];
  }

  return {
    roleId: role?.id !== undefined && role?.id !== null ? String(role.id) : null,
    role: name,
    roleDisplayName: (synced && role.displayName) || systemDef?.displayName || name,
    roleColor: (synced ? role.color : systemDef?.color) ?? null,
    level: synced && typeof role.level === 'number' ? role.level : systemDef?.level ?? 10,
    platform: ((synced && role.platform) || systemDef?.platform || 'web') as Platform,
    showTaskBadge: synced ? Boolean(role.showTaskBadge) : systemDef?.showTaskBadge ?? false,
    permissions,
  };
};

/** Muat user + role + permission. Mengembalikan null jika user tidak ada. */
export const loadAccess = async (userId: string): Promise<UserAccess | null> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: {
      id: true,
      email: true,
      name: true,
      status: true,
      modelHasRoles: { include: roleWithPermissionsInclude },
    },
  });

  if (!user) return null;

  const { showTaskBadge: _ignored, ...access } = resolveRoleAccess(user.modelHasRoles?.[0]?.role);
  return {
    userId: user.id,
    email: user.email,
    name: user.name,
    status: user.status,
    ...access,
  };
};

export const can = (subject: Pick<AccessSubject, 'role' | 'permissions'> | undefined | null, key: string): boolean => {
  if (!subject) return false;
  if (subject.role === SYSTEM_ROLES.SUPERADMIN) return true;
  return subject.permissions.includes(key);
};

export const canAny = (subject: Pick<AccessSubject, 'role' | 'permissions'> | undefined | null, keys: string[]): boolean =>
  keys.some((key) => can(subject, key));

/**
 * Hierarki: user hanya boleh mengelola user lain yang role-nya berlevel lebih rendah,
 * dan tidak boleh mengelola dirinya sendiri lewat endpoint admin.
 */
export const canManageUser = (
  actor: Pick<AccessSubject, 'userId' | 'level'>,
  target: { userId: string; level: number }
): boolean => actor.userId !== target.userId && target.level < actor.level;

/** Role superadmin tidak pernah bisa di-assign; role lain hanya jika levelnya di bawah actor. */
export const canAssignRole = (
  actor: Pick<AccessSubject, 'level'>,
  role: { name: string; level: number }
): boolean => role.name !== SYSTEM_ROLES.SUPERADMIN && role.level < actor.level;

/** Level role milik user target (untuk cek hierarki). */
export const getUserLevel = async (userId: string): Promise<{ exists: boolean; level: number; role: string }> => {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { id: true, modelHasRoles: { include: { role: true } } },
  });
  if (!user) return { exists: false, level: 0, role: SYSTEM_ROLES.EMPLOYEE };
  const resolved = resolveRoleAccess(user.modelHasRoles?.[0]?.role);
  return { exists: true, level: resolved.level, role: resolved.role };
};

/** Field role yang dikirim ke frontend bersama data user */
export const toRoleResponseFields = (access: Pick<UserAccess, 'role' | 'roleDisplayName' | 'level' | 'roleColor' | 'platform'>) => ({
  role: access.role,
  roleDisplayName: access.roleDisplayName,
  roleLevel: access.level,
  roleColor: access.roleColor,
  platform: access.platform,
});
