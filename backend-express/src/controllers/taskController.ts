import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { getJakartaTime } from '../utils/timezone';
import { io } from '../app'; // Pastikan path ini mengarah ke file tempat kamu meng-export 'io'
import { findUsersWithPermission } from '../rbac/recipients';
import { can } from '../rbac/access';
import { attachTaskCreators, TASK_CREATOR_INCLUDE } from '../rbac/taskCreator';
import { checkLeaderboardAchievement } from '../utils/achievementHandler';

/**
 * Convert time string (HH:MM:SS or HH:MM) to DateTime for MySQL TIME field.
 * Stores as UTC so Prisma returns e.g. "1970-01-01T08:00:00.000Z" for "08:00:00".
 * Avoids TZ=Asia/Jakarta causing setHours(8) to store as 01:00 UTC.
 */
const convertTimeToDateTime = (timeString: string): Date => {
  if (!timeString) {
    // Default to 08:00:00 UTC
    return new Date(Date.UTC(1970, 0, 1, 8, 0, 0));
  }

  const timeParts = timeString.split(':');
  const hours = parseInt(timeParts[0], 10);
  const minutes = timeParts.length > 1 ? parseInt(timeParts[1], 10) : 0;
  const seconds = timeParts.length > 2 ? parseInt(timeParts[2], 10) : 0;

  // Use Date.UTC to store time as-is regardless of server TZ
  return new Date(Date.UTC(1970, 0, 1, hours, minutes, seconds));
};

/**
 * Format DateTime object to time string (HH:MM)
 */
const formatTimeToString = (dateTime: Date | string | null): string => {
  if (!dateTime) return '';
  
  // If it's already a string in HH:MM format, return it
  if (typeof dateTime === 'string') {
    if (dateTime.match(/^\d{2}:\d{2}$/)) return dateTime;
    // If it's HH:MM:SS, remove seconds
    if (dateTime.match(/^\d{2}:\d{2}:\d{2}$/)) {
      return dateTime.substring(0, 5);
    }
  }
  
  const date = new Date(dateTime);
  const hours = date.getUTCHours().toString().padStart(2, '0');
  const minutes = date.getUTCMinutes().toString().padStart(2, '0');
  return `${hours}:${minutes}`;
};

/**
 * Format task object to include string time fields
 */
const formatTaskResponse = (task: any) => {
  return {
    ...task,
    start_time: formatTimeToString(task.startTime),
    end_time: formatTimeToString(task.endTime),
    startTime: formatTimeToString(task.startTime),
    endTime: formatTimeToString(task.endTime),
  };
};

/**
 * Get all tasks
 */
export const getAllTasks = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status, createdByRole } = req.query;

    const tasks = await prisma.task.findMany({
      where: {
        ...(status && { status: status as string }),
        ...(createdByRole && { createdByRoleName: createdByRole as string }),
      },
      include: {
        takenTasks: true,
        ...TASK_CREATOR_INCLUDE,
      },
      orderBy: [
        { ticketNumber: 'asc' },
      ],
    });

    // Sort to move null ticketNumbers to the end
    const sortedTasks = tasks.sort((a, b) => {
      if (a.ticketNumber === null && b.ticketNumber === null) return 0;
      if (a.ticketNumber === null) return 1;
      if (b.ticketNumber === null) return -1;
      return a.ticketNumber.localeCompare(b.ticketNumber, undefined, { numeric: true });
    });

    // Format time fields for frontend + creator badge info
    const formattedTasks = (await attachTaskCreators(sortedTasks)).map(formatTaskResponse);
    res.json({ tasks: formattedTasks });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task by ID
 */
export const getTaskById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { taskId } = req.params;

    const task = await prisma.task.findUnique({
      where: { taskId },
      include: {
        takenTasks: {
          include: {
            locations: true,
            reports: true,
          },
        },
        ...TASK_CREATOR_INCLUDE,
      },
    });

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    const [withCreator] = await attachTaskCreators([task]);
    res.json({ task: formatTaskResponse(withCreator) });
  } catch (error) {
    next(error);
  }
};

/**
 * Create new task
 */
export const createTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const {
      title,
      description,
      location,
      latitude,
      longitude,
      startTime,
      endTime,
      start_time,
      end_time,
      manualOverride,
    } = req.body;

    // Generate ticket number: find the highest existing number to avoid gaps/conflicts
    const generateTicketNumber = async (): Promise<string> => {
      const allTickets = await prisma.task.findMany({
        select: { ticketNumber: true },
        where: { ticketNumber: { startsWith: 'TSK-' } },
      });

      let maxNumber = 0;
      for (const t of allTickets) {
        if (t.ticketNumber) {
          const parts = t.ticketNumber.split('-');
          const num = parseInt(parts[1], 10);
          if (!isNaN(num) && num > maxNumber) maxNumber = num;
        }
      }

      return `TSK-${String(maxNumber + 1).padStart(4, '0')}`;
    };

    // Retry up to 5 times in case of concurrent requests causing conflicts
    let task;
    let attempts = 0;
    const maxAttempts = 5;

    while (attempts < maxAttempts) {
      const ticketNumber = await generateTicketNumber();
      try {
        task = await prisma.task.create({
          data: {
            taskId: uuidv4(),
            ticketNumber,
            title,
            description: description || "",
            location,
            latitude: latitude ? parseFloat(latitude) : null,
            longitude: longitude ? parseFloat(longitude) : null,
            startTime: convertTimeToDateTime(startTime || '08:00:00'),
            endTime: convertTimeToDateTime(endTime || '17:00:00'),
            manualOverride: manualOverride || false,
            status: 'active',
            // Pembuat task + snapshot role untuk badge "Dibuat oleh {Role}"
            createdById: req.user?.userId ?? null,
            createdByRoleName: req.user?.role ?? null,
          },
          include: TASK_CREATOR_INCLUDE,
        });
        break; // success
      } catch (err: any) {
        if (err?.code === 'P2002' && attempts < maxAttempts - 1) {
          attempts++;
          continue; // retry with next number
        }
        throw err;
      }
    }

    // =========================================================
    // 🔥 TRIGGER NOTIFIKASI WEB KE ADMIN (JIRA FR-01.1)
    // =========================================================
    if (task) {
      try {
        // 1. Cari semua user yang boleh melihat task (RBAC: tasks.view)
        const admins = await findUsersWithPermission('tasks.view', { id: true });

        if (admins.length > 0) {
          // 2. Simpan ke database (Notif Lonceng Web)
          const adminNotifData = admins.map((admin) => ({
            userId: admin.id,
            title: "Task Baru Dibuat! 📝",
            message: `Master Task baru dengan judul "${task.title}" telah ditambahkan ke sistem.`,
            category: "NEW_MASTER_TASK",
            relatedId: task.taskId,
          }));

          await prisma.notification.createMany({ data: adminNotifData });

          // 3. Tembak Socket.io untuk Web (Real-time Popup)
          admins.forEach((admin) => {
            io.to(`user:${admin.id}`).emit('admin:new_master_task', {
              taskId: task!.taskId,
              title: task!.title,
              message: `Task master baru "${task!.title}" berhasil dibuat.`
            });
          });

          console.log(`[System] Notif master task baru terkirim ke ${admins.length} admin.`);
        }
      } catch (notifError) {
        console.error('[Notif Error]: Gagal mengirim notif pembuatan master task', notifError);
      }
    }
    // =========================================================

    const [createdWithCreator] = await attachTaskCreators([task!]);
    res.status(201).json({
      message: 'Task created successfully',
      task: formatTaskResponse(createdWithCreator),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update task
 */
export const updateTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { taskId } = req.params;
    const {
      title,
      description,
      location,
      latitude,
      longitude,
      startTime,
      endTime,
      start_time,
      end_time,
      status,
      manualOverride,
    } = req.body;

    const existing = await prisma.task.findUnique({ where: { taskId }, select: { status: true } });
    if (!existing) {
      throw new AppError('Task not found', 404);
    }

    // RBAC: status change needs tasks.toggle_status, any other field needs tasks.update
    const statusChanged = Boolean(status) && status !== existing.status;
    const otherFieldsSent = [title, description, location, latitude, longitude, startTime, endTime, start_time, end_time, manualOverride]
      .some((value) => value !== undefined);
    if (statusChanged && !can(req.user, 'tasks.toggle_status')) {
      throw new AppError('Insufficient permissions', 403);
    }
    if (otherFieldsSent && !can(req.user, 'tasks.update')) {
      throw new AppError('Insufficient permissions', 403);
    }
    if (!statusChanged && !otherFieldsSent && !can(req.user, 'tasks.update') && !can(req.user, 'tasks.toggle_status')) {
      throw new AppError('Insufficient permissions', 403);
    }

    const task = await prisma.task.update({
      where: { taskId },
      data: {
        ...(title && { title }),
        ...(description && { description }),
        ...(location && { location }),
        ...(latitude !== undefined && { latitude: parseFloat(latitude) }),
        ...(longitude !== undefined && { longitude: parseFloat(longitude) }),
        ...((startTime || start_time) && { startTime: convertTimeToDateTime(startTime || start_time) }),
        ...((endTime || end_time) && { endTime: convertTimeToDateTime(endTime || end_time) }),
        ...(status && { status }),
        ...(manualOverride !== undefined && { manualOverride }),
      },
      include: TASK_CREATOR_INCLUDE,
    });

    const [updatedWithCreator] = await attachTaskCreators([task]);
    res.json({
      message: 'Task updated successfully',
      task: formatTaskResponse(updatedWithCreator),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete task
 */
export const deleteTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { taskId } = req.params;

    await prisma.task.delete({
      where: { taskId },
    });

    res.json({ message: 'Task deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Get task statistics
 */
export const getTaskStatistics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const totalTasks = await prisma.task.count();
    const activeTasks = await prisma.task.count({
      where: { status: 'active' },
    });
    const inactiveTasks = await prisma.task.count({
      where: { status: 'inactive' },
    });

    res.json({
      statistics: {
        total: totalTasks,
        active: activeTasks,
        inactive: inactiveTasks,
      },
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Mark task as completed
 */
export const markAsCompleted = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { taskId } = req.params;

    // Check if task exists
    const task = await prisma.task.findUnique({
      where: { taskId },
    });

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    // Update task status to completed
const updatedTask = await prisma.task.update({
  where: { taskId },
  data: {
    status: 'completed',
    updatedAt: new Date(),
  },
});

// Cek apakah terjadi perubahan juara leaderboard
await checkLeaderboardAchievement();

    res.json({
      message: 'Task marked as completed successfully',
      task: formatTaskResponse(updatedTask),
    });
  } catch (error) {
    next(error);
  }
};