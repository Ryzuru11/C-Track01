import prisma from '../config/database';
import { SYSTEM_ROLES } from './permissions';

/**
 * User aktif yang role-nya memiliki permission tertentu (superadmin selalu termasuk).
 * Pengganti query lama `role.name in ['admin', 'superadmin']` untuk penerima notifikasi.
 */
export const findUsersWithPermission = async <S extends Record<string, true>>(
  key: string,
  select: S
) =>
  prisma.user.findMany({
    where: {
      status: 'active',
      modelHasRoles: {
        some: {
          role: {
            OR: [
              { name: SYSTEM_ROLES.SUPERADMIN },
              { roleHasPermissions: { some: { permission: { name: key } } } },
            ],
          },
        },
      },
    },
    select,
  });

export const findUserIdsWithPermission = async (key: string): Promise<string[]> =>
  (await findUsersWithPermission(key, { id: true })).map((u: any) => u.id);
