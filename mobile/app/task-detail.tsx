import React, { useState, useEffect, useCallback } from 'react';
import { useGpsGuard } from '@/hooks/useGpsGuard';
import { getPersistedTrackingState } from '@/services/locationTrackingRefactored';
import { useAppContext } from '@/context/AppContext';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Linking, DeviceEventEmitter } from 'react-native';
import * as Location from 'expo-location';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { SwipeableButton } from '@/components/swipeable-button';
import SuccessCheckOverlay from '@/components/SuccessCheckOverlay';
import api, { tasksAPI, locationsAPI, reportsAPI } from '@/services/api';
import { LocationTrackingService } from '@/services/locationTrackingRefactored';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { showToast } from '@/utils/alert';
// import TrackingMap from '@/components/TrackingMap';


interface LocationPoint {
  id: string;
  time: string;
  location: string;
  coordinates: string;
  notes?: string;
}

export default function TaskDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const [isTracking, setIsTracking] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const [locationHistory, setLocationHistory] = useState<LocationPoint[]>([]);
  const [task, setTask] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [locationStats, setLocationStats] = useState<any>(null);
  const [currentLocation, setCurrentLocation] = useState<string>('');
  const [hasReports, setHasReports] = useState(false);
  const [showAllLocations, setShowAllLocations] = useState(false);
  const isMountedRef = React.useRef(true);
  const isStartingTrackingRef = React.useRef(false); // Guard against duplicate startTracking calls

  useGpsGuard(); // Prompt GPS on mount and every foreground resume

  // ── Context ──────────────────────────────────────────────────────────────
  const { user } = useAppContext();
  const currentUserId = user?.id ?? null;
  const userAvatar = user?.avatar ?? null;

  useEffect(() => {
    if (params.taskId) {
      const markTaskNotificationsAsRead = async () => {
        try {
          const response = await api.get('/notifications');
          const notifications = response.data;
          
          const relatedNotifs = notifications.filter(
            (n: any) => n.category === 'TASK' && 
                        (n.relatedId === params.taskId || n.takenTaskId === params.taskId) && 
                        !n.isRead
          );

          for (const n of relatedNotifs) {
            try {
              await api.patch(`/notifications/${n.id}/read`);
              DeviceEventEmitter.emit('notificationsRead');
            } catch (patchErr) {
              console.log('Failed to patch notification', patchErr);
            }
          }
        } catch (error) {
          console.log('Error fetching notifications to mark as read:', error);
        }
      };
      markTaskNotificationsAsRead();
    }
  }, [params.taskId]);

  /** Check if device GPS is enabled. Shows alert and navigates back if not. */
  const checkGpsEnabled = async (): Promise<boolean> => {
    const hasServices = await Location.hasServicesEnabledAsync();
    if (!hasServices) {
      try {
        // Show the native OS dialog to turn on Location Services
        await Location.enableNetworkProviderAsync();
      } catch {
        // User dismissed the dialog without enabling — block access
        router.back();
        return false;
      }
      // Re-check after dialog
      const nowEnabled = await Location.hasServicesEnabledAsync();
      if (!nowEnabled) {
        router.back();
        return false;
      }
    }
    return true;
  };

  // Fetch current user data on mount
  useEffect(() => {
    isMountedRef.current = true;
    const run = async () => {
      // Instantly restore isTracking from AsyncStorage before API completes.
      // This fixes UI showing “Mulai” briefly after app is killed mid-task.
      const persisted = await getPersistedTrackingState();
      if (persisted && persisted.takenTaskId === params.taskId && isMountedRef.current) {
        console.log(`♻️ [TaskDetail] Restored isTracking=true from storage for task ${persisted.takenTaskId}`);
        setIsTracking(true);
      }

      // GPS check is NOT required here — we don't know task status yet.
      // GPS will be enforced in handleStartTracking (pending) or useFocusEffect (in_progress).
      loadTaskDetail();
    };
    run();

    return () => {
      isMountedRef.current = false;
    };
  }, []);

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      const resumeIfNeeded = async () => {
        if (!task) {
          loadTaskDetail();
          return;
        }

        // Re-check if reports exist when returning to screen
        if (task.takenTaskId) {
          await checkTaskReports(task.takenTaskId);
        }

        const getTaskStatus = (t: any) => {
          if (currentUserId && t.userStatuses && typeof t.userStatuses === 'object') {
            return t.userStatuses[currentUserId] || t.status;
          }
          return t.status;
        };

        const taskStatus = getTaskStatus(task);

        // Completed tasks don't need GPS at all
        if (taskStatus === 'completed') return;

        // For in_progress tasks: GPS is required to resume tracking
        if (taskStatus === 'in_progress' && currentUserId) {
          const gpsOk = await checkGpsEnabled();
          if (!gpsOk) return;
          // Ensure tracking is active
          const trackingStatus = await LocationTrackingService.getTrackingStatus();
          if (!trackingStatus || trackingStatus.taskId !== task.takenTaskId) {
            console.log('📍 Resuming tracking on page focus');
            await LocationTrackingService.resumeTracking();
          } else {
            console.log('ℹ️  Tracking already active on page focus');
          }
        }
        console.log('📋 Log tracking: anggota lain memiliki log masing-masing');
      };

      resumeIfNeeded();
    }, [task, currentUserId]) // Added task dependency to re-run when task changes
  );

  // Auto-refresh location data every 5 minutes (only while task is in-progress)
  // NOTE: Do NOT stop tracking when page unmounts - let background task continue!
  useEffect(() => {
    let refreshInterval: ReturnType<typeof setInterval>;

    if (task && !isLoading && !error) {
      // Check task status
      const getTaskStatus = (t: any) => {
        if (currentUserId && t.userStatuses && typeof t.userStatuses === 'object') {
          return t.userStatuses[currentUserId] || t.status;
        }
        return t.status;
      };

      const taskStatus = getTaskStatus(task);

      // If task is in progress, load locations and set up 5-minute refresh on UI
      if (taskStatus === 'in_progress') {
        // Initial load
        loadLocationData(task.takenTaskId);

        // Refresh UI every 5 minutes
        refreshInterval = setInterval(() => {
          if (isMountedRef.current) {
            loadLocationData(task.takenTaskId);
          }
        }, 5 * 60 * 1000); // 5 minutes
      } else if (taskStatus === 'completed') {
        // Load location history once for display (no interval needed)
        loadLocationData(task.takenTaskId);
        // Stop tracking if still active
        if (isTracking) {
          LocationTrackingService.stopTracking();
          setIsTracking(false);
        }
      }
    }

    return () => {
      // Only cleanup the UI refresh interval
      if (refreshInterval) clearInterval(refreshInterval);
      // IMPORTANT: Do NOT stop background tracking here!
      // Background task continues running independently
    };
  }, [task?.takenTaskId, isLoading, error, currentUserId]);



  const loadTaskDetail = async () => {
    try {
      if (isMountedRef.current) {
        setIsLoading(true);
        setError(null);
      }

      // Validate task ID format
      if (!params.taskId || typeof params.taskId !== 'string') {
        if (isMountedRef.current) {
          setError('Invalid task ID');
          setIsLoading(false);
        }
        return;
      }

      const response = await tasksAPI.getMyTasks();

      if (!isMountedRef.current) return;

      // Find the specific task by takenTaskId
      const foundTask = response.tasks.find(
        (t: any) => t.takenTaskId === params.taskId
      );

      if (foundTask) {
        setTask(foundTask);
        // Check if reports exist for this task
        await checkTaskReports(foundTask.takenTaskId);
        // Check if task is already in progress for this user
        const getTaskStatus = (t: any) => {
          if (currentUserId && t.userStatuses && typeof t.userStatuses === 'object') {
            return t.userStatuses[currentUserId] || t.status;
          }
          return t.status;
        };
        const userStatus = getTaskStatus(foundTask);
        if (userStatus === 'in_progress') {
          setIsTracking(true);

          // Load real location data from API
          await loadLocationData(foundTask.takenTaskId);

          // Resume location tracking if not already active (ONLY IF NOT ACTIVE)
          if (currentUserId) {
            const trackingStatus = await LocationTrackingService.getTrackingStatus();
            if (!trackingStatus || trackingStatus.taskId !== foundTask.takenTaskId) {
              console.log('🚀 Resuming location tracking...');
              await LocationTrackingService.startTracking(foundTask.takenTaskId, currentUserId);
            } else {
              console.log('ℹ️  Location tracking already active, skipping start');
            }
          }
        }
      } else {
        // Task not found - could be deleted or user doesn't have access
        console.warn('⚠️  Task not found:', params.taskId);

        // Clear any stored tracking data for this invalid task
        try {
          await AsyncStorage.removeItem('currentTakenTaskId');
          await AsyncStorage.removeItem('lastTrackingTime');
          console.log('🧹 Cleared invalid task data from storage');
        } catch (storageError) {
          console.warn('Could not clear task storage:', storageError);
        }

        // Stop any active tracking
        const trackingStatus = await LocationTrackingService.getTrackingStatus();
        if (trackingStatus) {
          await LocationTrackingService.stopTracking();
        }

        if (isMountedRef.current) {
          setError('Task not found or has been deleted. Please go back and select a task from the list.');
        }
      }
    } catch (error: any) {
      console.error('Error loading task:', error);

      // Handle specific error codes
      if (error.response?.status === 404 || error.response?.status === 422) {
        // Task deleted or invalid
        console.warn('⚠️  Task invalid or deleted (status:', error.response.status, ')');

        // Clear stored tracking data
        try {
          await AsyncStorage.removeItem('currentTakenTaskId');
          await AsyncStorage.removeItem('lastTrackingTime');
          console.log('🧹 Cleared invalid task data from storage');
        } catch (storageError) {
          console.warn('Could not clear task storage:', storageError);
        }

        // Stop tracking
        const trackingStatus = await LocationTrackingService.getTrackingStatus();
        if (trackingStatus) {
          await LocationTrackingService.stopTracking();
        }

        if (isMountedRef.current) {
          setError('Task tidak ditemukan atau telah dihapus. Silakan kembali ke daftar task.');
        }
      } else if (isMountedRef.current) {
        setError(error.message || 'Failed to load task');
      }
    } finally {
      if (isMountedRef.current) {
        setIsLoading(false);
      }
    }
  };

  const loadLocationData = async (takenTaskId: string) => {
    try {
      // Resolve user ID: state first, then AsyncStorage
      let userId = currentUserId;
      if (!userId) {
        const storedUser = await AsyncStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          userId = user.id;
          console.log('📱 Got user ID from storage for location fetch:', userId);
        }
      }

      // Fetch location data filtered server-side to the current user (device owner).
      // Each user in a multi-user task only sees their own device's tracking log.
      const response = await locationsAPI.getTaskLocations(takenTaskId, userId || undefined);

      // Check if component is still mounted before updating state
      if (!isMountedRef.current) return;

      if (response.locations) {
        const allLocations = response.locations;
        console.log(`📍 Received ${allLocations.length} locations (server-filtered for user: ${userId})`);

        // Secondary client-side safety filter (should already be filtered by server)
        const userLocations = userId
          ? allLocations.filter((loc: any) => loc.userId === userId)
          : allLocations;

        console.log(`✅ ${userLocations.length} locations for current user`);

        // DEBUG: Log sample location to verify address is received
        if (userLocations.length > 0) {
          console.log(`📍 Sample location from API:`, {
            address: userLocations[0].address,
            latitude: userLocations[0].latitude,
            longitude: userLocations[0].longitude,
          });
        }

        // Transform API data to LocationPoint format
        const transformedLocations: LocationPoint[] = userLocations.map((loc: any, idx: number) => {
          const displayLocation = loc.address || `${loc.latitude}, ${loc.longitude}`;
          // Log first 3 locations to debug address display
          if (idx < 3) {
            console.log(`📝 Location ${idx}: address="${loc.address}", display="${displayLocation}"`);
          }
          return {
            id: loc.locationId,
            time: new Date(loc.recordedAt).toLocaleTimeString('id-ID', {
              hour: '2-digit',
              minute: '2-digit',
            }),
            location: displayLocation,
            coordinates: `${loc.latitude}, ${loc.longitude}`,
            notes: loc.trackingStatus === 'manual' ? 'Dicatat manual' : 'Dicatat otomatis',
          };
        });

        if (!isMountedRef.current) return;
        setLocationHistory(transformedLocations);

        // Set current location (most recent = index 0 from desc order)
        if (transformedLocations.length > 0) {
          setCurrentLocation(transformedLocations[0].location);
        }

        // ── Compute distance & duration client-side from raw location data ──────
        if (userLocations.length > 0) {
          // Sort ascending by recordedAt for sequential distance calculation
          const sorted = [...userLocations].sort(
            (a: any, b: any) =>
              new Date(a.recordedAt).getTime() - new Date(b.recordedAt).getTime()
          );

          // Distance = sum of consecutive haversine distances (a→b + b→c + …)
          let totalDistanceKm = 0;
          for (let i = 1; i < sorted.length; i++) {
            totalDistanceKm += haversineKmLocal(
              sorted[i - 1].latitude, sorted[i - 1].longitude,
              sorted[i].latitude, sorted[i].longitude,
            );
          }

          // Duration = first log recordedAt → last log (or now if still active)
          const trackingStart = sorted[0].recordedAt;
          const trackingEnd = sorted[sorted.length - 1].recordedAt;
          const durationStr = calculateDuration(
            trackingStart,
            isTracking ? new Date().toISOString() : trackingEnd,
          );

          if (!isMountedRef.current) return;
          setLocationStats({
            totalLocations: sorted.length,
            totalDistance: parseFloat(totalDistanceKm.toFixed(2)),
            duration: durationStr,
          });
          console.log(`📊 Stats — ${sorted.length} titik, ${totalDistanceKm.toFixed(2)} km, ${durationStr}`);
        }
      }
    } catch (error: any) {
      console.error('Error loading location data:', error);
      if (!isMountedRef.current) return;
      setLocationHistory([]);
      setLocationStats(null);
    }
  };

  /** Haversine distance in km between two lat/lon coordinates */
  const haversineKmLocal = (lat1: number, lng1: number, lat2: number, lng2: number): number => {
    const R = 6371;
    const dLat = ((lat2 - lat1) * Math.PI) / 180;
    const dLng = ((lng2 - lng1) * Math.PI) / 180;
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  };

  const calculateDuration = (startTime?: string, endTime?: string): string => {
    if (!startTime || !endTime) return '0m';
    const diffMs = new Date(endTime).getTime() - new Date(startTime).getTime();
    if (diffMs <= 0) return '0m';
    const totalMinutes = Math.floor(diffMs / (1000 * 60));
    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;
    if (hours === 0) return `${minutes}m`;
    if (minutes === 0) return `${hours}j`;
    return `${hours}j ${minutes}m`;
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'pending': return '#FFC107';
      case 'in_progress': return '#3B82F6';
      case 'completed': return '#10B981';
      case 'inactive': return '#6B7280';
      default: return '#6B7280';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'pending': return 'MENUNGGU';
      case 'in_progress': return 'BERJALAN';
      case 'completed': return 'SELESAI';
      case 'inactive': return 'TIDAK AKTIF';
      default: return status.toUpperCase();
    }
  };

  // Format time from ISO datetime or time string to HH:MM format
  const formatTimeDisplay = (timeStr: string) => {
    if (!timeStr) return timeStr;

    // If it's an ISO datetime, extract the time portion
    if (timeStr.includes('T')) {
      const timePart = timeStr.split('T')[1]; // Get "08:00:00.000Z"
      return timePart.substring(0, 5); // Get "08:00"
    }

    // If it's already a time string, get HH:MM
    return timeStr.substring(0, 5);
  };

  const handleStartTracking = async () => {
    if (!task) return;

    // GPS is required to start a task
    const gpsOk = await checkGpsEnabled();
    if (!gpsOk) return;

    try {
      // Call API to start task
      await tasksAPI.startTask(task.takenTaskId);

      // Show success animation
      setShowSuccess(true);
    } catch (error: any) {
      showToast(error.message || 'Gagal memulai tugas', 'error');
    }
  };

  const handleSuccessFinish = async () => {
    // Guard against duplicate startTracking calls during same flow
    if (isStartingTrackingRef.current) {
      console.warn('⚠️  startTracking already in progress, skipping duplicate call');
      return;
    }
    isStartingTrackingRef.current = true;

    setShowSuccess(false);
    setIsTracking(true);

    try {
      // Add a delay to allow backend to process the status change
      await new Promise(resolve => setTimeout(resolve, 1500));

      // Ensure currentUserId is available before verification
      let resolvedUserId = currentUserId;
      if (!resolvedUserId) {
        const storedUser = await AsyncStorage.getItem('user');
        if (storedUser) {
          const user = JSON.parse(storedUser);
          resolvedUserId = user.id;
          console.log('📱 Resolved userId from storage:', resolvedUserId);
        }
      }

      // Reload task data to get updated status (retry up to 3 times)
      let verifiedTask = null;
      let retryCount = 0;
      const maxRetries = 3;

      while (retryCount < maxRetries && !verifiedTask) {
        const response = await tasksAPI.getMyTasks();
        const foundTask = response.tasks.find(
          (t: any) => t.takenTaskId === params.taskId
        );

        if (foundTask) {
          // Check user_status (individual status) instead of computed_status (global status)
          const getTaskStatus = (t: any) => {
            if (resolvedUserId && t.userStatuses && typeof t.userStatuses === 'object') {
              const userStatus = t.userStatuses[resolvedUserId];
              console.log(`📱 Multi-user task status check - User: ${resolvedUserId}, userStatuses:`, t.userStatuses, `Found status: ${userStatus}`);
              return userStatus || t.status;
            }
            return t.status;
          };
          const userStatus = getTaskStatus(foundTask);

          console.log(`📱 Verification attempt ${retryCount + 1}/${maxRetries}: User status = "${userStatus}"`);

          if (userStatus === 'in_progress') {
            verifiedTask = foundTask;
            console.log('✅ Status verification successful');
            break;
          } else {
            console.warn(`⚠️  User status is "${userStatus}" (expected "in_progress"), retrying... (${retryCount + 1}/${maxRetries})`);
            retryCount++;
            if (retryCount < maxRetries) {
              await new Promise(resolve => setTimeout(resolve, 2000));
            }
          }
        } else {
          console.warn(`⚠️  Task not found in response, retrying... (${retryCount + 1}/${maxRetries})`);
          retryCount++;
          if (retryCount < maxRetries) {
            await new Promise(resolve => setTimeout(resolve, 2000));
          }
        }
      }

      if (!verifiedTask) {
        throw new Error('Task did not update to in progress status after multiple retries. Please check your connection and try again.');
      }

      setTask(verifiedTask);

      // Now start GPS tracking with verified in-progress task and current user ID
      if (!resolvedUserId) {
        throw new Error('User ID not available');
      }

      const trackingStarted = await LocationTrackingService.startTracking(
        verifiedTask.takenTaskId,
        resolvedUserId
      );

      if (trackingStarted) {
        // Load initial location data (with small delay to let first location record)
        setTimeout(() => {
          loadLocationData(verifiedTask.takenTaskId);
        }, 2000);

        showToast('Pelacakan lokasi dimulai. Lokasi diperbarui otomatis secara berkala.', 'success');
      } else {
        showToast('Gagal memulai pelacakan lokasi. Periksa izin lokasi.', 'warning');
      }
    } catch (error: any) {
      console.error('Error in handleSuccessFinish:', error);
      showToast(error.message || 'Terjadi kesalahan saat memulai pelacakan', 'error');
      setIsTracking(false);
    } finally {
      isStartingTrackingRef.current = false;
    }
  };

  // ── Derived state (must be before ANY early return to satisfy Rules of Hooks) ──

  // Use user_status (individual user status) for this user's task state
  const getTaskStatus = useCallback((t: any) => {
    if (currentUserId && t?.userStatuses && typeof t.userStatuses === 'object') {
      return t.userStatuses[currentUserId] || t.status;
    }
    return t?.status ?? 'pending';
  }, [currentUserId]);

  // Check if current time is within work hours
  const isWithinWorkHours = useCallback(() => {
    const td = task?.task;
    if (!td?.startTime || !td?.endTime) return true;

    const parseTimeString = (timeStr: string) => {
      let timeOnly = timeStr;
      if (timeStr.includes('T')) timeOnly = timeStr.split('T')[1];
      const [hours, minutes] = timeOnly.split(':').slice(0, 2).map(Number);
      return hours * 60 + minutes;
    };

    try {
      const now = new Date();
      const currentMinutes = now.getHours() * 60 + now.getMinutes();
      const startMinutes = parseTimeString(td.startTime);
      const endMinutes = parseTimeString(td.endTime);

      if (endMinutes > startMinutes) {
        return currentMinutes >= startMinutes && currentMinutes < endMinutes;
      } else {
        return currentMinutes >= startMinutes || currentMinutes < endMinutes;
      }
    } catch {
      return true;
    }
  }, [task]);

  const checkTaskReports = async (takenTaskId: string) => {
    try {
      const response = await reportsAPI.getReportsForTakenTask(takenTaskId);
      if (response.reports && response.reports.length > 0) {
        setHasReports(true);
      } else {
        setHasReports(false);
      }
    } catch (error) {
      console.error('Error checking reports:', error);
      setHasReports(false);
    }
  };

  const handleCreateNewReport = () => {
    // If reports exist, navigate to reports list
    if (hasReports) {
      router.push(`/task-reports?takenTaskId=${task?.takenTaskId}`);
    } else {
      // Navigate to create new report with all task data
      const taskData = task?.task;
      const taskInfo = encodeURIComponent(JSON.stringify({
        taskId: task?.takenTaskId,
        taskTitle: taskData?.title,
        taskLocation: taskData?.location,
        taskLatitude: taskData?.latitude,
        taskLongitude: taskData?.longitude,
        taskDate: task?.date,
        taskStartTime: task?.startTime,
      }));
      router.push(`/report-detail?reportId=new&taskData=${taskInfo}`);
    }
  };

  // Loading state
  if (isLoading) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detail Tugas</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>Loading task details...</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Error state
  if (error || !task) {
    return (
      <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
        {/* Header */}
        <View style={styles.header}>
          <TouchableOpacity
            style={styles.backButton}
            onPress={() => router.back()}
          >
            <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
          </TouchableOpacity>
          <Text style={styles.headerTitle}>Detail Tugas</Text>
          <View style={styles.headerRight} />
        </View>
        <View style={styles.errorContainer}>
          <IconSymbol name="exclamationmark.triangle.fill" size={44} color="#EF4444" />
          <Text style={styles.errorTitle}>{error || 'Task not found'}</Text>
          <TouchableOpacity style={styles.retryButton} onPress={loadTaskDetail}>
            <Text style={styles.retryButtonText}>Retry</Text>
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // Use user_status (individual user status) for this user's task state
  const currentStatus = getTaskStatus(task);
  const taskData = task.task;

  // ── Render Functions ──────────────────────────────────────────────────────────

  const renderTaskInfoCard = () => (
    <View style={styles.section}>
      <View style={styles.taskCard}>
        <View style={styles.taskHeader}>
          <View style={styles.taskHeaderLeft}>
            <View style={[styles.priorityBadge, { backgroundColor: getStatusColor(currentStatus) }]}>
              <Text style={styles.priorityBadgeText}>{getStatusText(currentStatus)}</Text>
            </View>
            <Text style={styles.taskId}>
              {task.ticketNumber || task.takenTaskId?.substring(0, 8)}
            </Text>
          </View>
        </View>
        <Text style={styles.taskTitle}>{taskData?.title || 'No title'}</Text>
        <Text style={styles.taskDescription}>{taskData?.description || 'No description'}</Text>
        <View style={styles.taskMeta}>
          <View style={styles.taskMetaItem}>
            <IconSymbol name="location.fill" size={14} color="#86868b" />
            <Text style={styles.taskMetaText}>{taskData?.location || 'No location'}</Text>
          </View>
          {taskData?.startTime && taskData?.endTime && (
            <View style={styles.taskMetaItem}>
              <IconSymbol name="clock.fill" size={14} color="#86868b" />
              <Text style={styles.taskMetaText}>
                Jam Kerja: {formatTimeDisplay(taskData.startTime)} - {formatTimeDisplay(taskData.endTime)}
              </Text>
            </View>
          )}
          <View style={styles.taskMetaItem}>
            <IconSymbol name="calendar" size={14} color="#86868b" />
            <Text style={styles.taskMetaText}>Tanggal: {task.date}</Text>
          </View>
        </View>
        {!isWithinWorkHours() && currentStatus === 'inactive' && (
          <View style={styles.deadlineAlert}>
            <IconSymbol name="exclamationmark.triangle.fill" size={16} color="#F59E0B" />
            <Text style={styles.deadlineAlertText}>
              Di luar jam kerja ({formatTimeDisplay(taskData?.startTime)} - {formatTimeDisplay(taskData?.endTime)})
            </Text>
          </View>
        )}
        {task.startTime && (
          <View style={styles.startedAtContainer}>
            <IconSymbol name="clock.fill" size={14} color="#3B82F6" />
            <Text style={styles.startedAtText}>
              {currentStatus === 'in_progress' ? 'Dimulai: ' : 'Dijadwalkan: '}
              {new Date(task.startTime).toLocaleString('id-ID', {
                day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
              })}
            </Text>
          </View>
        )}
      </View>
    </View>
  );

  const renderCreateReportSection = () => {
    if (currentStatus !== 'in_progress') return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>LAPORAN</Text>
        <TouchableOpacity style={styles.createReportButton} onPress={handleCreateNewReport}>
          <View style={styles.createReportContent}>
            <View style={styles.createReportIcon}>
              <IconSymbol size={22} name={hasReports ? "doc.text.fill" : "camera.fill"} color="#FFFFFF" />
            </View>
            <View style={styles.createReportText}>
              <Text style={styles.createReportTitle}>
                {hasReports ? 'Lihat List Laporan' : 'Buat Laporan Baru'}
              </Text>
              <Text style={styles.createReportSubtitle}>
                {hasReports ? 'Lihat semua laporan untuk tugas ini' : 'Foto + Deskripsi atau Deskripsi Saja'}
              </Text>
            </View>
          </View>
          <IconSymbol size={20} name="chevron.right" color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    );
  };

  const renderActionButtons = () => (
    <View style={[styles.section, styles.actionButtonsSection]}>
      {currentStatus === 'pending' && isWithinWorkHours() ? (
        <SwipeableButton onSwipeComplete={handleStartTracking} />
      ) : currentStatus === 'inactive' || (currentStatus === 'pending' && !isWithinWorkHours()) ? (
        <View style={styles.inactiveButtonContainer}>
          <IconSymbol name="lock.fill" size={18} color="#6B7280" />
          <Text style={styles.inactiveButtonText}>Tidak dapat dimulai di luar jam kerja</Text>
        </View>
      ) : currentStatus === 'completed' ? (
        <TouchableOpacity style={styles.completedButton} onPress={() => router.back()}>
          <IconSymbol name="arrow.left.circle.fill" size={18} color="#10B981" />
          <Text style={styles.completedButtonText}>Kembali</Text>
        </TouchableOpacity>
      ) : null}
    </View>
  );

  const renderLocationHistory = () => {
    if ((currentStatus !== 'in_progress' && currentStatus !== 'completed') || locationHistory.length === 0) return null;
    const LIMIT = 5;
    const hasMore = locationHistory.length > LIMIT;
    const visibleLocations = showAllLocations ? locationHistory : locationHistory.slice(0, LIMIT);
    const isCompleted = currentStatus === 'completed';
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>RIWAYAT LOKASI</Text>

        {/* Summary stats */}
        <View style={[styles.locationStatsCard, isCompleted && styles.locationStatsCardCompleted]}>
          <View style={styles.locationStat}>
            <IconSymbol size={18} name="mappin.circle.fill" color={isCompleted ? '#10B981' : '#1d1d1f'} />
            <Text style={[styles.locationStatValue, isCompleted && styles.locationStatValueCompleted]}>{locationHistory.length}</Text>
            <Text style={styles.locationStatLabel}>Titik</Text>
          </View>
          <View style={styles.locationStatDivider} />
          <View style={styles.locationStat}>
            <IconSymbol size={18} name="clock.fill" color={isCompleted ? '#10B981' : '#1d1d1f'} />
            <Text style={[styles.locationStatValue, isCompleted && styles.locationStatValueCompleted]}>{locationStats?.duration || '0m'}</Text>
            <Text style={styles.locationStatLabel}>Durasi</Text>
          </View>
          <View style={styles.locationStatDivider} />
          <View style={styles.locationStat}>
            <IconSymbol size={18} name="figure.walk" color={isCompleted ? '#10B981' : '#1d1d1f'} />
            <Text style={[styles.locationStatValue, isCompleted && styles.locationStatValueCompleted]}>{locationStats?.totalDistance || 0}</Text>
            <Text style={styles.locationStatLabel}>KM</Text>
          </View>
        </View>
        <View style={styles.locationTimeline}>
          {visibleLocations.map((location, index) => (
            <View key={location.id} style={styles.timelineItem}>
              <View style={styles.timelineLeft}>
                <Text style={styles.timelineTime}>{location.time}</Text>
                <View style={styles.timelineDotContainer}>
                  <View style={[styles.timelineDot, index === 0 && styles.timelineDotActive]}>
                    <IconSymbol
                      size={12}
                      name={index === 0 ? 'checkmark' : 'location.fill'}
                      color="#FFFFFF"
                    />
                  </View>
                  {index < visibleLocations.length - 1 && (
                    <View style={styles.timelineLine} />
                  )}
                </View>
              </View>
              <View style={styles.timelineCard}>
                <Text style={styles.timelineLocation}>{location.location}</Text>
                <View style={styles.timelineCoords}>
                  <IconSymbol size={11} name="ruler" color="#86868b" />
                  <Text style={styles.timelineCoordsText}>{location.coordinates}</Text>
                </View>
                {location.notes && (
                  <Text style={styles.timelineNotes}>{location.notes}</Text>
                )}
              </View>
            </View>
          ))}
        </View>
        {hasMore && (
          <TouchableOpacity
            style={styles.showMoreButton}
            activeOpacity={0.7}
            onPress={() => setShowAllLocations(prev => !prev)}
          >
            <Text style={styles.showMoreButtonText}>
              {showAllLocations
                ? 'Sembunyikan'
                : `Lihat ${locationHistory.length - LIMIT} log lainnya`}
            </Text>
            <IconSymbol
              size={15}
              name={showAllLocations ? 'chevron.up' : 'chevron.down'}
              color="#374151"
            />
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detail Tugas</Text>
        <View style={styles.headerRight} />
      </View>

      {/* Success Check Overlay */}
      <SuccessCheckOverlay
        visible={showSuccess}
        onFinish={handleSuccessFinish}
      />

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollViewContent}
      >
        {/* Task Info Card */}
        {renderTaskInfoCard()}

        {/* Create Report Section */}
        {renderCreateReportSection()}

        {/* Tracking Status */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>STATUS TUGAS</Text>
          <View style={[styles.trackingCard, currentStatus === 'in_progress' && styles.trackingCardActive]}>
            {currentStatus === 'in_progress' ? (
              <>
                <View style={styles.trackingHeader}>
                  <View style={styles.trackingStatusBadge}>
                    <View style={styles.pulseIndicator} />
                    <Text style={styles.trackingStatusText}>TRACKING AKTIF</Text>
                  </View>
                </View>

                {/* Peta rute: posisi driver → lokasi tujuan (dinonaktifkan sementara) */}
                {/* {taskData?.latitude && taskData?.longitude ? (
                  <View style={styles.trackingMapContainer}>
                    <TrackingMap
                      destinationLatitude={parseFloat(taskData.latitude)}
                      destinationLongitude={parseFloat(taskData.longitude)}
                      destinationLabel={taskData.location || 'Lokasi Tugas'}
                      driverLabel="Posisi Anda"
                      userAvatar={userAvatar}
                    />
                  </View>
                ) : null} */}

                {/* Lokasi tujuan — tap untuk buka Google Maps */}
                {taskData?.latitude && taskData?.longitude ? (
                  <TouchableOpacity
                    style={styles.destinationCard}
                    activeOpacity={0.7}
                    onPress={() => {
                      const lat = taskData.latitude;
                      const lng = taskData.longitude;
                      const label = encodeURIComponent(taskData.location || 'Lokasi Tugas');
                      const url = `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`;
                      Linking.openURL(`geo:${lat},${lng}?q=${lat},${lng}(${label})`).catch(() =>
                        Linking.openURL(url)
                      );
                    }}
                  >
                    <View style={styles.destinationCardTop}>
                      <View style={styles.destinationCardIconWrap}>
                        <IconSymbol name="mappin.circle.fill" size={24} color="#EF4444" />
                      </View>
                      <View style={styles.destinationCardInfo}>
                        <Text style={styles.destinationCardLabel}>Lokasi Tujuan</Text>
                        <Text style={styles.destinationCardName} numberOfLines={2}>
                          {taskData.location || 'Lokasi Tugas'}
                        </Text>
                      </View>
                      <IconSymbol name="arrow.up.right.square.fill" size={20} color="#3B82F6" />
                    </View>
                    <View style={styles.destinationCardDivider} />
                    <View style={styles.destinationCardCoords}>
                      <IconSymbol name="scope" size={13} color="#86868b" />
                      <Text style={styles.destinationCardCoordsText}>
                        {parseFloat(taskData.latitude).toFixed(6)}, {parseFloat(taskData.longitude).toFixed(6)}
                      </Text>
                    </View>
                  </TouchableOpacity>
                ) : (
                  <View style={styles.mapUnavailable}>
                    <Text style={styles.mapUnavailableText}>
                      📍 Koordinat lokasi belum diatur pada tugas ini
                    </Text>
                  </View>
                )}

                {currentLocation && (
                  <View style={styles.currentLocation}>
                    <IconSymbol name="location.fill" size={14} color="#1d1d1f" />
                    <Text style={styles.currentLocationText}>
                      {currentLocation}
                    </Text>
                  </View>
                )}
              </>
            ) : currentStatus === 'pending' ? (
              <View style={styles.trackingInactive}>
                <IconSymbol name="clock.fill" size={44} color="#FFC107" />
                <Text style={styles.trackingInactiveTitle}>Menunggu Dimulai</Text>
                <Text style={styles.trackingInactiveText}>
                  Geser tombol di bawah untuk memulai tugas ini
                </Text>
              </View>
            ) : currentStatus === 'inactive' ? (
              <View style={styles.trackingInactive}>
                <IconSymbol name="exclamationmark.triangle.fill" size={44} color="#F59E0B" />
                <Text style={styles.trackingInactiveTitle}>Di Luar Jam Kerja</Text>
                <Text style={styles.trackingInactiveText}>
                  Tugas ini hanya dapat dimulai pada jam kerja ({taskData?.startTime} - {taskData?.endTime})
                </Text>
              </View>
            ) : currentStatus === 'completed' ? (
              <View style={styles.trackingInactive}>
                <IconSymbol name="checkmark.circle.fill" size={44} color="#10B981" />
                <Text style={styles.trackingInactiveTitle}>Tugas Selesai</Text>
                <Text style={styles.trackingInactiveText}>
                  Tugas ini telah diselesaikan
                </Text>
              </View>
            ) : (
              <View style={styles.trackingInactive}>
                <IconSymbol name="info.circle.fill" size={44} color="#86868b" />
                <Text style={styles.trackingInactiveTitle}>Status: {getStatusText(currentStatus)}</Text>
              </View>
            )}
          </View>
        </View>

        {/* Action Buttons */}
        {renderActionButtons()}

        {/* Location History */}
        {renderLocationHistory()}

        {/* Bottom spacer - gives room to scroll */}
        <View style={styles.bottomSpacer} />
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  backButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  headerRight: {
    width: 36,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 32,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: '#86868b',
    marginBottom: 2,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
  },
  sectionSubtitle: {
    fontSize: 11,
    color: '#aaaaaa',
    marginBottom: 10,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  locationCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#FFFFFF',
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  locationCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
  },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  taskId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#86868b',
  },
  taskTitle: {
    fontSize: 20,
    fontWeight: '700',
    color: '#1d1d1f',
    marginBottom: 8,
  },
  taskDescription: {
    fontSize: 14,
    color: '#86868b',
    lineHeight: 20,
    marginBottom: 16,
  },
  taskMeta: {
    gap: 12,
    marginBottom: 16,
  },
  taskMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  taskMetaText: {
    fontSize: 13,
    color: '#86868b',
  },
  deadlineAlert: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEE2E2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
  },
  deadlineAlertText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  requirementItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
    backgroundColor: '#FFFFFF',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  requirementBullet: {
    width: 5,
    height: 5,
    borderRadius: 2.5,
    backgroundColor: '#1d1d1f',
    marginTop: 6,
  },
  requirementText: {
    flex: 1,
    fontSize: 13,
    color: '#1d1d1f',
    lineHeight: 20,
  },
  trackingCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  trackingCardActive: {
    backgroundColor: '#FFFFFF',
    borderColor: '#000000',
  },
  trackingMapContainer: {
    marginBottom: 16,
    borderRadius: 12,
    overflow: 'hidden',
  },
  mapUnavailable: {
    marginBottom: 16,
    backgroundColor: '#F3F4F6',
    borderRadius: 10,
    paddingVertical: 14,
    paddingHorizontal: 16,
    alignItems: 'center',
  },
  mapUnavailableText: {
    fontSize: 13,
    color: '#6B7280',
  },
  destinationCard: {
    marginBottom: 16,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderWidth: 1,
    borderColor: '#E5E7EB',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 4,
    elevation: 2,
  },
  destinationCardTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  destinationCardIconWrap: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#FEF2F2',
    alignItems: 'center',
    justifyContent: 'center',
  },
  destinationCardInfo: {
    flex: 1,
  },
  destinationCardLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  destinationCardName: {
    fontSize: 14,
    fontWeight: '700',
    color: '#111827',
    lineHeight: 20,
  },
  destinationCardDivider: {
    height: 1,
    backgroundColor: '#F3F4F6',
    marginVertical: 12,
  },
  destinationCardCoords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  destinationCardCoordsText: {
    fontSize: 12,
    color: '#6B7280',
    fontVariant: ['tabular-nums'],
    flex: 1,
  },
  trackingHeader: {
    alignItems: 'center',
    marginBottom: 20,
  },
  trackingStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 6,
  },
  pulseIndicator: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: '#10B981',
  },
  trackingStatusText: {
    fontSize: 11,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  trackingStats: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  trackingStat: {
    flex: 1,
    alignItems: 'center',
    gap: 8,
  },
  trackingStatValue: {
    fontSize: 22,
    fontWeight: '700',
    color: '#1d1d1f',
  },
  trackingStatLabel: {
    fontSize: 10,
    color: '#86868b',
    textAlign: 'center',
    letterSpacing: 0.3,
  },
  trackingDivider: {
    width: 1,
    backgroundColor: '#e5e5ea',
    marginHorizontal: 8,
  },
  currentLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#f5f5f7',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  currentLocationText: {
    flex: 1,
    fontSize: 12,
    color: '#1d1d1f',
  },
  trackingInactive: {
    alignItems: 'center',
    paddingVertical: 20,
  },
  trackingInactiveTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    marginTop: 12,
    marginBottom: 4,
  },
  trackingInactiveText: {
    fontSize: 13,
    color: '#86868b',
    textAlign: 'center',
    lineHeight: 20,
  },
  actionButtons: {
    flexDirection: 'row',
    gap: 12,
  },
  actionButtonsSection: {
    marginTop: 20,
    marginBottom: 4,
  },
  liveTrackingButton: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#000000',
    borderRadius: 12,
    overflow: 'hidden',
    height: 60,
    borderWidth: 1,
    borderColor: '#1d1d1f',
  },
  trackingButtonIconSection: {
    backgroundColor: '#1d1d1f',
    width: 80,
    height: 60,
    justifyContent: 'center',
    alignItems: 'center',
    borderTopLeftRadius: 11,
    borderBottomLeftRadius: 11,
  },
  trackingButtonTextSection: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
  },
  trackingButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.5,
  },
  primaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#000000',
    paddingVertical: 14,
    borderRadius: 8,
  },
  primaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  secondaryButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#EF4444',
    paddingVertical: 14,
    borderRadius: 8,
  },
  secondaryButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#EF4444',
  },
  locationStatsCard: {
    flexDirection: 'row',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  locationStatsCardCompleted: {
    backgroundColor: '#F0FDF4',
    borderColor: '#10B981',
    borderWidth: 1.5,
  },
  locationStat: {
    flex: 1,
    alignItems: 'center',
    gap: 4,
  },
  locationStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1d1d1f',
  },
  locationStatValueCompleted: {
    color: '#10B981',
  },
  locationStatLabel: {
    fontSize: 10,
    color: '#86868b',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  locationStatDivider: {
    width: 1,
    backgroundColor: '#e5e5ea',
    marginHorizontal: 6,
  },
  locationTimeline: {
    gap: 0,
  },
  timelineItem: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  timelineLeft: {
    alignItems: 'center',
    width: 60,
  },
  timelineTime: {
    fontSize: 11,
    fontWeight: '500',
    color: '#86868b',
    marginBottom: 8,
  },
  timelineDotContainer: {
    alignItems: 'center',
    flex: 1,
  },
  timelineDot: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#1d1d1f',
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 1,
  },
  timelineDotActive: {
    backgroundColor: '#10B981',
  },
  timelineLine: {
    width: 2,
    flex: 1,
    backgroundColor: '#e5e5ea',
    marginTop: 4,
    minHeight: 40,
  },
  timelineCard: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  timelineLocation: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 6,
  },
  timelineCoords: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    marginBottom: 6,
  },
  timelineCoordsText: {
    fontSize: 11,
    color: '#86868b',
    fontFamily: 'monospace',
  },
  timelineNotes: {
    fontSize: 12,
    color: '#86868b',
    lineHeight: 18,
    paddingTop: 6,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
  },
  showMoreButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    marginTop: 8,
    paddingVertical: 12,
    borderRadius: 10,
    backgroundColor: '#dddddd',
    borderWidth: 1,
    borderColor: '#818181',
  },
  showMoreButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#86868b',
  },
  errorContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  errorTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#EF4444',
    marginTop: 12,
    marginBottom: 16,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#000000',
    paddingHorizontal: 24,
    paddingVertical: 12,
    borderRadius: 8,
  },
  retryButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  startedAtContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#EFF6FF',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginTop: 12,
  },
  startedAtText: {
    fontSize: 12,
    color: '#1E40AF',
    fontWeight: '500',
  },
  inactiveButtonContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#F3F4F6',
    paddingVertical: 14,
    borderRadius: 8,
  },
  inactiveButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#6B7280',
  },
  completedButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 8,
  },
  completedButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#10B981',
  },
  createReportButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: '#000000',
    borderRadius: 12,
    padding: 16,
  },
  createReportContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    flex: 1,
  },
  createReportIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'transparent',
    justifyContent: 'center',
    alignItems: 'center',
  },
  createReportText: {
    flex: 1,
  },
  createReportTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  createReportSubtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.7)',
  },
  bottomSpacer: {
    height: 40,
  },
});