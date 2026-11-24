import { io } from '../app';
import { refreshSocketAccess } from '../sockets';

export type RbacUpdateReason = 'role_permissions' | 'role_assignment' | 'role_deleted';

/**
 * Beritahu user yang aksesnya berubah: frontend memuat ulang /auth/me,
 * dan socket mereka bergabung ulang ke room permission yang sesuai.
 */
export const notifyRbacUpdated = async (userIds: string[], reason: RbacUpdateReason, roleId?: string) => {
  for (const userId of userIds) {
    try {
      io.to(`user:${userId}`).emit('rbac:updated', { reason, roleId: roleId ?? null });
      await refreshSocketAccess(io, userId);
    } catch (error) {
      console.error(`[RBAC] Failed to notify user ${userId}:`, error);
    }
  }
};
