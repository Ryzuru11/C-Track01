import { DarkTheme, DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { useCallback, useEffect, useState } from 'react';
import 'react-native-reanimated';
import { View } from 'react-native';

import { useColorScheme } from '@/hooks/use-color-scheme';
import CustomSplash from '@/components/CustomSplash';
import StartingScreen from '@/components/StartingScreen';
import AppAlert from '@/components/ui/AppAlert';
import { appAlertRef } from '@/utils/alert';
import { registerForPushNotificationsAsync, setupNotificationListeners, syncPushTokenIfNeeded } from '@/services/notificationService';
import { initializeSocket, disconnectSocket } from '@/services/socketService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppProvider } from '@/context/AppContext';

// Import location tracking service to register background task + expose resume
import { LocationTrackingService } from '@/services/locationTrackingRefactored';

// Keep the native splash visible while JS loads
SplashScreen.preventAutoHideAsync();

const ONBOARDING_KEY = 'onboardingDone';

export default function RootLayout() {
  const colorScheme = useColorScheme();
  const router = useRouter();
  const [appReady, setAppReady] = useState(false);
  const [showCustomSplash, setShowCustomSplash] = useState(true);
  const [showStartingScreen, setShowStartingScreen] = useState(false);

  useEffect(() => {
    async function prepare() {
      try {
        // Artificial minimum to let assets settle
        await new Promise(resolve => setTimeout(resolve, 200));

        // Register for push notifications (reads token, sets up channels)
        await registerForPushNotificationsAsync();

        // Initialize Socket.io connection if user is logged in
        const token = await AsyncStorage.getItem('userToken');
        if (token) {
          console.log('🔌 Initializing Socket.io connection...');
          await initializeSocket();
          // Sync push token with backend if it changed (important for Expo Go)
          await syncPushTokenIfNeeded();
        } else {
          console.log('ℹ️ No user token found on app start');
        }

        // Show starting screen (onboarding + permissions) only on first launch
        const onboarded = await AsyncStorage.getItem(ONBOARDING_KEY);
        if (!onboarded) {
          setShowStartingScreen(true);
        }
      } catch (e) {
        console.warn('prepare error:', e);
      } finally {
        setAppReady(true);
        // Hide native splash — custom splash takes over
        await SplashScreen.hideAsync();
      }
    }
    prepare();

    // Cleanup socket connection on unmount
    return () => {
      disconnectSocket();
    };
  }, []);

  // Resume tracking AFTER app is ready — deferred so native bridge is settled
  useEffect(() => {
    if (!appReady) return;
    const timer = setTimeout(async () => {
      try {
        const token = await AsyncStorage.getItem('userToken');
        if (token) {
          await LocationTrackingService.resumeTracking();
        }
      } catch (e) {
        console.warn('resumeTracking deferred error:', e);
      }
    }, 1000); // 1s delay — lets React finish mounting before native calls
    return () => clearTimeout(timer);
  }, [appReady]);

  // Set up notification listeners
  useEffect(() => {
    const cleanup = setupNotificationListeners(
      // On notification received
      (notification) => {
        console.log('Notification received:', notification);
      },
      // On notification tapped
      (response) => {
        console.log('Notification tapped:', response);
        const data = response.notification.request.content.data;
        
        // Navigate to task detail if it's a task notification
        if (data?.type === 'task_assignment' && data?.takenTaskId) {
          router.push(`/task-detail?taskId=${data.takenTaskId}`);
        }
        
        // Navigate to task reports if it's a report notification
        if (data?.type === 'report_created' && data?.takenTaskId) {
          router.push(`/task-reports?takenTaskId=${data.takenTaskId}`);
        }
      }
    );

    return cleanup;
  }, []);

  const handleSplashFinish = useCallback(() => {
    setShowCustomSplash(false);
  }, []);

  const handleStartingScreenFinish = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setShowStartingScreen(false);
  }, []);

  if (!appReady) {
    return null; // native splash is still visible
  }

  return (
    <AppProvider>
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ThemeProvider value={colorScheme === 'dark' ? DarkTheme : DefaultTheme}>
          <View style={{ flex: 1 }}>
            <Stack>
              <Stack.Screen name="index" options={{ headerShown: false }} />
              <Stack.Screen name="login" options={{ headerShown: false }} />
              <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
              <Stack.Screen name="achievement/achievement" options={{ headerShown: false }} />
              <Stack.Screen name="modal" options={{ presentation: 'modal', title: 'Modal' }} />
              <Stack.Screen name="task-detail" options={{ headerShown: false }} />
              <Stack.Screen name="task-reports" options={{ headerShown: false }} />
              <Stack.Screen name="report-detail" options={{ headerShown: false }} />
            </Stack>

            {/* Animated custom splash overlaid on top of app */}
            {showCustomSplash && (
              <CustomSplash onFinish={handleSplashFinish} />
            )}

            {/* Starting screen — onboarding & permissions (first launch only) */}
            {showStartingScreen && !showCustomSplash && (
              <StartingScreen onFinish={handleStartingScreenFinish} />
            )}

            {/* Global alert/toast overlay */}
            <AppAlert ref={appAlertRef} />
          </View>
          <StatusBar style="dark" />
        </ThemeProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
    </AppProvider>
  );
}

