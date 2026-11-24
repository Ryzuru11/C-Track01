import { Response, NextFunction } from 'express';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { AuthRequest } from '../middleware/auth';
import { AppError } from '../middleware/errorHandler';
import { io } from '../app';
import { findUsersWithPermission } from '../rbac/recipients';
import { attachTaskCreatorsToAssignments, TASK_CREATOR_INCLUDE } from '../rbac/taskCreator';
import { formatTakenTaskResponse, formatTakenTasksResponse } from '../utils/json';
import { getJakartaTime } from '../utils/timezone';
import { sendTaskAssignmentNotification, sendTaskCompletionNotification, sendPartialCompletionNotification, sendColleagueCompletionNotification } from '../utils/notifications';
import { Expo } from 'expo-server-sdk';
import { checkLeaderboardAchievement } from '../utils/achievementHandler';

const expo = new Expo();

/** Statuses an employee may set on their own part of an assignment */
const EMPLOYEE_STATUSES = ['pending', 'in_progress', 'completed'];

/**
 * Generate unique ticket number with retry logic
 */
const generateUniqueTicketNumber = async (prefix: string = 'ASN'): Promise<string> => {
  let attempts = 0;
  const maxAttempts = 10;

  while (attempts < maxAttempts) {
    const lastTakenTask = await prisma.takenTask.findFirst({
      orderBy: { createdAt: 'desc' },
    });

    let ticketNumber = `${prefix}-0001`;
    if (lastTakenTask?.ticketNumber) {
      const lastNumber = parseInt(lastTakenTask.ticketNumber.split('-')[1]);
      ticketNumber = `${prefix}-${String(lastNumber + 1).padStart(4, '0')}`;
    }

    // Check if this number already exists
    const existing = await prisma.takenTask.findUnique({
      where: { ticketNumber },
    });

    if (!existing) {
      return ticketNumber;
    }

    attempts++;
  }

  // Fallback: use timestamp-based ticket number if we can't generate unique one
  const timestamp = Date.now().toString().slice(-6);
  const random = Math.random().toString(36).substr(2, 4).toUpperCase();
  return `${prefix}-${timestamp}${random}`;
};

/**
 * Get all taken tasks (assignments)
 */
export const getAllTakenTasks = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { status, userId } = req.query;

    const takenTasks = await prisma.takenTask.findMany({
      where: {
        ...(status && { status: status as string }),
      },
      include: {
        task: { include: TASK_CREATOR_INCLUDE },
        locations: {
          orderBy: { recordedAt: 'desc' },
          take: 10,
        },
        reports: {
          orderBy: { createdAt: 'desc' },
        },
      },
      orderBy: [
        { ticketNumber: 'asc' },
      ],
    });

    // Filter by userId if provided (from userIds JSON array)
    let filteredTasks = takenTasks;
    if (userId) {
      filteredTasks = takenTasks.filter((tt) => {
        // Parse userIds if it's a string
        let userIdsList: string[] = [];
        if (typeof tt.userIds === 'string') {
          try {
            userIdsList = JSON.parse(tt.userIds);
          } catch (e) {
            userIdsList = (tt.userIds as unknown) as any[];
          }
        } else {
          userIdsList = (Array.isArray(tt.userIds) ? tt.userIds : []) as string[];
        }
        return userIdsList.includes(userId as string);
      });
    }

    // Fetch user data for each task's assigned users
    const tasksWithUsers = await Promise.all(
      filteredTasks.map(async (task) => {
        // userIds is stored as a JSON string in the DB — parse it (mirrors getTakenTaskById)
        let userIdsList: string[] = [];
        if (typeof task.userIds === 'string') {
          try {
            const parsed = JSON.parse(task.userIds);
            userIdsList = Array.isArray(parsed) ? parsed : [];
          } catch (e) {
            userIdsList = [];
          }
        } else if (Array.isArray(task.userIds)) {
          userIdsList = task.userIds;
        }
        const users = await prisma.user.findMany({
          where: { id: { in: userIdsList } },
          select: { id: true, name: true, email: true },
        });
        return { ...task, users };
      })
    );

    // Sort to move null ticketNumbers to the end
    const sortedTasks = tasksWithUsers.sort((a, b) => {
      if (a.ticketNumber === null && b.ticketNumber === null) return 0;
      if (a.ticketNumber === null) return 1;
      if (b.ticketNumber === null) return -1;
      return a.ticketNumber.localeCompare(b.ticketNumber, undefined, { numeric: true });
    });

    res.json({ takenTasks: formatTakenTasksResponse(await attachTaskCreatorsToAssignments(sortedTasks)) });
  } catch (error) {
    next(error);
  }
};

/**
 * Get taken task by ID
 */
export const getTakenTaskById = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;

    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      include: {
        task: { include: TASK_CREATOR_INCLUDE },
        locations: {
          orderBy: { recordedAt: 'desc' },
        },
        reports: {
          orderBy: { createdAt: 'desc' },
        },
      },
    });

    if (!takenTask) {
      throw new AppError('Assignment not found', 404);
    }

    // Parse userIds from JSON if needed
    let userIdsList: string[] = [];
    if (typeof takenTask.userIds === 'string') {
      try {
        userIdsList = JSON.parse(takenTask.userIds);
      } catch (e) {
        userIdsList = (takenTask.userIds as unknown) as any[];
      }
    } else {
      userIdsList = (Array.isArray(takenTask.userIds) ? takenTask.userIds : []) as string[];
    }

    // Fetch user data for assigned users
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsList } },
      select: { id: true, name: true, email: true },
    });
    const [takenTaskWithUsers] = await attachTaskCreatorsToAssignments([{ ...takenTask, users }]);

    res.json({ takenTask: formatTakenTaskResponse(takenTaskWithUsers) });
  } catch (error) {
    next(error);
  }
};

/**
 * Assign task to one or more users
 */
export const assignTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { taskId, userIds, teamId, date, startTime, endTime } = req.body;

    // Merge explicit userIds with team members into a single assignedUserIds list.
    // leaderId is NOT an auto-member of the team — callers must include the leader
    // in memberIds if they want them assigned.
    let assignedUserIds: string[] = [];
    if (Array.isArray(userIds)) {
      assignedUserIds = [...userIds];
    } else if (typeof userIds === 'string') {
      try {
        const parsed = JSON.parse(userIds);
        if (Array.isArray(parsed)) assignedUserIds = parsed;
      } catch (e) {
        // ignore invalid
      }
    }

    if (teamId) {
      const team = await prisma.team.findUnique({
        where: { id: teamId },
        include: { users: { select: { id: true } } },
      });

      if (!team) {
        throw new AppError('Team not found', 404);
      }

      const memberIds = team.users.map((u) => u.id);
      assignedUserIds = Array.from(new Set([...assignedUserIds, ...memberIds]));
    }

    if (assignedUserIds.length === 0) {
      throw new AppError('At least one user must be assigned', 400);
    }

    // Verify task exists
    const task = await prisma.task.findUnique({
      where: { taskId },
    });

    if (!task) {
      throw new AppError('Task not found', 404);
    }

    // Generate unique ticket number
    const ticketNumber = await generateUniqueTicketNumber('ASN');

    // Create user statuses object (all start as pending)
    const userStatuses: Record<string, string> = {};
    assignedUserIds.forEach((userId: string) => {
      userStatuses[userId] = 'pending';
    });

    console.log(`[assignTask] Creating task with users: ${JSON.stringify(assignedUserIds)}, initial statuses: ${JSON.stringify(userStatuses)}`);

    const takenTask = await prisma.takenTask.create({
      data: {
        takenTaskId: uuidv4(),
        ticketNumber,
        taskId,
        teamId: teamId || null,
        userIds: JSON.stringify(assignedUserIds),
        userStatuses: JSON.stringify(userStatuses),
        date: date ? new Date(date) : null,
        startTime: startTime ? new Date(startTime) : null,
        status: 'pending',
      },
      include: {
        task: true,
      },
    });

    // Fetch user data for assigned users
    const users = await prisma.user.findMany({
      where: { id: { in: assignedUserIds } },
      select: { id: true, name: true, email: true },
    });
    const takenTaskWithUsers = { ...takenTask, users };

    // ❌ KODE NON-AKTIF: Dinonaktifkan karena memicu notifikasi ganda (versi Bahasa Inggris bawaan)
    // try {
    //   await sendTaskAssignmentNotification(userIds, task.title, takenTask.takenTaskId);
    // } catch (error) {
    //   console.error('Failed to send push notifications:', error);
    // }

    // =========================================================
// ✅ TRIGGER NOTIFIKASI UTAMA (IN-APP & EXPO PUSH DENGAN DEEP LINKING)
// =========================================================
try {
   console.log(`[DEBUG TASK] Mulai proses notif assign. assignedUserIds:`, assignedUserIds);

   // 1. Pastikan userIds adalah array (merged dari userIds eksplisit + anggota tim)
   let targetUserIds: string[] = [];
   if (Array.isArray(assignedUserIds)) {
       targetUserIds = assignedUserIds;
   } else if (typeof assignedUserIds === 'string') {
       try { targetUserIds = JSON.parse(assignedUserIds); } catch(e) {}
   }

  console.log(`[DEBUG TASK] targetUserIds (setelah dipastikan array):`, targetUserIds);

  if (targetUserIds.length > 0) {
      // 2. Simpan ke database
      const notificationData = targetUserIds.map((uid: string) => ({
          userId: uid,
          title: "Tugas Baru Diberikan!",
          message: `Admin telah menugaskan Anda untuk tiket ${ticketNumber || 'baru'}. Silakan cek daftar tugas Anda.`,
          category: "TASK",
          relatedId: takenTask.takenTaskId,
      }));

      await prisma.notification.createMany({ data: notificationData });
      console.log(`[DEBUG TASK] Berhasil simpan ${targetUserIds.length} notif ke DB.`);

      // 3. Ambil data Push Token
      const usersToNotify = await prisma.user.findMany({
          where: { id: { in: targetUserIds } },
          select: { id: true, name: true, pushToken: true }
      });

      console.log(`[DEBUG TASK] Ditemukan ${usersToNotify.length} user di DB. Data:`, usersToNotify);

      let messages: any[] = [];
      for (let u of usersToNotify) {
          if (u.pushToken && Expo.isExpoPushToken(u.pushToken)) {
              messages.push({
                  to: u.pushToken,
                  sound: 'default',
                  channelId: 'default',
                  title: 'Tugas Baru C-Track! 📋',
                  body: `Halo ${u.name}, Admin memberikan tugas baru untukmu (Tiket: ${ticketNumber})`,
                  data: {
                      category: 'TASK',
                      relatedId: takenTask.takenTaskId,
                      type: 'NEW_TASK',
                      takenTaskId: takenTask.takenTaskId,
                  },
              });
          } else {
              console.log(`[DEBUG TASK] User ${u.name} TIDAK PUNYA Push Token valid.`);
          }
      }

      // 4. Kirim Push Notif
      if (messages.length > 0) {
          console.log(`[DEBUG TASK] Mengirim ${messages.length} push notif ke Expo...`);
          const chunks = expo.chunkPushNotifications(messages);
          for (let chunk of chunks) {
              try {
                  await expo.sendPushNotificationsAsync(chunk);
                  console.log(`[Push Notif] Sukses terkirim!`);
              } catch (error) {
                  console.error('[Push Notif Expo Error]:', error);
              }
          }
      } else {
          console.log(`[DEBUG TASK] Tidak ada push notif yang dikirim karena tidak ada token yang valid.`);
      }
  }
} catch (notifError) {
  console.error('[Notifikasi Keseluruhan Error]:', notifError);
}
// =========================================================

    res.status(201).json({
      message: 'Task assigned successfully',
      takenTask: formatTakenTaskResponse(takenTaskWithUsers),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Update taken task status (single user status)
 */
export const updateTakenTaskStatus = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const { status } = req.body;

    if (!status) {
      throw new AppError('Status is required', 400);
    }

    if (!EMPLOYEE_STATUSES.includes(status)) {
      throw new AppError(`Status must be one of: ${EMPLOYEE_STATUSES.join(', ')}`, 400);
    }

    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
    });

    if (!takenTask) {
      throw new AppError('Assignment not found', 404);
    }

    let userStatuses: Record<string, string> = {};
    if (typeof takenTask.userStatuses === 'string') {
      try {
        userStatuses = JSON.parse(takenTask.userStatuses);
      } catch (e) {
        userStatuses = (takenTask.userStatuses as unknown) as Record<string, string>;
      }
    } else {
      userStatuses = takenTask.userStatuses as Record<string, string>;
    }

    if (!userStatuses[userId]) {
      throw new AppError('User not assigned to this task', 400);
    }

    userStatuses[userId] = status;

    const allStatuses = Object.values(userStatuses);
    let overallStatus = takenTask.status;

    if (allStatuses.every((s) => s === 'completed')) {
      overallStatus = 'completed';
    } else if (allStatuses.some((s) => s === 'in_progress')) {
      overallStatus = 'in_progress';
    }

    const updatedTask = await prisma.takenTask.update({
      where: { takenTaskId },
      data: {
        userStatuses: JSON.stringify(userStatuses),
        status: overallStatus,
        ...(status === 'in_progress' && !takenTask.startTime && {
          startTime: getJakartaTime(),
        }),
        ...(status === 'completed' && { endTime: getJakartaTime() }),
      },
      include: {
        task: true,
      },
    });

    let userIdsList: string[] = [];
    if (typeof updatedTask.userIds === 'string') {
      try { userIdsList = JSON.parse(updatedTask.userIds); } catch { userIdsList = []; }
    } else {
      userIdsList = (Array.isArray(updatedTask.userIds) ? updatedTask.userIds : []) as string[];
    }
    const users = await prisma.user.findMany({
      where: { id: { in: userIdsList } },
      select: { id: true, name: true, email: true },
    });
    const updatedTaskWithUsers = { ...updatedTask, users };

    const taskTitle = updatedTask.task?.title || '';
    const completingUserName = users.find((u) => u.id === userId)?.name || 'Anggota tim';

    userIdsList.forEach((uid: string) => {
      io.to(`user:${uid}`).emit('task:status_updated', {
        takenTaskId,
        userId,
        status,
        overallStatus,
        userIds: userIdsList,
        taskTitle,
      });
    });

    if (status === 'completed' && overallStatus !== 'completed') {
      const pendingUids = userIdsList.filter((uid: string) => uid !== userId && userStatuses[uid] !== 'completed');
      userIdsList.forEach((uid: string) => {
        if (uid !== userId && userStatuses[uid] !== 'completed') {
          io.to(`user:${uid}`).emit('task:colleague_update', {
            takenTaskId,
            userId,
            userName: completingUserName,
            status: 'completed',
            overallStatus,
            taskTitle,
          });
        }
      });
      await checkLeaderboardAchievement();
    }

    // =========================================================
    // 🔥 TRIGGER NOTIFIKASI KE ADMIN (JIRA FR-01.5)
    // =========================================================
    if (overallStatus === 'completed') {
      try {
        // Penerima: semua user yang boleh melihat penugasan (RBAC: assignments.view)
        const admins = await findUsersWithPermission('assignments.view', { id: true, name: true, pushToken: true });

        if (admins.length > 0) {
          const adminNotifData = admins.map((admin) => ({
            userId: admin.id,
            title: "Tugas Selesai! ✅",
            message: `Tim (${completingUserName} dkk) telah menyelesaikan tugas dengan tiket ${updatedTask.ticketNumber || 'N/A'}.`,
            category: "TASK_COMPLETED",
            relatedId: takenTaskId,
          }));

          await prisma.notification.createMany({ data: adminNotifData });

          admins.forEach((admin) => {
            io.to(`user:${admin.id}`).emit('admin:task_completed', {
              takenTaskId,
              ticketNumber: updatedTask.ticketNumber,
              taskTitle,
              completedBy: completingUserName,
              message: `Tugas ${taskTitle} telah selesai 100%.`
            });
          });
        }
      } catch (adminNotifError) {
        console.error('[Admin Notif Error]: Gagal mengirim notif ke admin', adminNotifError);
      }
    }
    // =========================================================

    if (status === 'completed') {
      try {
        if (overallStatus === 'completed') {
          await sendTaskCompletionNotification(userIdsList, taskTitle, takenTaskId);
        } else {
          await sendPartialCompletionNotification(userId, taskTitle, takenTaskId);
          const pendingTeammates = userIdsList.filter(
            (uid) => uid !== userId && userStatuses[uid] !== 'completed'
          );
          if (pendingTeammates.length > 0) {
            await sendColleagueCompletionNotification(
              pendingTeammates,
              completingUserName,
              taskTitle,
              takenTaskId
            );
          }
        }
      } catch (pushError) {
        console.error('Failed to send completion push notifications:', pushError);
      }

      // 🚀 TRIGGER ALARM LEADERBOARD DISINI
      checkLeaderboardAchievement();
    }

    res.json({
      message: 'Status updated successfully',
      takenTask: formatTakenTaskResponse(updatedTaskWithUsers),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Start tracking - when user clicks swipeable button
 */
export const startTracking = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
    });

    if (!takenTask) {
      throw new AppError('Assignment not found', 404);
    }

    let userIdsList: string[] = [];
    if (typeof takenTask.userIds === 'string') {
      try {
        userIdsList = JSON.parse(takenTask.userIds);
      } catch (e) {
        userIdsList = (takenTask.userIds as unknown) as any[];
      }
    } else {
      userIdsList = (Array.isArray(takenTask.userIds) ? takenTask.userIds : []) as string[];
    }

    if (!userIdsList.includes(userId)) {
      throw new AppError('User not assigned to this task', 400);
    }

    let userStatuses: Record<string, string> = {};
    if (typeof takenTask.userStatuses === 'string') {
      try {
        userStatuses = JSON.parse(takenTask.userStatuses);
      } catch (e) {
        userStatuses = (takenTask.userStatuses as unknown) as Record<string, string>;
      }
    } else if (typeof takenTask.userStatuses === 'object' && takenTask.userStatuses !== null) {
      userStatuses = takenTask.userStatuses as Record<string, string>;
    } else {
      userStatuses = {};
    }

    userStatuses[userId] = 'in_progress';

    const allUserStatuses = Object.values(userStatuses);
    const allInProgress = allUserStatuses.every((s) => s === 'in_progress');
    const overallStatus = allInProgress ? 'in_progress' : 'pending';

    const updatedTask = await prisma.takenTask.update({
      where: { takenTaskId },
      data: {
        userStatuses: JSON.stringify(userStatuses),
        status: overallStatus,
        ...(allInProgress && !takenTask.startTime && {
          startTime: getJakartaTime(),
        }),
      },
      include: {
        task: true,
      },
    });

    const users = await prisma.user.findMany({
      where: { id: { in: userIdsList } },
      select: { id: true, name: true, email: true },
    });
    const updatedTaskWithUsers = { ...updatedTask, users };

    userIdsList.forEach((uid: string) => {
      io.to(`user:${uid}`).emit('task:tracking_started', {
        takenTaskId,
        userId,
        allUsersInProgress: allInProgress,
        overallStatus,
        userStatuses,
      });
    });

    res.json({
      message: allInProgress
        ? 'Tracking started for all users'
        : 'User tracking started, waiting for other users',
      allUsersInProgress: allInProgress,
      takenTask: formatTakenTaskResponse(updatedTaskWithUsers),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Fungsi khusus untuk menyelesaikan task (tanpa body parameter)
 */
export const completeTakenTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const userId = req.user?.userId;

    const status = 'completed';

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const takenTask = await prisma.takenTask.findUnique({
      where: { takenTaskId },
    });

    if (!takenTask) {
      throw new AppError('Assignment not found', 404);
    }

    let userStatuses: Record<string, string> = {};
    if (typeof takenTask.userStatuses === 'string') {
      try {
        userStatuses = JSON.parse(takenTask.userStatuses);
      } catch (e) {
        userStatuses = (takenTask.userStatuses as unknown) as Record<string, string>;
      }
    } else {
      userStatuses = takenTask.userStatuses as Record<string, string>;
    }

    if (!userStatuses[userId]) {
      throw new AppError('User not assigned to this task', 400);
    }

    userStatuses[userId] = status;

    const allStatuses = Object.values(userStatuses);
    let overallStatus = takenTask.status;

    if (allStatuses.every((s) => s === 'completed')) {
      overallStatus = 'completed';
    } else if (allStatuses.some((s) => s === 'in_progress')) {
      overallStatus = 'in_progress';
    }

    const updatedTask = await prisma.takenTask.update({
      where: { takenTaskId },
      data: {
        userStatuses: JSON.stringify(userStatuses),
        status: overallStatus,
        endTime: getJakartaTime(),
      },
      include: {
        task: true,
      },
    });

    let userIdsList: string[] = [];
    if (typeof updatedTask.userIds === 'string') {
      try { userIdsList = JSON.parse(updatedTask.userIds); } catch { userIdsList = []; }
    } else {
      userIdsList = (Array.isArray(updatedTask.userIds) ? updatedTask.userIds : []) as string[];
    }

    const users = await prisma.user.findMany({
      where: { id: { in: userIdsList } },
      select: { id: true, name: true, email: true },
    });
    const updatedTaskWithUsers = { ...updatedTask, users };

    const taskTitle = updatedTask.task?.title || '';
    const completingUserName = users.find((u) => u.id === userId)?.name || 'Anggota tim';

    // Socket.io Updates
    userIdsList.forEach((uid: string) => {
      io.to(`user:${uid}`).emit('task:status_updated', {
        takenTaskId,
        userId,
        status,
        overallStatus,
        userIds: userIdsList,
        taskTitle,
      });
    });

    if (overallStatus !== 'completed') {
      const pendingUids = userIdsList.filter((uid: string) => uid !== userId && userStatuses[uid] !== 'completed');
      userIdsList.forEach((uid: string) => {
        if (uid !== userId && userStatuses[uid] !== 'completed') {
          io.to(`user:${uid}`).emit('task:colleague_update', {
            takenTaskId,
            userId,
            userName: completingUserName,
            status: 'completed',
            overallStatus,
            taskTitle,
          });
        }
      });
      await checkLeaderboardAchievement();
    }

    // =========================================================
    // 🔥 TRIGGER NOTIFIKASI KE ADMIN (JIRA FR-01.5)
    // =========================================================
    if (overallStatus === 'completed') {
      try {
        // Penerima: semua user yang boleh melihat penugasan (RBAC: assignments.view)
        const admins = await findUsersWithPermission('assignments.view', { id: true, name: true, pushToken: true });

        if (admins.length > 0) {
          const adminNotifData = admins.map((admin) => ({
            userId: admin.id,
            title: "Tugas Selesai! ✅",
            message: `Tim (${completingUserName} dkk) telah menyelesaikan tugas dengan tiket ${updatedTask.ticketNumber || 'N/A'}.`,
            category: "TASK_COMPLETED",
            relatedId: takenTaskId,
          }));

          await prisma.notification.createMany({ data: adminNotifData });

          admins.forEach((admin) => {
            io.to(`user:${admin.id}`).emit('admin:task_completed', {
              takenTaskId,
              ticketNumber: updatedTask.ticketNumber,
              taskTitle,
              completedBy: completingUserName,
              message: `Tugas ${taskTitle} telah selesai 100%.`
            });
          });
        }
      } catch (adminNotifError) {
        console.error('[Admin Notif Error]: Gagal mengirim notif ke admin', adminNotifError);
      }
    }
    // =========================================================

    // Expo Push Notifications
    try {
      if (overallStatus === 'completed') {
        await sendTaskCompletionNotification(userIdsList, taskTitle, takenTaskId);
      } else {
        await sendPartialCompletionNotification(userId, taskTitle, takenTaskId);
        const pendingTeammates = userIdsList.filter(
          (uid) => uid !== userId && userStatuses[uid] !== 'completed'
        );
        if (pendingTeammates.length > 0) {
          await sendColleagueCompletionNotification(
            pendingTeammates,
            completingUserName,
            taskTitle,
            takenTaskId
          );
        }
      }
    } catch (pushError) {
      console.error('Failed to send completion push notifications:', pushError);
    }

    // 🚀 TRIGGER ALARM LEADERBOARD DISINI
    checkLeaderboardAchievement();

    res.json({
      message: 'Task completed successfully! Notification sent to Admin.',
      takenTask: formatTakenTaskResponse(updatedTaskWithUsers),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Delete taken task
 */
export const deleteTakenTask = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;

    await prisma.takenTask.delete({
      where: { takenTaskId },
    });

    res.json({ message: 'Assignment deleted successfully' });
  } catch (error) {
    next(error);
  }
};

/**
 * Update assignment (assignments.update)
 * Body (all optional): userIds, teamId, date, startTime.
 * Retained users keep their status, added users start as 'pending', removed users are dropped.
 */
export const updateAssignment = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const { takenTaskId } = req.params;
    const { userIds, teamId, date, startTime } = req.body;

    const existing = await prisma.takenTask.findUnique({
      where: { takenTaskId },
      include: { task: true },
    });

    if (!existing) {
      throw new AppError('Assignment not found', 404);
    }

    if (existing.status === 'completed') {
      throw new AppError('Penugasan yang sudah selesai tidak dapat diubah', 409);
    }

    const parseJson = <T>(value: unknown, fallback: T): T => {
      if (typeof value !== 'string') return (value as T) ?? fallback;
      try {
        return JSON.parse(value) as T;
      } catch {
        return fallback;
      }
    };

    const currentUserIds = parseJson<string[]>(existing.userIds, []);
    const currentStatuses = parseJson<Record<string, string>>(existing.userStatuses, {});

    const updateData: Record<string, unknown> = {};
    let nextUserIds = currentUserIds;

    if (userIds !== undefined || teamId) {
      let requested: string[] = [];
      if (Array.isArray(userIds)) {
        requested = [...userIds];
      } else if (typeof userIds === 'string') {
        requested = parseJson<string[]>(userIds, []);
      } else if (userIds === undefined) {
        requested = [...currentUserIds];
      }

      if (teamId) {
        const team = await prisma.team.findUnique({
          where: { id: teamId },
          include: { users: { select: { id: true } } },
        });
        if (!team) {
          throw new AppError('Team not found', 404);
        }
        requested = [...requested, ...team.users.map((u) => u.id)];
      }

      nextUserIds = Array.from(new Set(requested.map(String)));
      if (nextUserIds.length === 0) {
        throw new AppError('At least one user must be assigned', 400);
      }

      const nextStatuses: Record<string, string> = {};
      nextUserIds.forEach((uid) => {
        nextStatuses[uid] = currentStatuses[uid] || 'pending';
      });

      updateData.userIds = JSON.stringify(nextUserIds);
      updateData.userStatuses = JSON.stringify(nextStatuses);
    }

    if (teamId !== undefined) updateData.teamId = teamId || null;
    if (date !== undefined) updateData.date = date ? new Date(date) : null;
    if (startTime !== undefined) updateData.startTime = startTime ? new Date(startTime) : null;

    const updated = await prisma.takenTask.update({
      where: { takenTaskId },
      data: updateData,
      include: { task: { include: TASK_CREATOR_INCLUDE } },
    });

    // Notify newly added employees (in-app + push), same wording as assignTask
    const addedUserIds = nextUserIds.filter((uid) => !currentUserIds.includes(uid));
    if (addedUserIds.length > 0) {
      try {
        await prisma.notification.createMany({
          data: addedUserIds.map((uid) => ({
            userId: uid,
            title: 'Tugas Baru Diberikan!',
            message: `Anda ditambahkan ke penugasan tiket ${updated.ticketNumber || 'baru'}. Silakan cek daftar tugas Anda.`,
            category: 'TASK',
            relatedId: updated.takenTaskId,
          })),
        });

        const usersToNotify = await prisma.user.findMany({
          where: { id: { in: addedUserIds } },
          select: { id: true, name: true, pushToken: true },
        });
        const messages = usersToNotify
          .filter((u) => u.pushToken && Expo.isExpoPushToken(u.pushToken))
          .map((u) => ({
            to: u.pushToken as string,
            sound: 'default' as const,
            channelId: 'default',
            title: 'Tugas Baru C-Track! 📋',
            body: `Halo ${u.name}, kamu ditambahkan ke penugasan (Tiket: ${updated.ticketNumber})`,
            data: {
              category: 'TASK',
              relatedId: updated.takenTaskId,
              type: 'NEW_TASK',
              takenTaskId: updated.takenTaskId,
            },
          }));
        for (const chunk of expo.chunkPushNotifications(messages)) {
          await expo.sendPushNotificationsAsync(chunk);
        }
      } catch (notifError) {
        console.error('[updateAssignment] Failed to notify added users:', notifError);
      }
    }

    const users = await prisma.user.findMany({
      where: { id: { in: nextUserIds } },
      select: { id: true, name: true, email: true },
    });
    const [takenTaskWithUsers] = await attachTaskCreatorsToAssignments([{ ...updated, users }]);

    res.json({
      message: 'Assignment updated successfully',
      takenTask: formatTakenTaskResponse(takenTaskWithUsers),
    });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's assigned tasks
 */
export const getUserTasks = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    // Admin route /admin/assignments/user/:userId asks for another user's tasks;
    // the employee route /my-tasks has no param and returns the caller's own tasks.
    const userId = req.params.userId || req.user?.userId;
    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const takenTasks = await prisma.takenTask.findMany({
      include: {
        task: true,
        locations: {
          where: { userId },
          orderBy: { recordedAt: 'desc' },
          take: 1,
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    const userTasks = takenTasks.filter((tt) => {
      let userIdsList: string[] = [];
      if (typeof tt.userIds === 'string') {
        userIdsList = JSON.parse(tt.userIds);
      } else if (Array.isArray(tt.userIds)) {
        userIdsList = tt.userIds as string[];
      }
      return userIdsList.includes(userId);
    });

    const tasksWithUsers = await Promise.all(
      userTasks.map(async (task) => {
        const userIdsList = (Array.isArray(task.userIds) ? task.userIds : []) as string[];
        const users = await prisma.user.findMany({
          where: { id: { in: userIdsList } },
          select: { id: true, name: true, email: true },
        });
        return { ...task, users };
      })
    );

    res.json({ tasks: formatTakenTasksResponse(tasksWithUsers) });
  } catch (error) {
    next(error);
  }
};

/**
 * Get user's task statistics
 */
export const getMyStatistics = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
) => {
  try {
    const userId = req.user?.userId;

    if (!userId) {
      throw new AppError('User not authenticated', 401);
    }

    const allTasks = await prisma.takenTask.findMany({
      include: { task: true },
    });

    const userTasks = allTasks.filter((tt) => {
      let userIdsList: string[] = [];
      if (typeof tt.userIds === 'string') {
        userIdsList = JSON.parse(tt.userIds);
      } else if (Array.isArray(tt.userIds)) {
        userIdsList = tt.userIds as string[];
      }
      return userIdsList.includes(userId);
    });

    const statistics = {
      totalTasks: userTasks.length,
      completedTasks: userTasks.filter((t) => t.status === 'completed').length,
      inProgressTasks: userTasks.filter((t) => t.status === 'in_progress').length,
      pendingTasks: userTasks.filter((t) => t.status === 'pending').length,
      cancelledTasks: userTasks.filter((t) => t.status === 'cancelled').length,
    };

    res.json({ statistics });
  } catch (error) {
    next(error);
  }
};