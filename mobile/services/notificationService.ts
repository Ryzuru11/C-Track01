import * as Notifications from 'expo-notifications';
import * as Device from 'expo-device';
import { Platform, Linking, Alert } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { authAPI } from './api';
import Constants from 'expo-constants';
import { isRunningInExpoGo } from 'expo';

/**
 * PRODUCTION NOTIFICATION SERVICE FOR C-TRACK
 * * CRITICAL SETUP CHECKLIST:
 * ✓ projectId in app.json matches PRODUCTION EAS project
 * ✓ FCM credentials uploaded to Expo (firebase-adminsdk-xxx.json)
 * ✓ google-services.json has correct FCM sender ID
 * ✓ POST_NOTIFICATIONS permission in app.json
 * ✓ Notification handler configured BEFORE app load
 * ✓ Permission requested at appropriate time
 * ✓ Notification channel created for Android
 * * COMMON PRODUCTION FAILURES:
 * 1. Using development projectId instead of production
 * 2. Notification permission denied (request at login/first use)
 * 3. Notification handler has shouldShowAlert: false in production
 * 4. Notification channel importance < MEDIUM
 * 5. FCM delivery succeeds but no Android channel configured
 */

// CRITICAL: Configure notification handler IMMEDIATELY
// This must run BEFORE any other notification code
Notifications.setNotificationHandler({
  handleNotification: async (notification) => {
    const data = notification.request.content.data;
    
    console.log('📬 FOREGROUND NOTIFICATION HANDLER TRIGGERED', {
      type: data?.type,
      title: notification.request.content.title,
      body: notification.request.content.body,
    });

    // Location tracking notifications - persistent, no sound
    if (data?.type === 'location_tracking') {
      return {
        shouldShowAlert: true,      // MUST be true for production
        shouldPlaySound: false,      // Location tracking silent
        shouldSetBadge: false,
        shouldShowBanner: true,
        shouldShowList: true,
      };
    }
    
    // All other notifications - with sound and badge
    return {
      shouldShowAlert: true,         // CRITICAL: Must be true in production
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,        // iOS 14+ banner
      shouldShowList: true,          // Show in notification list
    };
  },
});

/**
 * PRODUCTION: Create Android notification channels
 * CRITICAL: Must be done early, before any notifications sent
 * Channels with importance < HIGH won't show notifications reliably
 */
async function setupAndroidNotificationChannels(): Promise<void> {
  if (Platform.OS !== 'android') return;

  try {
    // ✅ FIX ANDROID 13: Cek apakah channel sudah ada sebelum membuat ulang.
    // Di Android 13, memanggil setNotificationChannelAsync pada channel yang sudah ada
    // dapat men-trigger edge case dimana sistem me-reset state channel setelah
    // user melakukan interaksi (seperti dismiss semua notifikasi dari notification shade).
    // Dengan hanya membuat channel jika belum ada, kita menghindari channel reset ini.

    const existingDefault = await Notifications.getNotificationChannelAsync('default').catch(() => null);
    if (!existingDefault) {
      // DEFAULT CHANNEL - General notifications
      await Notifications.setNotificationChannelAsync('default', {
        name: 'Default Notifications',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#FF231F7C',
        sound: 'default',
        bypassDnd: false,
        description: 'General app notifications',
      });
      console.log('✅ Android channel "default" created');
    }

    const existingLocation = await Notifications.getNotificationChannelAsync('location-tracking').catch(() => null);
    if (!existingLocation) {
      // LOCATION TRACKING CHANNEL - Persistent, ongoing
      await Notifications.setNotificationChannelAsync('location-tracking', {
        name: 'Location Tracking',
        importance: Notifications.AndroidImportance.MAX,
        vibrationPattern: [0],  // No vibration for continuous tracking
        lockscreenVisibility: Notifications.AndroidNotificationVisibility.PUBLIC,
        lightColor: '#3B82F6',
        sound: null,  // Silent
        bypassDnd: true,  // Always notify even in DND mode
        description: 'Persistent notifications for active location tracking',
      });
      console.log('✅ Android channel "location-tracking" created');
    }

    const existingTask = await Notifications.getNotificationChannelAsync('task-notifications').catch(() => null);
    if (!existingTask) {
      // TASK NOTIFICATIONS CHANNEL - Task assignments
      await Notifications.setNotificationChannelAsync('task-notifications', {
        name: 'Task Notifications',
        importance: Notifications.AndroidImportance.HIGH,
        vibrationPattern: [0, 250, 250, 250],
        lightColor: '#10B981',
        sound: 'default',
        description: 'Notifications for new task assignments',
      });
      console.log('✅ Android channel "task-notifications" created');
    }

    console.log('✅ Android notification channels ready (LocalNotification)');
  } catch (error) {
    console.error('❌ Failed to setup Android channels:', error);
  }
}

/**
 * PRODUCTION: Request notification permissions (Android 13+)
 * CRITICAL: Call this at login or during onboarding, NOT app startup
 * On Android 12 and below, permission is implicit
 */
async function requestNotificationPermission(): Promise<boolean> {
  if (!Device.isDevice) {
    console.log('⏭️ Simulator: Skipping permission request');
    return false;
  }

  try {
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    
    if (existingStatus === 'granted') {
      console.log('✅ Notification permission already granted');
      return true;
    }

    if (existingStatus === 'denied') {
      console.warn('⚠️ Notification permission previously denied by user');
      return false;
    }

    // Status is 'undetermined' - show request
    console.log('🔔 Requesting notification permission...');
    const { status } = await Notifications.requestPermissionsAsync();

    if (status === 'granted') {
      console.log('✅ Notification permission granted by user');
      return true;
    }

    console.warn('⚠️ Notification permission denied by user');
    return false;
  } catch (error) {
    console.error('❌ Error requesting permission:', error);
    return false;
  }
}

/**
 * PRODUCTION: Get Expo Push Token
 * CRITICAL: Must pass projectId for production builds
 * Token is tied to FCM credentials in Expo
 */
async function getExpoPushToken(): Promise<string | null> {
  if (isRunningInExpoGo()) {
    console.log('ℹ️ Expo Go: Push tokens are disabled in Expo Go. Use a development build or APK.');
    return null;
  }

  if (!Device.isDevice) {
    console.log('⏭️ Simulator: Push tokens not available');
    return null;
  }

  try {
    // Get projectId from app.json extra.eas.projectId
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    
    if (!projectId) {
      console.error('❌ CRITICAL: projectId not found in app.json extra.eas.projectId');
      console.error('   This means Expo cannot generate a token for FCM');
      console.error('   Update app.json → extra → eas → projectId with your PRODUCTION project ID');
      return null;
    }

    console.log('🔑 Requesting Expo Push Token from FCM...');
    const tokenData = await Notifications.getExpoPushTokenAsync({ projectId });
    const token = tokenData.data;

    if (!token) {
      console.error('❌ No token returned from FCM');
      return null;
    }

    console.log('✅ Expo Push Token obtained:', token);
    return token;
  } catch (error: any) {
    console.error('❌ ERROR getting push token:', {
      message: error?.message,
      code: error?.code,
      details: error?.details,
    });
    return null;
  }
}

/**
 * PRODUCTION: Complete notification registration flow
 * This is called early in app lifecycle
 * Returns token or undefined
 */
export async function registerForPushNotificationsAsync(): Promise<string | undefined> {
  try {
    // STEP 1: Setup Android notification channels (must do early)
    await setupAndroidNotificationChannels();

    // STEP 2: Check device
    if (!Device.isDevice) {
      console.log('⏭️ Running on simulator/emulator - notifications disabled');
      return undefined;
    }

    // STEP 3: Get permission status
    const { status: existingStatus } = await Notifications.getPermissionsAsync();
    console.log('📱 Current notification permission status:', existingStatus);

    // STEP 4: Request permission if needed (only once per app install)
    let finalStatus = existingStatus;
    if (existingStatus === 'undetermined') {
      console.log('🔔 First launch detected - requesting notification permission...');
      const { status } = await Notifications.requestPermissionsAsync();
      finalStatus = status;
    }

    if (finalStatus !== 'granted') {
      console.warn('⚠️ Notification permission:', finalStatus);
      // Don't return - try to get token anyway (some Android versions allow this)
    }

    // STEP 5: Get push token from FCM
    const token = await getExpoPushToken();
    
    if (!token) {
      console.error('❌ Failed to get push token - notifications will NOT work');
      return undefined;
    }

    // STEP 6: Save token locally (will register with backend after login)
    try {
      await AsyncStorage.setItem('pushToken', token);
      console.log('💾 Token saved to device storage');
    } catch (storageError) {
      console.error('❌ Failed to save token to AsyncStorage:', storageError);
    }

    return token;
  } catch (error) {
    console.error('❌ registerForPushNotificationsAsync failed:', error);
    return undefined;
  }
}

/**
 * PRODUCTION: Register push token with backend
 * Call this AFTER successful login/authentication
 * Backend must save token in device_tokens or similar table
 */
export async function registerPushTokenAfterLogin(): Promise<{ success: boolean; error?: string }> {
  try {
    // Get saved token
    const token = await AsyncStorage.getItem('pushToken');
    
    if (!token) {
      const msg = 'No saved push token - notification permission may be denied';
      console.warn('⚠️', msg);
      return { success: false, error: msg };
    }

    console.log('🔄 Registering push token with backend...');
    console.log('   Token:', token.substring(0, 20) + '...');

    // Send to backend
    const response = await authAPI.registerPushToken(token);
    console.log('✅ Push token registered with backend:', response);
    
    // Mark as registered and store the registered token
    await AsyncStorage.setItem('pushTokenRegistered', 'true');
    await AsyncStorage.setItem('registeredPushToken', token);
    
    return { success: true };
  } catch (error: any) {
    const errorMsg = error?.message || String(error);
    console.error('❌ Failed to register token with backend:', errorMsg);
    return { success: false, error: errorMsg };
  }
}

/**
 * PRODUCTION: Sync push token on app startup if it changed
 * Important for Expo Go or when reinstalling apps
 */
export async function syncPushTokenIfNeeded(): Promise<void> {
  try {
    const currentToken = await AsyncStorage.getItem('pushToken');
    const registeredToken = await AsyncStorage.getItem('registeredPushToken');
    
    // If we have a token, and it's different from what's registered with the backend
    if (currentToken && currentToken !== registeredToken) {
      console.log('🔄 Token changed or not registered. Syncing with backend...');
      const response = await authAPI.registerPushToken(currentToken);
      console.log('✅ Push token synced with backend:', response);
      await AsyncStorage.setItem('registeredPushToken', currentToken);
      await AsyncStorage.setItem('pushTokenRegistered', 'true'); // For legacy checks
    } else {
      console.log('✅ Push token is already up to date with backend.');
    }
  } catch (error) {
    console.error('❌ Failed to sync push token with backend:', error);
  }
}

/**
 * PRODUCTION: Retry token registration if it failed
 * Call this periodically in the app
 */
export async function retryTokenRegistration(): Promise<boolean> {
  try {
    const isRegistered = await AsyncStorage.getItem('pushTokenRegistered');
    if (isRegistered === 'true') {
      return true;  // Already registered
    }

    const result = await registerPushTokenAfterLogin();
    return result.success;
  } catch (error) {
    console.error('❌ retryTokenRegistration failed:', error);
    return false;
  }
}

/**
 * PRODUCTION: Request notification permission with explanations
 * Use this in login flow or settings page if user denies initially
 */
export async function requestNotificationPermissionWithUI(): Promise<boolean> {
  try {
    const { status } = await Notifications.getPermissionsAsync();

    if (status === 'granted') {
      console.log('✅ Notification permission already granted');
      
      // If permission is granted but no token, re-register
      const savedToken = await AsyncStorage.getItem('pushToken');
      if (!savedToken) {
        console.log('   Token missing - regenerating...');
        await registerForPushNotificationsAsync();
      }
      return true;
    }

    if (status === 'denied') {
      console.log('ℹ️ Permission previously denied - user must enable in Settings');
      // Could show a dialog directing user to settings
      return false;
    }

    // status === 'undetermined' - show request dialog
    console.log('🔔 Showing permission request dialog...');
    const { status: newStatus } = await Notifications.requestPermissionsAsync();

    if (newStatus === 'granted') {
      console.log('✅ Permission granted - re-registering for notifications');
      await registerForPushNotificationsAsync();
      return true;
    }

    console.warn('⚠️ Permission request denied by user');
    return false;
  } catch (error) {
    console.error('❌ Error requesting permission:', error);
    return false;
  }
}

/**
 * PRODUCTION VERIFICATION: Complete diagnostic of notification setup
 * Run this to verify everything is configured correctly
 */
export async function verifyNotificationSetup(): Promise<{
  isPhysicalDevice: boolean;
  projectIdConfigured: boolean;
  projectId: string | null;
  permissionStatus: string;
  tokenExists: boolean;
  tokenSample: string | null;
  isRegisteredWithBackend: boolean;
  androidChannels: string[];
  allOk: boolean;
  issues: string[];
}> {
  const issues: string[] = [];

  // Check 1: Physical device
  const isPhysicalDevice = Device.isDevice;
  if (!isPhysicalDevice) {
    issues.push('Not running on physical device - notifications disabled');
  }

  // Check 2: Project ID
  const projectId = Constants.expoConfig?.extra?.eas?.projectId || null;
  const projectIdConfigured = !!projectId;
  if (!projectIdConfigured) {
    issues.push('CRITICAL: projectId not configured in app.json extra.eas.projectId');
  }

  // Check 3: Permission status
  let permissionStatus = 'unknown';
  try {
    const perm = await Notifications.getPermissionsAsync();
    permissionStatus = perm.status;
    if (permissionStatus !== 'granted') {
      issues.push(`Permission status: ${permissionStatus} (need 'granted')`);
    }
  } catch (e) {
    issues.push('Failed to get permission status');
  }

  // Check 4: Token
  let tokenExists = false;
  let tokenSample: string | null = null;
  try {
    const token = await AsyncStorage.getItem('pushToken');
    tokenExists = !!token;
    if (token) {
      tokenSample = token.substring(0, 30) + '...';
    } else {
      issues.push('No push token saved - call registerForPushNotificationsAsync()');
    }
  } catch (e) {
    issues.push('Failed to retrieve token from storage');
  }

  // Check 5: Backend registration
  let isRegisteredWithBackend = false;
  try {
    const registered = await AsyncStorage.getItem('pushTokenRegistered');
    isRegisteredWithBackend = registered === 'true';
    if (!isRegisteredWithBackend) {
      issues.push('Token not registered with backend');
    }
  } catch (e) {
    issues.push('Failed to check backend registration');
  }

  // Check 6: Android notification channels (Android only)
  const androidChannels: string[] = [];
  if (Platform.OS === 'android') {
    try {
      const channels = await Notifications.getNotificationChannelsAsync?.();
      androidChannels.push(...(channels?.map((c: any) => c.id) || []));
      if (androidChannels.length === 0) {
        issues.push('No Android notification channels configured');
      }
    } catch (e) {
      // Method might not exist on older versions
    }
  }

  const allOk = issues.length === 0 && isPhysicalDevice && projectIdConfigured && tokenExists;

  const report = {
    isPhysicalDevice,
    projectIdConfigured,
    projectId,
    permissionStatus,
    tokenExists,
    tokenSample,
    isRegisteredWithBackend,
    androidChannels,
    allOk,
    issues,
  };

  console.log('📋 NOTIFICATION SETUP VERIFICATION:');
  console.log('   Physical Device:', isPhysicalDevice ? '✅' : '❌');
  console.log('   Project ID:', projectIdConfigured ? '✅' : '❌', projectId?.substring(0, 10) || '(none)');
  console.log('   Permission:', permissionStatus === 'granted' ? '✅' : '❌', permissionStatus);
  console.log('   Token:', tokenExists ? '✅' : '❌', tokenSample || '(none)');
  console.log('   Backend Reg:', isRegisteredWithBackend ? '✅' : '❌');
  if (Platform.OS === 'android') {
    console.log('   Android Channels:', androidChannels.length > 0 ? '✅' : '❌', androidChannels);
  }
  console.log('   Overall:', allOk ? '✅ READY' : '❌ ISSUES DETECTED');
  
  if (issues.length > 0) {
    console.log('   Issues found:');
    issues.forEach(issue => console.log('     -', issue));
  }

  return report;
}

/**
 * Setup notification listeners
 * Called once on app startup in _layout.tsx
 * Returns cleanup function
 */
export function setupNotificationListeners(
  onNotificationReceived?: (notification: Notifications.Notification) => void,
  onNotificationResponse?: (response: Notifications.NotificationResponse) => void
) {
  // Listener 1: Notifications received while app is FOREGROUND
  const notificationListener = Notifications.addNotificationReceivedListener(
    (notification) => {
      console.log('📬 [FOREGROUND] Notification received:', {
        type: notification.request.content.data?.type,
        title: notification.request.content.title,
      });
      onNotificationReceived?.(notification);
    }
  );

  // Listener 2: User tapped on notification
  const responseListener = Notifications.addNotificationResponseReceivedListener(
    (response) => {
      console.log('👆 [USER TAP] Notification tapped:', {
        type: response.notification.request.content.data?.type,
        title: response.notification.request.content.title,
      });
      
      // Ignore taps on tracking notifications (non-interactive)
      if (response.notification.request.content.data?.type === 'location_tracking') {
        console.log('   → Tracking notification - ignoring tap');
        return;
      }
      
      onNotificationResponse?.(response);
    }
  );

  // Return cleanup function
  return () => {
    console.log('🧹 Removing notification listeners');
    notificationListener.remove();
    responseListener.remove();
  };
}

/**
 * Show local notification (for testing or scheduled alerts)
 */
export async function showLocalNotification(
  title: string,
  body: string,
  data?: Record<string, any>,
  options?: {
    sound?: boolean;
    badge?: boolean;
    channelId?: string;
  }
) {
  try {
    // 1. KONVERSI LOKAL: Ubah boolean kelompokmu ke tipe number/undefined yang diminta oleh mesin Expo
    const expoBadge = options?.badge === true ? 1 : undefined;

    // 2. OBJEK PERANTARA: Gunakan tipe 'any' untuk mem-bypass error strict object literal checking pada properti channelId
    const notificationContent: any = {
      title,
      body,
      data: data || {},
      sound: options?.sound ?? true,
      badge: expoBadge,
    };

    // 3. SUNTIKAN KONDISIONAL: Masukkan channelId hanya jika aplikasi berjalan di sistem Android
    if (Platform.OS === 'android') {
      notificationContent.channelId = options?.channelId || 'default';
    }

    // 4. EKSEKUSI: Jalankan fungsi bawaan Expo secara aman tanpa memicu type error
    const notificationId = await Notifications.scheduleNotificationAsync({
      content: notificationContent,
      trigger: null,  // Show immediately
    });
    
    console.log('✅ Local notification shown:', notificationId);
    return notificationId;
  } catch (error) {
    console.error('❌ Failed to show notification:', error);
    return null;
  }
}

/**
 * Show task assignment notification
 */
export async function showTaskAssignmentNotification(
  taskTitle: string,
  taskId: string
) {
  return showLocalNotification(
    '📋 New Task Assigned',
    taskTitle,
    { 
      type: 'task_assignment',
      taskId,
    },
    { 
      sound: true, 
      badge: true,
      channelId: 'task-notifications',
    }
  );
}

/**
 * Show persistent notification for location tracking
 * Stays visible while tracking is active
 */
export async function showLocationTrackingNotification() {
  return showLocalNotification(
    '📍 Location Tracking Active',
    'C-Track is monitoring your location in the background',
    { 
      type: 'location_tracking',
      persistent: true 
    },
    { 
      sound: false,   // Silent - no sound for ongoing tracking
      badge: false,   // Don't update badge
      channelId: 'location-tracking',
    }
  );
}

/**
 * Cancel location tracking notification
 */
export async function cancelLocationTrackingNotification() {
  try {
    const notifications = await Notifications.getPresentedNotificationsAsync();
    for (const notification of notifications) {
      if (notification.request.content.data?.type === 'location_tracking') {
        await Notifications.dismissNotificationAsync(notification.request.identifier);
      }
    }
    console.log('✅ Location tracking notification cancelled');
  } catch (error) {
    console.error('❌ Failed to cancel tracking notification:', error);
  }
}

/**
 * Show task completed notification
 */
export async function showTaskCompletedNotification(taskTitle: string) {
  return showLocalNotification(
    '✅ Task Completed',
    `${taskTitle} has been completed successfully`,
    { type: 'task_completed', taskTitle },
    { sound: true, badge: false }
  );
}

/**
 * Get all pending notifications
 */
export async function getPendingNotifications() {
  try {
    return await Notifications.getAllScheduledNotificationsAsync();
  } catch (error) {
    console.error('Failed to get pending notifications:', error);
    return [];
  }
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications() {
  try {
    await Notifications.cancelAllScheduledNotificationsAsync();
    console.log('✅ All notifications cancelled');
  } catch (error) {
    console.error('Failed to cancel notifications:', error);
  }
}

/**
 * Get badge count
 */
export async function getBadgeCount(): Promise<number> {
  try {
    return await Notifications.getBadgeCountAsync();
  } catch (error) {
    console.error('Failed to get badge count:', error);
    return 0;
  }
}

/**
 * Set badge count
 */
export async function setBadgeCount(count: number) {
  try {
    await Notifications.setBadgeCountAsync(count);
  } catch (error) {
    console.error('Failed to set badge count:', error);
  }
}

/**
 * Clear badge count
 */
export async function clearBadgeCount() {
  await setBadgeCount(0);
}