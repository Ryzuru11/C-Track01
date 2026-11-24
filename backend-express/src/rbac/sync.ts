/**
 * Sinkronisasi katalog RBAC ke database (idempotent).
 *
 * 1. Upsert semua permission dari katalog, hapus permission yang tidak ada di katalog
 *    (format lama seperti 'view users'; tidak dipakai kode mana pun).
 * 2. Upsert role sistem (superadmin, admin, manager, employee).
 * 3. Grant default hanya saat role sistem pertama kali diinisialisasi, supaya
 *    perubahan dari Role dashboard tidak tertimpa saat deploy berikutnya.
 *    Superadmin selalu di-reset ke seluruh katalog.
 *
 * Role dianggap "belum diinisialisasi" jika baru dibuat atau `display_name`-nya
 * masih NULL (baris lama sebelum migrasi RBAC v2).
 */
import { PrismaClient } from '@prisma/client';
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_GRANTS,
  GUARD_NAME,
  PERMISSION_DEFINITIONS,
  SYSTEM_ROLES,
  SYSTEM_ROLE_DEFINITIONS,
} from './permissions';

export interface RbacSyncSummary {
  permissionsUpserted: number;
  permissionsDeleted: number;
  rolesCreated: string[];
  rolesInitialized: string[];
}

export const syncRbac = async (prisma: PrismaClient): Promise<RbacSyncSummary> => {
  const summary: RbacSyncSummary = {
    permissionsUpserted: 0,
    permissionsDeleted: 0,
    rolesCreated: [],
    rolesInitialized: [],
  };

  // 1. Permissions
  for (const [index, def] of PERMISSION_DEFINITIONS.entries()) {
    await prisma.permission.upsert({
      where: { name_guardName: { name: def.key, guardName: GUARD_NAME } },
      create: {
        name: def.key,
        guardName: GUARD_NAME,
        module: def.module,
        label: def.label,
        description: def.description,
        sortOrder: index,
      },
      update: {
        module: def.module,
        label: def.label,
        description: def.description,
        sortOrder: index,
      },
    });
    summary.permissionsUpserted++;
  }

  const deleted = await prisma.permission.deleteMany({
    where: { name: { notIn: ALL_PERMISSION_KEYS } },
  });
  summary.permissionsDeleted = deleted.count;

  const permissions = await prisma.permission.findMany({
    where: { guardName: GUARD_NAME },
    select: { id: true, name: true },
  });
  const permissionIdByKey = new Map(permissions.map((p) => [p.name, p.id]));

  // 2 & 3. System roles
  for (const def of SYSTEM_ROLE_DEFINITIONS) {
    const existing = await prisma.role.findUnique({
      where: { name_guardName: { name: def.name, guardName: GUARD_NAME } },
    });

    const needsInit = !existing || existing.displayName === null;

    const role = existing
      ? await prisma.role.update({
          where: { id: existing.id },
          data: {
            level: def.level,
            platform: def.platform,
            isSystem: true,
            ...(needsInit && {
              displayName: def.displayName,
              description: def.description,
              color: def.color,
              showTaskBadge: def.showTaskBadge,
            }),
          },
        })
      : await prisma.role.create({
          data: {
            name: def.name,
            guardName: GUARD_NAME,
            displayName: def.displayName,
            description: def.description,
            level: def.level,
            platform: def.platform,
            isSystem: true,
            color: def.color,
            showTaskBadge: def.showTaskBadge,
          },
        });

    if (!existing) summary.rolesCreated.push(def.name);

    const isSuperadmin = def.name === SYSTEM_ROLES.SUPERADMIN;
    if (needsInit || isSuperadmin) {
      const grants = DEFAULT_ROLE_GRANTS[def.name] || [];
      await prisma.$transaction([
        prisma.roleHasPermission.deleteMany({ where: { roleId: role.id } }),
        prisma.roleHasPermission.createMany({
          data: grants
            .map((key) => permissionIdByKey.get(key))
            .filter((id): id is bigint => id !== undefined)
            .map((permissionId) => ({ roleId: role.id, permissionId })),
        }),
      ]);
      if (needsInit) summary.rolesInitialized.push(def.name);
    }
  }

  return summary;
};
