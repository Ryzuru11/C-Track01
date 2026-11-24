/**
 * Kepemilikan data penugasan (taken task).
 *
 * Karyawan hanya boleh mengakses penugasan yang ditugaskan kepadanya. Staf web dengan
 * permission tertentu (mis. monitoring.view_locations) boleh mengakses penugasan mana pun.
 */
import { Response, NextFunction } from 'express';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { canAny } from './access';

/** userIds disimpan sebagai JSON string di DB; terima juga array (data lama / sudah di-parse) */
export const parseAssignedUserIds = (userIds: unknown): string[] => {
  if (Array.isArray(userIds)) return userIds.map(String);
  if (typeof userIds === 'string') {
    try {
      const parsed = JSON.parse(userIds);
      return Array.isArray(parsed) ? parsed.map(String) : [];
    } catch {
      return [];
    }
  }
  return [];
};

export const isAssignedTo = (takenTask: { userIds: unknown }, userId: string): boolean =>
  parseAssignedUserIds(takenTask.userIds).includes(userId);

/**
 * Pastikan user boleh mengakses penugasan: ditugaskan, atau punya salah satu `staffPermissions`.
 * 404 jika penugasan tidak ada, 403 jika tidak berhak.
 */
export const assertAssignmentAccess = async (
  user: AuthRequest['user'],
  takenTaskId: unknown,
  staffPermissions: string[] = []
) => {
  if (!user) {
    throw new AppError('Authentication required', 401);
  }
  if (typeof takenTaskId !== 'string' || !takenTaskId) {
    throw new AppError('takenTaskId is required', 400);
  }

  if (staffPermissions.length > 0 && canAny(user, staffPermissions)) {
    return;
  }

  const takenTask = await prisma.takenTask.findUnique({
    where: { takenTaskId },
    select: { userIds: true },
  });
  if (!takenTask) {
    throw new AppError('Assignment not found', 404);
  }
  if (!isAssignedTo(takenTask, user.userId)) {
    throw new AppError('You are not assigned to this task', 403);
  }
};

/** Middleware untuk route dengan `:takenTaskId` di path */
export const requireAssignmentAccess = (...staffPermissions: string[]) =>
  async (req: AuthRequest, _res: Response, next: NextFunction) => {
    try {
      await assertAssignmentAccess(req.user, req.params.takenTaskId, staffPermissions);
      next();
    } catch (error) {
      next(error);
    }
  };
