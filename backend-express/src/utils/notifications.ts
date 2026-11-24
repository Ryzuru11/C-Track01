import { Expo, ExpoPushMessage, ExpoPushTicket } from 'expo-server-sdk';
import prisma from '../config/database';

/**
 * Push Notification Service using Expo
 * Handles sending push notifications to mobile devices
 */

// Create a new Expo SDK client
const expo = new Expo();

interface NotificationPayload {
  title: string;
  body: string;
  data?: any;
  sound?: 'default' | null;
  priority?: 'default' | 'normal' | 'high';
  channelId?: string;
}

/**
 * Send push notification to specific user
 */
export async function sendNotificationToUser(
  userId: string,
  payload: NotificationPayload
): Promise<void> {
  try {
    // Get user's push token
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { pushToken: true, name: true } as any,
    }) as any;

    if (!user || !user.pushToken) {
      console.log(`⚠️ No push token found for user ${userId}`);
      return;
    }

    // Check that the push token is valid
    if (!Expo.isExpoPushToken(user.pushToken)) {
      console.error(`❌ Invalid Expo push token for user ${userId}, removing from database...`);
      await prisma.user.update({
        where: { id: userId },
        data: { pushToken: null },
      });
      return;
    }

    // Construct the message
    const message: ExpoPushMessage = {
      to: user.pushToken,
      sound: payload.sound || 'default',
      title: payload.title,
      body: payload.body,
      data: payload.data,
      priority: payload.priority || 'high',
      channelId: payload.channelId || 'default',
    };

    // Send the notification
    const ticketChunk = await expo.sendPushNotificationsAsync([message]);
    console.log(`✅ Push notification sent to ${user.name}:`, ticketChunk);

    // Handle ticket errors
    ticketChunk.forEach((ticket: ExpoPushTicket) => {
      if (ticket.status === 'error') {
        console.error(`❌ Error sending notification: ${ticket.message}`);
        if (ticket.details?.error) {
          console.error(`Details: ${ticket.details.error}`);
        }
        // Auto-cleanup if Expo reports the device is no longer registered
        if (ticket.details?.error === 'DeviceNotRegistered') {
          prisma.user.update({
            where: { id: userId },
            data: { pushToken: null },
          }).catch((e) => console.error('Failed to remove invalid token:', e));
        }
      }
    });
  } catch (error) {
    console.error('Error sending push notification:', error);
  }
}

/**
 * Send push notification to multiple users
 */
export async function sendNotificationToUsers(
  userIds: string[],
  payload: NotificationPayload
): Promise<void> {
  try {
    // Get all users' push tokens
    const users = await prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, pushToken: true, name: true } as any,
    }) as any[];

    // Filter users with valid push tokens
    const messages: ExpoPushMessage[] = [];
    const userIdByToken: Record<string, string> = {};
    users.forEach((user) => {
      if (user.pushToken && Expo.isExpoPushToken(user.pushToken)) {
        messages.push({
          to: user.pushToken,
          sound: payload.sound || 'default',
          title: payload.title,
          body: payload.body,
          data: payload.data,
          priority: payload.priority || 'high',
          channelId: payload.channelId || 'default',
        });
        userIdByToken[user.pushToken] = user.id;
      } else if (user.pushToken) {
        // Invalid format - remove from database
        console.warn(`⚠️ Invalid token for user ${user.name}, removing...`);
        prisma.user.update({
          where: { id: user.id },
          data: { pushToken: null },
        }).catch((e) => console.error('Failed to remove invalid token:', e));
      } else {
        console.log(`⚠️ No valid push token for user ${user.name}`);
      }
    });

    if (messages.length === 0) {
      console.log('⚠️ No valid push tokens found for any users');
      return;
    }

    // Send notifications in chunks of 100 (Expo's limit)
    const chunks = expo.chunkPushNotifications(messages);
    const tickets: ExpoPushTicket[] = [];

    for (const chunk of chunks) {
      try {
        const ticketChunk = await expo.sendPushNotificationsAsync(chunk);
        tickets.push(...ticketChunk);
        console.log(`✅ Sent ${chunk.length} push notifications`);
      } catch (error) {
        console.error('Error sending notification chunk:', error);
      }
    }

    // Handle ticket errors
    tickets.forEach((ticket, index) => {
      if (ticket.status === 'error') {
        console.error(`❌ Error sending notification ${index}: ${ticket.message}`);
        if (ticket.details?.error) {
          console.error(`Details: ${ticket.details.error}`);
        }
        // Auto-cleanup invalid tokens reported by Expo
        if (
          ticket.details?.error === 'DeviceNotRegistered' &&
          'to' in messages[index]
        ) {
          const tokenStr = messages[index].to as string;
          const uid = userIdByToken[tokenStr];
          if (uid) {
            prisma.user.update({
              where: { id: uid },
              data: { pushToken: null },
            }).catch((e) => console.error('Failed to remove invalid token:', e));
          }
        }
      }
    });
  } catch (error) {
    console.error('Error sending push notifications:', error);
  }
}

/**
 * Send task assignment notification
 */
export async function sendTaskAssignmentNotification(
  userIds: string[],
  taskTitle: string,
  takenTaskId: string
): Promise<void> {
  await sendNotificationToUsers(userIds, {
    title: '📋 New Task Assigned',
    body: `You have been assigned to: ${taskTitle}`,
    data: {
      type: 'task_assignment',
      takenTaskId,
    },
    priority: 'high',
    channelId: 'task-notifications',
  });
}

/**
 * Send task status update notification
 */
export async function sendTaskStatusNotification(
  userId: string,
  taskTitle: string,
  status: string
): Promise<void> {
  let emoji = '📋';
  let statusText = status;

  switch (status) {
    case 'in_progress':
      emoji = '🏃';
      statusText = 'In Progress';
      break;
    case 'completed':
      emoji = '✅';
      statusText = 'Completed';
      break;
    case 'pending':
      emoji = '⏳';
      statusText = 'Pending';
      break;
  }

  await sendNotificationToUser(userId, {
    title: `${emoji} Task Status Updated`,
    body: `${taskTitle} is now ${statusText}`,
    data: {
      type: 'task_status_update',
      status,
    },
    channelId: 'task-notifications',
  });
}

/**
 * Send notification when ALL users have completed the task
 */
export async function sendTaskCompletionNotification(
  userIds: string[],
  taskTitle: string,
  takenTaskId: string
): Promise<void> {
  await sendNotificationToUsers(userIds, {
    title: '✅ Task Selesai',
    body: taskTitle
      ? `Task "${taskTitle}" telah diselesaikan sepenuhnya`
      : 'Semua anggota tim telah menyelesaikan task',
    data: {
      type: 'task_completed',
      takenTaskId,
    },
    priority: 'high',
    channelId: 'task-notifications',
  });
}

/**
 * Send notification to the user who just completed their part (partial completion)
 */
export async function sendPartialCompletionNotification(
  userId: string,
  taskTitle: string,
  takenTaskId: string
): Promise<void> {
  await sendNotificationToUser(userId, {
    title: '⏳ Bagian Anda Selesai',
    body: taskTitle
      ? `Bagian Anda di "${taskTitle}" selesai — menunggu anggota tim lainnya`
      : 'Bagian Anda selesai — menunggu anggota tim lainnya',
    data: {
      type: 'task_partial_completed',
      takenTaskId,
    },
    priority: 'high',
    channelId: 'task-notifications',
  });
}

/**
 * Send notification to teammates when a colleague completes their part
 */
export async function sendColleagueCompletionNotification(
  userIds: string[],
  completedByName: string,
  taskTitle: string,
  takenTaskId: string
): Promise<void> {
  await sendNotificationToUsers(userIds, {
    title: '👥 Anggota Tim Selesai',
    body: taskTitle
      ? `${completedByName} telah menyelesaikan bagiannya di "${taskTitle}"`
      : `${completedByName} telah menyelesaikan bagian mereka`,
    data: {
      type: 'colleague_completed',
      takenTaskId,
    },
    priority: 'high',
    channelId: 'task-notifications',
  });
}

/**
 * Test notification function
 */
export async function sendTestNotification(userId: string): Promise<void> {
  await sendNotificationToUser(userId, {
    title: '🔔 Test Notification',
    body: 'Your push notifications are working!',
    data: { type: 'test' },
  });
}
