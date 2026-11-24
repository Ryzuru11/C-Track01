import { io, Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { API_BASE_URL } from '@/config/api.config';
import * as Notifications from 'expo-notifications';
import { LocationTrackingService } from './locationTrackingRefactored';

/**
 * Socket.io Service for Real-Time Notifications
 * 
 * Features:
 * - Connect to backend Socket.io server
 * - Authenticate with JWT token
 * - Listen for real-time events (report:created, task:assigned, etc.)
 * - Trigger local push notifications
 */

let socket: Socket | null = null;
let reconnectAttempts = 0;

/**
 * Initialize Socket.io connection
 */
export async function initializeSocket(): Promise<Socket | null> {
  try {
    // Get authentication token — key must match locationTrackingRefactored ('userToken')
    const token = await AsyncStorage.getItem('userToken');
    if (!token) {
      console.log('⚠️ No auth token found, cannot connect to Socket.io');
      return null;
    }

    // Get user ID — read from 'user' JSON object (matches tracking service)
    const userJson = await AsyncStorage.getItem('user');
    if (!userJson) {
      console.log('⚠️ No user data found, cannot connect to Socket.io');
      return null;
    }
    const userId: string = JSON.parse(userJson).id;

    // Get Socket.io URL (remove /api from base URL)
    const socketUrl = API_BASE_URL.replace('/api', '');
    console.log('🔌 Connecting to Socket.io:', socketUrl);

    // Create socket connection with authentication
    socket = io(socketUrl, {
      auth: {
        token: token,
      },
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: Infinity,
    });

    // Connection event handlers
    socket.on('connect', () => {
      console.log('✅ Socket.io connected:', socket?.id);
      reconnectAttempts = 0;

      // Join user room for targeted notifications
      socket?.emit('user:join', { userId });

      // Connectivity restored — ensure background task is alive and drain
      // any location records that failed to upload while offline
      LocationTrackingService.heartbeat().catch((e) =>
        console.warn('⚠️ heartbeat on reconnect failed:', e?.message)
      );
    });

    socket.on('disconnect', (reason) => {
      console.log('❌ Socket.io disconnected:', reason);
    });

    socket.on('connect_error', (error) => {
      console.error('🔥 Socket.io connection error:', error.message);
      reconnectAttempts++;
      console.log(`🔄 Reconnect attempt #${reconnectAttempts} — will retry with backoff...`);
    });

    // When the app returns to foreground, if the socket is dead, kick it back alive.
    // socket.disconnect() sets skipReconnect=true internally, so we must call
    // socket.connect() explicitly rather than relying on the auto-reconnect engine.
    AppState.addEventListener('change', (nextState) => {
      if (nextState === 'active' && socket && !socket.connected) {
        console.log('📱 [AppState] App became active — reconnecting socket...');
        socket.connect();
      }
    });

    socket.on('error', (error) => {
      console.error('🔥 Socket.io error:', error);
    });

    // Set up event listeners
    setupEventListeners(socket);

    return socket;
  } catch (error) {
    console.error('Failed to initialize Socket.io:', error);
    return null;
  }
}

/**
 * Set up Socket.io event listeners
 */
function setupEventListeners(socket: Socket) {
  // Listen for new reports from team members
  socket.on('report:created', async (data) => {
    console.log('📡 Received report:created event:', data);
    
    try {
      // Get current userId — matches tracking service storage key
      const currentUserJson = await AsyncStorage.getItem('user');
      const currentUserId = currentUserJson ? JSON.parse(currentUserJson).id : null;

      // Don't show notification for our own reports.
      // Backend sends userId (flat field), NOT nested inside a report object.
      if (data.userId === currentUserId) {
        console.log('ℹ️ Skipping notification for own report');
        return;
      }

      // Show local notification
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📝 Laporan Baru dari Anggota Tim',
          body: `${data.userName || 'Anggota tim'} mengajukan laporan untuk ${data.taskTitle || 'tugas ini'}`,
          data: {
            type: 'report_created',
            reportId: data.reportId,
            takenTaskId: data.takenTaskId,
            taskTitle: data.taskTitle,
          },
          sound: true,
          priority: 'max',
        },
        trigger: null, // Show immediately
      });

      console.log('✅ Report notification shown');
    } catch (error) {
      console.error('Failed to show report notification:', error);
    }
  });

  // Listen for task assignments
  // DISABLED: Task assignment notifications now use Expo push only (handled via setNotificationHandler)
  // The backend no longer emits task:assigned socket event to avoid duplicates
  socket.on('task:assigned', async (data) => {
    console.log('📡 Received task:assigned event (IGNORED - using push notifications instead):', data);
  });

  // Listen for task status updates
  socket.on('task:status_updated', async (data) => {
    console.log('📡 Received task:status_updated event:', data);

    try {
      const currentUserJson = await AsyncStorage.getItem('user');
      const currentUserId = currentUserJson ? JSON.parse(currentUserJson).id : null;

      // Guard 1: Only fire for full task completion (overallStatus = completed).
      // Partial completions (one member done, others pending) are handled by task:colleague_update.
      if (data.overallStatus !== 'completed') {
        // Special case: the user who just completed their OWN part of a multi-user task
        // gets no push feedback (Guard 1 blocks the main notif, task:colleague_update is for others).
        // Show them a "waiting for team" notification so they know their part was registered.
        if (data.userId === currentUserId && data.status === 'completed') {
          await Notifications.scheduleNotificationAsync({
            content: {
              title: '⏳ Bagian Anda Selesai',
              body: data.taskTitle
                ? `Bagian Anda di "${data.taskTitle}" selesai — menunggu anggota tim lainnya`
                : 'Bagian Anda selesai — menunggu anggota tim lainnya',
              data: {
                type: 'task_partial_completed',
                takenTaskId: data.takenTaskId,
              },
              sound: true,
              priority: 'max',
            },
            trigger: null,
          });
          console.log('✅ Partial completion self-notification shown');
        } else {
          // Teammate notifications are handled exclusively by task:colleague_update.
          console.log('ℹ️ Skipping task:status_updated notification - task not fully completed yet');
        }
        return;
      }

      // Guard 3: BLOCK unless userIds is present AND user is in the list
      // Only assigned team members should see the notification
      if (!Array.isArray(data.userIds) || !data.userIds.includes(currentUserId)) {
        console.log('🚫 BLOCKED: Not assigned to this task');
        return;
      }

      // ── Task fully completed: Stop background tracking ──────────────────
      // This clears AsyncStorage tracking state + stops background location task
      // Prevents UI incorrectly showing "Sedang Berjalan" if app is killed right after completion
      await LocationTrackingService.stopTracking().catch((e) =>
        console.warn('⚠️ Failed to stop tracking on task completion:', e?.message)
      );

      await Notifications.scheduleNotificationAsync({
        content: {
          title: '✅ Task Selesai',
          body: data.taskTitle
            ? `Task "${data.taskTitle}" telah diselesaikan sepenuhnya`
            : 'Semua anggota tim telah menyelesaikan task',
          data: {
            type: 'task_status_updated',
            takenTaskId: data.takenTaskId,
            status: data.overallStatus,
          },
          sound: true,
          priority: 'max',
        },
        trigger: null,
      });

      console.log('✅ Task completion notification shown');
    } catch (error) {
      console.error('Failed to show task status notification:', error);
    }
  });

  // Listen for teammate partial completion events
  // DISABLED: Colleague notifications disabled - full task completion notifies all team members
  socket.on('task:colleague_update', async (data) => {
    console.log('📡 Received task:colleague_update event (IGNORED):', data);
    // Disabled - full completion will notify all team members
  });

  // Server can force-stop tracking (e.g. task cancelled by admin)
  socket.on('tracking:force_stop', async (data) => {
    console.log('📡 Received tracking:force_stop event:', data);
    try {
      await LocationTrackingService.stopTracking();
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '⚠️ Tracking Dihentikan',
          body: data.reason || 'Tracking lokasi dihentikan oleh server',
          data: { type: 'tracking_force_stop', ...data },
          sound: true,
        },
        trigger: null,
      });
      console.log('✅ Tracking force-stopped by server');
    } catch (error) {
      console.error('Failed to force stop tracking:', error);
    }
  });

  // Admin broadcast messages
  socket.on('admin:broadcast', async (data) => {
    console.log('📡 Received admin:broadcast event:', data);

  socket.on('achievement_unlocked', data => {
    console.log('🏆 Achievement diterima:', data);
  });
    
    try {
      await Notifications.scheduleNotificationAsync({
        content: {
          title: '📢 Admin Announcement',
          body: data.message || 'You have a new message',
          data: {
            type: 'admin_broadcast',
            ...data,
          },
          sound: true,
          priority: 'max',
        },
        trigger: null,
      });

      console.log('✅ Admin broadcast notification shown');
    } catch (error) {
      console.error('Failed to show admin broadcast notification:', error);
    }
  });
}

/**
 * Get current socket instance
 */
export function getSocket(): Socket | null {
  return socket;
}

/**
 * Disconnect socket
 */
export function disconnectSocket() {
  if (socket) {
    console.log('🔌 Disconnecting Socket.io...');
    socket.disconnect();
    socket = null;
  }
}

/**
 * Reconnect socket (useful after login)
 */
export async function reconnectSocket() {
  disconnectSocket();
  reconnectAttempts = 0; // Reset so initializeSocket() can attempt reconnect
  return await initializeSocket();
}

/**
 * Check if socket is connected
 */
export function isSocketConnected(): boolean {
  return socket?.connected ?? false;
}

/**
 * Emit event to server
 */
export function emitEvent(event: string, data: any) {
  if (socket?.connected) {
    socket.emit(event, data);
  } else {
    console.warn('⚠️ Socket not connected, cannot emit event:', event);
  }
}

/**
 * Emit tracking:start to server when user begins a task.
 * Call this right after LocationTrackingService.startTracking() succeeds.
 */
export async function emitTrackingStart(takenTaskId: string): Promise<void> {
  const userJson = await AsyncStorage.getItem('user');
  if (!userJson) return;
  const { id: userId, name } = JSON.parse(userJson);
  emitEvent('tracking:start', { takenTaskId, userId, name });
  console.log(`📡 Emitted tracking:start for task ${takenTaskId}`);
}

/**
 * Emit tracking:stop to server when user completes or cancels a task.
 * Call this right after LocationTrackingService.stopTracking() succeeds.
 */
export async function emitTrackingStop(takenTaskId: string): Promise<void> {
  const userJson = await AsyncStorage.getItem('user');
  if (!userJson) return;
  const { id: userId } = JSON.parse(userJson);
  emitEvent('tracking:stop', { takenTaskId, userId });
  console.log(`📡 Emitted tracking:stop for task ${takenTaskId}`);
}
