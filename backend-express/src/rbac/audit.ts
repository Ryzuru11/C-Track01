import prisma from '../config/database';

export type RbacAuditAction =
  | 'role.created'
  | 'role.updated'
  | 'role.permissions_updated'
  | 'role.deleted'
  | 'role.members_reassigned'
  | 'user.role_changed';

/** Catat perubahan RBAC. Gagal menulis log tidak boleh menggagalkan request. */
export const writeRbacAudit = async (entry: {
  actorId?: string | null;
  action: RbacAuditAction;
  targetType: 'role' | 'user';
  targetId: string;
  before?: unknown;
  after?: unknown;
}) => {
  try {
    await prisma.rbacAuditLog.create({
      data: {
        actorId: entry.actorId ?? null,
        action: entry.action,
        targetType: entry.targetType,
        targetId: entry.targetId,
        before: entry.before === undefined ? undefined : (entry.before as any),
        after: entry.after === undefined ? undefined : (entry.after as any),
      },
    });
  } catch (error) {
    console.error('[RBAC] Failed to write audit log:', error);
  }
};
