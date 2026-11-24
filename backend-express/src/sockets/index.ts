import { Server, Socket } from 'socket.io';
import { onlineUsers } from "./socketStore";

import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';
import prisma from '../config/database';
import { getJakartaTime } from '../utils/timezone';
import { can, loadAccess } from '../rbac/access';
import { isAssignedTo } from '../rbac/assignmentAccess';

interface SocketUser {
  userId: string;
  email: string;
  role: string;
  name: string;
  level: number;
  permissions: string[];
  /** Unauthenticated dev-mode connection (no token): identity is client-supplied and untrusted */
  guest?: boolean;
}

interface AuthenticatedSocket extends Socket {
  user?: SocketUser;
}

// Permission rooms: real-time monitoring events go only to users who may see them
export const PERMISSION_ROOMS = {
  LOCATIONS: 'perm:monitoring.view_locations',
  REPORTS: 'perm:monitoring.view_reports',
  ASSIGNMENTS: 'perm:assignments.view',
} as const;

const joinPermissionRooms = (socket: AuthenticatedSocket) => {
  if (!socket.user) return;
  const rooms: Array<[string, string]> = [
    [PERMISSION_ROOMS.LOCATIONS, 'monitoring.view_locations'],
    [PERMISSION_ROOMS.REPORTS, 'monitoring.view_reports'],
    [PERMISSION_ROOMS.ASSIGNMENTS, 'assignments.view'],
  ];
  for (const [room, permission] of rooms) {
    if (can(socket.user, permission)) {
      socket.join(room);
    } else {
      socket.leave(room);
    }
  }
};

/**
 * Reload role/permissions for every socket of a user and re-join permission rooms.
 * Called after a role's permissions or a user's role change (rbac/notify.ts).
 */
export const refreshSocketAccess = async (io: Server, userId: string) => {
  const sockets = await io.in(`user:${userId}`).fetchSockets();
  if (sockets.length === 0) return;
  const access = await loadAccess(userId);
  for (const remote of sockets) {
    if (!access || access.status !== 'active') {
      remote.disconnect(true);
      continue;
    }
    // socket.data.user is the same object as socket.user (set in the auth middleware)
    const user = (remote.data as { user?: SocketUser } | undefined)?.user;
    if (user) {
      user.role = access.role;
      user.level = access.level;
      user.permissions = access.permissions;
    }
    for (const room of Object.values(PERMISSION_ROOMS)) {
      if (access.role === 'superadmin' || access.permissions.includes(room.replace('perm:', ''))) {
        remote.join(room);
      } else {
        remote.leave(room);
      }
    }
  }
};

/** Chat access: authenticated (not a dev guest) and assigned to the task, or staff with monitoring.view_reports */
const canAccessChat = async (user: SocketUser | undefined, takenTaskId: unknown): Promise<boolean> => {
  if (!user || user.guest || typeof takenTaskId !== 'string' || !takenTaskId) return false;
  if (can(user, 'monitoring.view_reports')) return true;
  const takenTask = await prisma.takenTask.findUnique({
    where: { takenTaskId },
    select: { userIds: true },
  });
  return Boolean(takenTask && isAssignedTo(takenTask, user.userId));
};

/** Forum access: authenticated (not a dev guest) and the reporter, assigned to the task, or staff with monitoring.view_reports */
const canAccessForum = async (user: SocketUser | undefined, reportId: unknown): Promise<boolean> => {
  if (!user || user.guest || typeof reportId !== 'string' || !reportId) return false;
  if (can(user, 'monitoring.view_reports')) return true;
  const report = await prisma.report.findUnique({
    where: { reportId },
    select: { userId: true, takenTask: { select: { userIds: true } } },
  });
  if (!report) return false;
  return report.userId === user.userId || Boolean(report.takenTask && isAssignedTo(report.takenTask, user.userId));
};

export const initSocketHandlers = (io: Server) => {
  // Middleware: Authenticate socket connections
  io.use(async (socket: AuthenticatedSocket, next) => {
    try {
      let token = socket.handshake.auth?.token;
  
      // 🔥 fallback header
      if (!token) {
        const authHeader = socket.handshake.headers.authorization;
        if (authHeader?.startsWith("Bearer ")) {
          token = authHeader.split(" ")[1];
        }
      }
  
      if (!token) {
        console.log("⚠️ NO TOKEN - DEV MODE");
      
        const userId = socket.handshake.query.userId as string;
      
        // Unauthenticated dev connections never get permissions (no monitoring rooms, no admin events)
        socket.user = {
          userId: userId || "guest-" + Math.random(),
          email: "dev@mail.com",
          role: userId === "admin-user" ? "admin" : "employee",
          name: userId,
          level: 0,
          permissions: [],
          guest: true,
        };
        socket.data.user = socket.user;
      
        return next();
      }
  
      const decoded = jwt.verify(token, process.env.JWT_SECRET!) as any;
  
      const access = await loadAccess(decoded.userId);
  
      if (!access) {
        return next(new Error("User not found"));
      }
  
      socket.user = {
        userId: access.userId,
        email: access.email,
        role: access.role,
        name: access.name,
        level: access.level,
        permissions: access.permissions,
      };
      socket.data.user = socket.user;
  
      next();
    } catch (err) {
      next(new Error("Authentication error"));
    }
  });

  // Handle connections
  io.on('connection', (socket: AuthenticatedSocket) => {
    if (!socket.user) return;

    console.log(`✅ User connected: ${socket.user.name} (${socket.user.role})`);

    // Join permission-based rooms (replaces the old role-based 'admins' room)
    joinPermissionRooms(socket);

    socket.join(`user:${socket.user.userId}`);
    onlineUsers.set(socket.user.userId, socket.id);

    console.log("ONLINE USERS:", [...onlineUsers.keys()]);
    
    // Send connection confirmation
    socket.emit('connected', {
      message: 'Connected to tracking server',
      userId: socket.user.userId,
      role: socket.user.role,
    });

    /**
     * Client asks to reload its access after receiving 'rbac:updated'
     */
    socket.on('rbac:refresh', async () => {
      if (!socket.user || socket.user.guest) return;
      const access = await loadAccess(socket.user.userId);
      if (!access || access.status !== 'active') {
        socket.disconnect(true);
        return;
      }
      socket.user.role = access.role;
      socket.user.level = access.level;
      socket.user.permissions = access.permissions;
      joinPermissionRooms(socket);
    });

    // ==========================================
    // LOCATION TRACKING EVENTS
    // ==========================================

    /**
     * Employee sends real-time location update
     */
    socket.on('location:update', async (data) => {
      try {
        const {
          takenTaskId,
          latitude,
          longitude,
          accuracy,
          address,
          trackingStatus,
        } = data;

        // Save to database
        const location = await prisma.location.create({
          data: {
            locationId: uuidv4(),
            takenTaskId,
            userId: socket.user!.userId,
            latitude: parseFloat(latitude),
            longitude: parseFloat(longitude),
            accuracy: accuracy ? parseFloat(accuracy) : null,
            address,
            trackingStatus: trackingStatus || 'auto',
            recordedAt: getJakartaTime(),
          },
          include: {
            user: {
              select: {
                id: true,
                name: true,
                email: true,
                avatar: true,
              },
            },
            takenTask: {
              include: {
                task: {
                  select: {
                    taskId: true,
                    title: true,
                    ticketNumber: true,
                  },
                },
              },
            },
          },
        });

        console.log(
          `📍 Location update from ${socket.user!.name}: ${latitude}, ${longitude}`
        );

        // Broadcast to admin room for real-time monitoring
        io.to(PERMISSION_ROOMS.LOCATIONS).emit('location:updated', {
          locationId: location.locationId,
          takenTaskId,
          userId: socket.user!.userId,
          userName: socket.user!.name,
          latitude: parseFloat(latitude),
          longitude: parseFloat(longitude),
          accuracy,
          address,
          // Convert recordedAt to proper timezone (MySQL stores as Jakarta time)
          recordedAt: new Date(new Date(location.recordedAt).getTime() - 7 * 60 * 60 * 1000).toISOString(),
          task: location.takenTask.task,
        });

        // Acknowledge to sender
        socket.emit('location:saved', {
          locationId: location.locationId,
          // Convert recordedAt to proper timezone (MySQL stores as Jakarta time)
          recordedAt: new Date(new Date(location.recordedAt).getTime() - 7 * 60 * 60 * 1000).toISOString(),
        });
      } catch (error: any) {
        console.error('❌ Location update error:', error.message);
        socket.emit('error', {
          message: 'Failed to save location',
          error: error.message,
        });
      }
    });

    /**
     * Admin subscribes to specific user's location
     */
    socket.on('location:subscribe', (data) => {
      if (!can(socket.user, 'monitoring.view_locations')) {
        return socket.emit('error', {
          message: 'Unauthorized: Admin access required',
        });
      }

      const { userId } = data;
      socket.join(`location:${userId}`);
      console.log(`👀 Admin ${socket.user!.name} subscribed to user ${userId}`);
    });

    /**
     * Admin unsubscribes from user's location
     */
    socket.on('location:unsubscribe', (data) => {
      const { userId } = data;
      socket.leave(`location:${userId}`);
    });

    // ==========================================
    // TASK STATUS EVENTS
    // ==========================================

    /**
     * Task status change (employee updates their status)
     */
    socket.on('task:status_change', async (data) => {
      try {
        const { takenTaskId, status } = data;
        const userId = socket.user!.userId;

        const takenTask = await prisma.takenTask.findUnique({
          where: { takenTaskId },
        });

        if (!takenTask) {
          return socket.emit('error', {
            message: 'Assignment not found',
          });
        }

        // Update user status
        const userStatuses = JSON.parse(takenTask.userStatuses || "{}") as Record<string, string>;
        if (!userStatuses[userId]) {
          return socket.emit('error', {
            message: 'User not assigned to this task',
          });
        }

        userStatuses[userId] = status;

        // Determine overall status
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
            userStatuses,
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

        console.log(
          `📋 Task status updated: ${socket.user!.name} → ${status}`
        );

        // Parse userIds safely (MySQL JSON may come back as a string)
        let userIdsList: string[] = [];
        if (Array.isArray(takenTask.userIds)) {
          userIdsList = takenTask.userIds as string[];
        } else if (typeof takenTask.userIds === 'string') {
          try { userIdsList = JSON.parse(takenTask.userIds); } catch { userIdsList = []; }
        }

        // Broadcast to admins — include userIds so admin clients can filter by assignment
        io.to(PERMISSION_ROOMS.ASSIGNMENTS).emit('task:status_updated', {
          takenTaskId,
          userId,
          userName: socket.user!.name,
          status,
          overallStatus,
          userIds: userIdsList,
          task: updatedTask.task,
          updatedAt: getJakartaTime(),
        });

        // Emit task:status_updated to every assigned user so the mobile app can show
        // the right notification per scenario:
        //   partial completion → completing user gets "⏳ Bagian Anda Selesai"
        //   full completion    → all users get "✅ Task Selesai"
        userIdsList.forEach((uid) => {
          io.to(`user:${uid}`).emit('task:status_updated', {
            takenTaskId,
            userId,
            status,
            overallStatus,
            userIds: userIdsList,
            taskTitle: updatedTask.task?.title || '',
          });
        });

        // For partial completions only: notify teammates who have NOT yet completed.
        if (status === 'completed' && overallStatus !== 'completed') {
          userIdsList.forEach((uid) => {
            if (uid !== userId && userStatuses[uid] !== 'completed') {
              io.to(`user:${uid}`).emit('task:colleague_update', {
                takenTaskId,
                userId,
                userName: socket.user!.name,
                status,
                taskTitle: updatedTask.task?.title || '',
              });
            }
          });
        }

        // Acknowledge to sender
        socket.emit('task:status_saved', {
          takenTaskId,
          status,
          overallStatus,
        });
      } catch (error: any) {
        console.error('❌ Task status update error:', error.message);
        socket.emit('error', {
          message: 'Failed to update task status',
          error: error.message,
        });
      }
    });

    // ==========================================
    // REPORT EVENTS
    // ==========================================

    /**
     * New report submitted
     */
    socket.on('report:created', (data) => {
      console.log(`📝 New report from ${socket.user!.name}`);

      // Notify admins
      io.to(PERMISSION_ROOMS.REPORTS).emit('report:new', {
        reportId: data.reportId,
        userId: socket.user!.userId,
        userName: socket.user!.name,
        takenTaskId: data.takenTaskId,
        createdAt: getJakartaTime(),
      });
    });

    // ==========================================
    // ADMIN BROADCAST EVENTS
    // ==========================================

    /**
     * Admin broadcasts message to all users
     */
    socket.on('admin:broadcast', (data) => {
      if (!can(socket.user, 'assignments.update')) {
        return socket.emit('error', {
          message: 'Unauthorized: Admin access required',
        });
      }

      console.log(`📢 Admin broadcast: ${data.message}`);

      io.emit('admin:broadcast', {
        from: socket.user!.name,
        message: data.message,
        timestamp: getJakartaTime(),
      });
    });

    /**
     * Admin sends message to specific user
     */
    socket.on('admin:message_user', (data) => {
      if (!can(socket.user, 'assignments.update')) {
        return socket.emit('error', {
          message: 'Unauthorized: Admin access required',
        });
      }

      const { userId, message } = data;

      io.to(`user:${userId}`).emit('admin:direct_message', {
        from: socket.user!.name,
        message,
        timestamp: getJakartaTime(),
      });
    });

    // ==========================================
// FORUM REPORT EVENTS
// ==========================================

/**

* Join forum room
  */
  socket.on("forum:join", async (data) => {
    const reportId = data?.reportId;

    // Only forum participants receive live comments (reporter, assigned employees, report monitors)
    if (!(await canAccessForum(socket.user, reportId))) {
      socket.emit("forum:error", { message: "Anda tidak memiliki akses ke forum laporan ini" });
      return;
    }

    const room = `forum:${reportId}`;

    socket.join(room);

    console.log(`📝 ${socket.user!.name} joined forum ${room}`);
  });
  
  /**
  
  * Leave forum room
    */
    socket.on("forum:leave", (data) => {
    const { reportId } = data;
  
  const room = `forum:${reportId}`;
  
  socket.leave(room);
  
  console.log(`🚪 ${socket.user!.name} left forum ${room}`);
  });
  
    // ==========================================
// CHAT PER TASK EVENTS
// ==========================================

/**
 * Join chat room per taken task
 */
socket.on('chat:join', async (data) => {
  const takenTaskId = data?.takenTaskId;

  // Only authenticated users assigned to the task (or staff who monitor reports) may join
  if (!(await canAccessChat(socket.user, takenTaskId))) {
    socket.emit('chat:error', { message: 'Anda tidak memiliki akses ke chat ini' });
    return;
  }

  const room = `chat:${takenTaskId}`;
  socket.join(room);

  console.log(`💬 ${socket.user!.name} joined chat room ${room}`);
});

/**
 * Send chat message
 */
socket.on('chat:send', async (data) => {
  try {
    const { takenTaskId, message } = data || {};

    // Must have joined the room (access checked in chat:join)
    if (typeof takenTaskId !== 'string' || !socket.rooms.has(`chat:${takenTaskId}`)) {
      socket.emit('chat:error', { message: 'Anda tidak memiliki akses ke chat ini' });
      return;
    }
    if (typeof message !== 'string' || !message.trim()) return;

    // 🚨 CEK STATUS TASK DULU
const task = await prisma.takenTask.findUnique({
  where: { takenTaskId },
});

if (!task) return;

// ❌ BLOCK CHAT kalau sudah selesai
if (task.status === "completed") {
  socket.emit("chat:error", {
    message: "Task sudah selesai, chat ditutup",
  });
  return;
}

    const saved = await prisma.chatMessage.create({
      data: {
        id: uuidv4(),
        takenTaskId,
        senderId: socket.user!.userId,
        senderRole: socket.user!.role,
        message,
      },
    });

    console.log(`💬 Message from ${socket.user!.name}: ${message}`);

    // kirim ke semua di room
    io.to(`chat:${takenTaskId}`).emit('chat:receive', {
      id: saved.id,
      takenTaskId,
      senderId: socket.user!.userId,
      senderName: socket.user!.name,
      senderRole: socket.user!.role,
      message,
      createdAt: new Date().toISOString(), // 🔥 pastikan ini ada
    });

  } catch (error: any) {
    console.error('❌ Chat error:', error.message);

    socket.emit('error', {
      message: 'Failed to send message',
    });
  }
});
    // ==========================================
    // PRESENCE EVENTS
    // ==========================================

    /**
     * User announces they're online
     */
    socket.on('user:online', () => {
      io.to(PERMISSION_ROOMS.ASSIGNMENTS).emit('user:status', {
        userId: socket.user!.userId,
        userName: socket.user!.name,
        status: 'online',
        timestamp: getJakartaTime(),
      });
    });

    // ==========================================
    // DISCONNECT
    // ==========================================

    socket.on('disconnect', () => {
      console.log(`❌ User disconnected: ${socket.user!.name}`);
      onlineUsers.delete(socket.user!.userId);

      console.log("ONLINE USERS:", [...onlineUsers.keys()]);
      
      io.to(PERMISSION_ROOMS.ASSIGNMENTS).emit('user:status', {
        userId: socket.user!.userId,
        userName: socket.user!.name,
        status: 'offline',
        timestamp: getJakartaTime(),
        
      });
    });
  });

  console.log('🚀 Socket.io handlers initialized');
};
