/**
 * Badge "Dibuat oleh {Role}" pada task.
 *
 * Task menyimpan snapshot nama role pembuat (`createdByRoleName`). Teks, warna, dan
 * tampil/tidaknya badge diambil dari pengaturan role SAAT INI (`showTaskBadge`),
 * sehingga mencentang/menghapus centang di Role dashboard juga berlaku untuk task lama.
 */
import prisma from '../config/database';
import { GUARD_NAME } from './permissions';

export const TASK_CREATOR_INCLUDE = {
  createdBy: { select: { id: true, name: true } },
} as const;

export interface TaskCreatorRole {
  name: string;
  displayName: string;
  color: string | null;
  showBadge: boolean;
}

type TaskLike = { createdByRoleName?: string | null; createdBy?: { id: string; name: string } | null };

export const attachTaskCreators = async <T extends TaskLike>(tasks: T[]) => {
  const roleNames = [...new Set(tasks.map((t) => t.createdByRoleName).filter((n): n is string => Boolean(n)))];

  const roles = roleNames.length
    ? await prisma.role.findMany({
        where: { name: { in: roleNames }, guardName: GUARD_NAME },
        select: { name: true, displayName: true, color: true, showTaskBadge: true },
      })
    : [];
  const roleByName = new Map(roles.map((r) => [r.name, r]));

  return tasks.map((task) => {
    const roleName = task.createdByRoleName;
    const role = roleName ? roleByName.get(roleName) : undefined;
    const createdByRole: TaskCreatorRole | null = roleName
      ? {
          name: roleName,
          displayName: role?.displayName || roleName,
          color: role?.color ?? null,
          // Role yang sudah dihapus tidak menampilkan badge
          showBadge: Boolean(role?.showTaskBadge),
        }
      : null;
    return {
      ...task,
      createdBy: task.createdBy ?? null,
      createdByRole,
    };
  });
};

/** Untuk penugasan: tambahkan createdBy/createdByRole ke `takenTask.task` */
export const attachTaskCreatorsToAssignments = async <A extends { task?: TaskLike | null }>(assignments: A[]) => {
  const tasks = assignments.map((a) => a.task).filter((t): t is TaskLike => Boolean(t));
  const enriched = await attachTaskCreators(tasks);
  const byRef = new Map(tasks.map((t, i) => [t, enriched[i]]));
  return assignments.map((a) => (a.task ? { ...a, task: byRef.get(a.task) } : a));
};
