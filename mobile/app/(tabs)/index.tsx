import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useGpsGuard } from '@/hooks/useGpsGuard';
import UserAvatar from '@/components/UserAvatar';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Modal, RefreshControl, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Colors } from '@/constants/theme';
import { tasksAPI } from '@/services/api';
import { useAppContext } from '@/context/AppContext';
import { LocationTrackingService } from '@/services/locationTrackingRefactored';
import { MaterialCommunityIcons } from '@expo/vector-icons';

const cTrackLogo = require('@/assets/images/C-Track.png');

/**
 * Extract HH:MM from TIME fields returned by backend as ISO datetime (1970-01-01T08:00:00.000Z).
 * Using toLocaleTimeString would offset by timezone (e.g. +7 WIB → shows 15:00 instead of 08:00).
 */
const formatTimeField = (timeStr: string | null | undefined): string => {
  if (!timeStr) return '--:--';
  try {
    const timePart = timeStr.includes('T') ? timeStr.split('T')[1] : timeStr;
    const matched = timePart.match(/^(\d{2}):(\d{2})/);
    return matched ? `${matched[1]}:${matched[2]}` : '--:--';
  } catch {
    return '--:--';
  }
};

export default function HomeScreen() {
  useGpsGuard();

  const router = useRouter();
  const [selectedFilter, setSelectedFilter] = useState('Semua');
  const [showFilterDropdown, setShowFilterDropdown] = useState(false);
  // ── Context ──────────────────────────────────────────────────────────────
  const { user, socketStatus } = useAppContext();
  const userName    = user?.name   ?? 'User';
  const userEmail   = user?.email  ?? '';
  const currentUserId = user?.id   ?? null;
  const userAvatar  = user?.avatar ?? null;

  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [myTasks, setMyTasks] = useState<any[]>([]);
  const [statistics, setStatistics] = useState<any>(null);
  const [error, setError] = useState<string | null>(null);
  const [showAllTasks, setShowAllTasks] = useState(false);

  const filterOptions = ['Semua', 'Menunggu', 'Berjalan', 'Selesai'];

  // Persistent interval ref — avoids timer drift caused by recreating the interval on every tasks refresh
  const refreshIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // On mount: heartbeat to resume tracking if app was killed mid-task
  useEffect(() => {
    LocationTrackingService.heartbeat().catch((e) =>
      console.warn('⚠️ [HomeScreen] heartbeat on mount failed:', e?.message)
    );
  }, []);

  // Clear interval on unmount
  useEffect(() => {
    return () => {
      if (refreshIntervalRef.current) {
        clearInterval(refreshIntervalRef.current);
        refreshIntervalRef.current = null;
      }
    };
  }, []);

  // Start or stop the 2-minute auto-refresh based on whether active tasks exist.
  // Using a ref for the interval means the timer is never reset when tasks data refreshes —
  // it only resets when active-task presence actually changes.
  useEffect(() => {
    const hasActiveTasks = myTasks.some(task => {
      const userStatus = currentUserId && task.userStatuses?.[currentUserId];
      return (userStatus || task.status) === 'in_progress';
    });

    if (hasActiveTasks && !refreshIntervalRef.current) {
      refreshIntervalRef.current = setInterval(() => {
        console.log('🔄 Auto-refreshing tasks data...');
        loadTasksData();
      }, 2 * 60 * 1000);
    } else if (!hasActiveTasks && refreshIntervalRef.current) {
      clearInterval(refreshIntervalRef.current);
      refreshIntervalRef.current = null;
    }
  }, [myTasks, currentUserId]);

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      loadTasksData();
    }, [])
  );

  const loadTasksData = async () => {
    try {
      setIsLoading(true);
      setError(null);

      // Debug: Log token status
      const token = await AsyncStorage.getItem('userToken');
      if (!token) {
        console.warn('⚠️ No token found in storage - user must login again');
        setError('Session expired - please login again');
        setIsLoading(false);
        return;
      }
      console.log('✅ Token found in storage');

      // Fetch my tasks and statistics
      const [tasksResponse, statsResponse] = await Promise.all([
        tasksAPI.getMyTasks(),
        tasksAPI.getMyStatistics(),
      ]);

      console.log('[Tasks] Response:', JSON.stringify(tasksResponse));
      console.log('[Stats] Response:', JSON.stringify(statsResponse));

      // Backend returns { tasks: [...] }
      setMyTasks((tasksResponse as any).tasks || []);
      // Backend returns { statistics: { totalTasks, completedTasks, inProgressTasks, pendingTasks } }
      setStatistics((statsResponse as any).statistics || statsResponse);
    } catch (error: any) {
      console.error('Error loading tasks:', error);
      
      // Handle invalid token error
      if (error.code === 'INVALID_TOKEN' || error.message === 'Invalid token') {
        console.warn('🔐 Token invalid - must login again');
        setError('Session expired - please login again');
        try {
          // Clear all user data
          await AsyncStorage.removeItem('userToken');
          await AsyncStorage.removeItem('user');
          await AsyncStorage.removeItem('userEmail');
        } catch (e) {
          console.error('Error clearing storage on invalid token:', e);
        }
      } else {
        setError(error.message || 'Failed to load tasks');
      }
    } finally {
      setIsLoading(false);
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await loadTasksData();
    setIsRefreshing(false);
  };

  const getGreeting = () => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 18) return 'Good Afternoon';
    return 'Good Evening';
  };

  const handleStartTask = async (taskId: string) => {
    try {
      await tasksAPI.startTask(taskId);
      await loadTasksData();
    } catch (error: any) {
      alert(error.message || 'Failed to start task');
    }
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
      case 'pending': return 'Menunggu';
      case 'in_progress': return 'Berjalan';
      case 'completed': return 'Selesai';
      case 'inactive': return 'Tidak Aktif';
      default: return status;
    }
  };

  const getTaskStatus = (task: any) => {
    // Get user-specific status from userStatuses, fall back to overall status
    if (currentUserId && task.userStatuses && typeof task.userStatuses === 'object') {
      return task.userStatuses[currentUserId] || task.status;
    }
    return task.status;
  };

  const getFilteredTasks = () => {
    let filtered = myTasks;

    if (selectedFilter !== 'Semua') {
      filtered = myTasks.filter((task) => {
        const taskStatus = getTaskStatus(task);

        if (selectedFilter === 'Menunggu') return taskStatus === 'pending';
        if (selectedFilter === 'Berjalan') return taskStatus === 'in_progress';
        if (selectedFilter === 'Selesai') return taskStatus === 'completed';
        return true;
      });
    }

    // Sort tasks
    return filtered.sort((a, b) => {
      const statusA = getTaskStatus(a);
      const statusB = getTaskStatus(b);
      
      // Status priority order: pending > in_progress > completed
      const statusOrder: Record<string, number> = {
        'pending': 0,
        'in_progress': 1,
        'completed': 2,
      };
      
      const priorityA = statusOrder[statusA] ?? 3;
      const priorityB = statusOrder[statusB] ?? 3;
      
      // If different status, sort by status priority
      if (priorityA !== priorityB) {
        return priorityA - priorityB;
      }
      
      // If same status, sort by startTime in ascending order (oldest first)
      const timeA = a.startTime ? new Date(a.startTime).getTime() : Infinity;
      const timeB = b.startTime ? new Date(b.startTime).getTime() : Infinity;
      
      return timeA - timeB;
    });
  };

  const activeTask = myTasks.find(task => getTaskStatus(task) === 'in_progress');

  // ── Render Functions ──────────────────────────────────────────────────────

  const renderHeader = () => (
    <View style={styles.header}>
      <View style={styles.headerLeft}>
        <UserAvatar
          userId={currentUserId ? String(currentUserId) : ''}
          name={userName}
          size={40}
        />
        <View style={styles.headerTextContainer}>
          <Text style={styles.greeting}>
            {isLoading ? 'Loading...' : (
              <>
                {getGreeting()}{' '}
                <Text style={styles.userName}>{userName}</Text>
              </>
            )}
          </Text>
          <View style={styles.connectedContainer}>
            <View style={styles.connectedDot} />
            <Text style={styles.connectedText}>Connected</Text>
          </View>
        </View>
      </View>
      
      {/* Achievement Badge - Clickable */}
      <TouchableOpacity
  onPress={() => {
    console.log("Achievement diklik");
    router.push('/achievement/achievement');
  }}
>
  <View style={styles.achievementBadge}>
  <MaterialCommunityIcons
    name="trophy-outline"
    size={22}
    color="#000"
  />
</View>
</TouchableOpacity>
    </View>
  );

  const renderQuickStats = () => (
    <View style={styles.section}>
      <View style={styles.quickStatsRow}>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatValue}>{statistics?.totalTasks ?? statistics?.total_tasks ?? 0}</Text>
          <Text style={styles.quickStatLabel}>Total</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatValue}>{statistics?.inProgressTasks ?? statistics?.in_progress ?? 0}</Text>
          <Text style={styles.quickStatLabel}>Aktif</Text>
        </View>
        <View style={styles.quickStatCard}>
          <Text style={styles.quickStatValue}>{statistics?.completedTasks ?? statistics?.completed ?? 0}</Text>
          <Text style={styles.quickStatLabel}>Selesai</Text>
        </View>
      </View>
    </View>
  );

  const renderError = () => {
    if (!error) return null;
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity onPress={loadTasksData} style={styles.retryButton}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderActiveTask = () => {
    if (!activeTask) return null;
    return (
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Tugas Sedang Dikerjakan</Text>
        <TouchableOpacity
          style={[styles.activeTaskCard, { borderLeftColor: getStatusColor(getTaskStatus(activeTask)) }]}
          onPress={() => router.push(`/task-detail?taskId=${activeTask.takenTaskId}`)}
        >
          <View style={styles.activeTaskHeader}>
            <View style={styles.activeTaskBadge}>
              <View style={styles.pulseIndicator} />
              <Text style={styles.activeTaskBadgeText}>AKTIF</Text>
            </View>
            <Text style={styles.activeTaskId}>{activeTask.ticketNumber || activeTask.takenTaskId?.substring(0, 8)}</Text>
          </View>
          <Text style={styles.activeTaskTitle}>{activeTask.task?.title}</Text>
          <View style={styles.activeTaskInfo}>
            <View style={styles.activeTaskInfoItem}>
              <IconSymbol size={16} name="location.fill" color="#86868b" />
              <Text style={styles.activeTaskInfoText}>{activeTask.task?.location}</Text>
            </View>
            <View style={styles.activeTaskInfoItem}>
              <IconSymbol size={16} name="clock.fill" color="#86868b" />
              <Text style={styles.activeTaskInfoText}>
                Mulai {new Date(activeTask.startTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' })}
              </Text>
            </View>
          </View>
          <View style={styles.activeTaskActions}>
            <TouchableOpacity
              style={styles.activeTaskButton}
              onPress={() => router.push(`/task-detail?taskId=${activeTask.takenTaskId}`)}
            >
              <IconSymbol size={16} name="eye.fill" color="#FFFFFF" />
              <Text style={styles.activeTaskButtonText}>Lihat Detail</Text>
            </TouchableOpacity>
          </View>
        </TouchableOpacity>
      </View>
    );
  };

  const renderTaskCard = (task: any) => (
    <View key={task.takenTaskId} style={styles.taskCard}>
      <View style={styles.taskHeader}>
        <View style={styles.taskHeaderLeft}>
          <View style={[
            styles.priorityBadge,
            { backgroundColor: getStatusColor(getTaskStatus(task)) }
          ]}>
            <Text style={styles.priorityBadgeText}>
              {getStatusText(getTaskStatus(task))}
            </Text>
          </View>
          <Text style={styles.taskId}>{task.ticketNumber || task.takenTaskId?.substring(0, 8)}</Text>
        </View>
      </View>
      <Text style={styles.taskTitle}>{task.task?.title}</Text>
      <Text style={styles.taskDescription} numberOfLines={2}>
        {task.task?.description}
      </Text>
      <View style={styles.taskMeta}>
        <View style={styles.taskMetaItem}>
          <IconSymbol size={14} name="location.fill" color="#86868b" />
          <Text style={styles.taskMetaText} numberOfLines={1}>{task.task?.location}</Text>
        </View>
        <View style={styles.taskMetaItem}>
          <IconSymbol size={14} name="calendar" color="#86868b" />
          <Text style={styles.taskMetaText}>{task.date ? new Date(task.date).toLocaleDateString('id-ID') : ''}</Text>
        </View>
        {task.task && task.task.startTime && task.task.endTime && (
          <View style={styles.taskMetaItem}>
            <IconSymbol size={14} name="clock" color="#86868b" />
            <Text style={styles.taskMetaText}>
              {formatTimeField(task.task.startTime)} - {formatTimeField(task.task.endTime)}
            </Text>
          </View>
        )}
      </View>
      {getTaskStatus(task) === 'inactive' && (
        <View style={styles.inactiveWarning}>
          <IconSymbol size={14} name="exclamationmark.triangle.fill" color="#F59E0B" />
          <Text style={styles.inactiveWarningText}>
            Di luar jam kerja{task.task?.startTime && task.task?.endTime ? ` (${formatTimeField(task.task.startTime)} - ${formatTimeField(task.task.endTime)})` : ''}
          </Text>
        </View>
      )}
      <View style={styles.taskFooter}>
        {task.startTime && (
          <View style={styles.deadlineContainer}>
            <IconSymbol size={14} name="clock.fill" color="#3B82F6" />
            <Text style={styles.startTimeText}>
              {new Date(task.startTime).toLocaleString('id-ID', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })}
            </Text>
          </View>
        )}
        <TouchableOpacity
          style={styles.detailButton}
          onPress={() => router.push(`/task-detail?taskId=${task.takenTaskId}`)}
        >
          <Text style={styles.detailButtonText}>Detail</Text>
          <IconSymbol size={14} name="arrow.right.circle.fill" color="#FFFFFF" />
        </TouchableOpacity>
      </View>
    </View>
  );

  const renderTaskSkeleton = () => (
    <View style={styles.tasksList}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.taskCard}>
          <View style={styles.taskHeader}>
            <View style={styles.taskHeaderLeft}>
              <View style={[styles.skeleton, styles.skeletonBadge]} />
              <View style={[styles.skeleton, styles.skeletonTaskId]} />
            </View>
          </View>
          <View style={[styles.skeleton, styles.skeletonTaskTitle]} />
          <View style={[styles.skeleton, styles.skeletonDescLine]} />
          <View style={[styles.skeleton, styles.skeletonDescLineShort]} />
          <View style={styles.taskMeta}>
            <View style={[styles.skeleton, styles.skeletonMetaItem]} />
            <View style={[styles.skeleton, styles.skeletonMetaItem]} />
          </View>
          <View style={styles.taskFooter}>
            <View style={[styles.skeleton, styles.skeletonButton]} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderTasksContent = () => {
    if (isLoading) return renderTaskSkeleton();
    const filteredTasks = getFilteredTasks();
    if (filteredTasks.length === 0) {
      return (
        <View style={styles.emptyContainer}>
          <Text style={styles.emptyText}>No tasks found</Text>
        </View>
      );
    }
    
    const displayedTasks = showAllTasks ? filteredTasks : filteredTasks.slice(0, 3);
    const hasMoreTasks = filteredTasks.length > 3;
    
    return (
      <View style={styles.tasksList}>
        {displayedTasks.map((task) => renderTaskCard(task))}
        {hasMoreTasks && (
          <TouchableOpacity
            style={styles.showMoreButton}
            onPress={() => setShowAllTasks(!showAllTasks)}
            activeOpacity={0.7}
          >
            <View style={styles.showMoreButtonContent}>
              <Text style={styles.showMoreButtonText}>
                {showAllTasks ? 'Tampilkan Lebih Sedikit' : `Tampilkan Lebih Banyak (${filteredTasks.length - 3})`}
              </Text>
              <IconSymbol
                size={18}
                name={showAllTasks ? 'chevron.up' : 'chevron.down'}
                color="#3B82F6"
              />
            </View>
          </TouchableOpacity>
        )}
      </View>
    );
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {/* Header */}
      {renderHeader()}

      <ScrollView
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
        refreshControl={
          <RefreshControl refreshing={isRefreshing} onRefresh={onRefresh} />
        }
      >

        {/* Quick Stats */}
        {renderQuickStats()}

        {/* Error Message */}
        {renderError()}

        {/* Active Task Card */}
        {renderActiveTask()}

        {/* My Tasks (Tugas Saya) */}
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Tugas Saya</Text>

            {/* Filter Dropdown Button */}
            <View style={styles.filterDropdownContainerInline}>
              <TouchableOpacity
                style={styles.filterDropdownButton}
                onPress={() => setShowFilterDropdown(!showFilterDropdown)}
              >
                <View style={styles.filterDropdownButtonContent}>
                  <Text style={styles.filterDropdownButtonText}>{selectedFilter}</Text>
                  <IconSymbol
                    size={16}
                    name={showFilterDropdown ? 'chevron.up' : 'chevron.down'}
                    color="#1d1d1f"
                  />
                </View>
              </TouchableOpacity>
            </View>
          </View>

          {/* Dropdown Menu */}
          {showFilterDropdown && (
            <View style={styles.filterDropdownMenu}>
              {filterOptions.map((option) => (
                <TouchableOpacity
                  key={option}
                  style={[
                    styles.filterDropdownItem,
                    selectedFilter === option && styles.filterDropdownItemActive,
                  ]}
                  onPress={() => {
                    setSelectedFilter(option);
                    setShowFilterDropdown(false);
                  }}
                >
                  <Text
                    style={[
                      styles.filterDropdownItemText,
                      selectedFilter === option && styles.filterDropdownItemTextActive,
                    ]}
                  >
                    {option}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}

          {/* Tasks List */}
          {renderTasksContent()}
        </View>
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
    paddingVertical: 16,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  avatar: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1d1d1f',
    justifyContent: 'center',
    alignItems: 'center',
    overflow: 'hidden',
  },
  avatarImage: {
    width: 44,
    height: 44,
    borderRadius: 22,
  },
  headerTextContainer: {
    marginLeft: 12,
  },
  greeting: {
    fontSize: 15,
    fontWeight: 'normal',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  userName: {
    fontWeight: '600',
  },
  connectedContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  connectedDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  connectedText: {
    fontSize: 11,
    color: '#86868b',
    fontWeight: '500',
  },
  achievementBadgeContainer: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  achievementBadge: {
  width: 44,
  height: 44,
  borderRadius: 22,
  backgroundColor: '#F2F2F7',
  justifyContent: 'center',
  alignItems: 'center',
  borderWidth: 1,
  borderColor: '#E5E5EA',
},
  achievementBadgeIcon: {
    fontSize: 22,
  },
  achievementBadgeOuter: {
    position: 'absolute',
    top: 4,
    right: 4,
  },
  achievementBadgeInner: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#FF6B6B',
    justifyContent: 'center',
    alignItems: 'center',
    borderWidth: 2,
    borderColor: '#FFFFFF',
  },
  achievementBadgeText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  socketStatusContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f5f5f7',
    borderRadius: 6,
  },
  socketStatusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  socketStatusText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#86868b',
    textTransform: 'lowercase',
    letterSpacing: 0.3,
  },
  // ... rest of your existing styles
  scrollView: {
    flex: 1,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 12,
    letterSpacing: -0.3,
  },
  quickStatsRow: {
    flexDirection: 'row',
    gap: 12,
  },
  quickStatCard: {
    flex: 1,
    borderRadius: 12,
    padding: 18,
    alignItems: 'center',
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: Colors.light.yellowAccent,
  },
  quickStatValue: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 4,
  },
  quickStatLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontWeight: '500',
  },
  activeTaskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    borderWidth: 2,
    borderLeftWidth: 4,
    borderColor: '#e5e5ea',
    borderLeftColor: Colors.light.yellow,
  },
  activeTaskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  activeTaskBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: Colors.light.yellowAccent,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  pulseIndicator: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#10B981',
  },
  activeTaskBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#1d1d1f',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  activeTaskId: {
    fontSize: 12,
    color: '#86868b',
  },
  activeTaskTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 12,
  },
  activeTaskInfo: {
    gap: 8,
    marginBottom: 16,
  },
  activeTaskInfoItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  activeTaskInfoText: {
    fontSize: 13,
    color: '#86868b',
  },
  activeTaskActions: {
    flexDirection: 'row',
    gap: 12,
  },
  activeTaskButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#000000',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
  },
  activeTaskButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  filterButton: {
    padding: 8,
  },
  filterDropdownContainerInline: {
    minWidth: 120,
  },
  filterDropdownContainer: {
    marginBottom: 16,
    marginHorizontal: -20,
    paddingHorizontal: 20,
  },
  filterDropdownButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#d2d2d7',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
  },
  filterDropdownButtonContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 8,
  },
  filterDropdownButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  filterDropdownMenu: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#d2d2d7',
    borderRadius: 8,
    marginTop: 8,
    marginBottom: 16,
    overflow: 'hidden',
  },
  filterDropdownItem: {
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  filterDropdownItemActive: {
    backgroundColor: '#f5f5f7',
  },
  filterDropdownItemText: {
    fontSize: 14,
    color: '#86868b',
    fontWeight: '500',
  },
  filterDropdownItemTextActive: {
    color: '#000000',
    fontWeight: '600',
  },
  tasksList: {
    gap: 12,
    paddingBottom: 24,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  priorityBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  priorityBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  taskId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#86868b',
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 6,
  },
  taskDescription: {
    fontSize: 13,
    color: '#86868b',
    lineHeight: 19,
    marginBottom: 12,
  },
  taskMeta: {
    gap: 8,
    marginBottom: 12,
  },
  taskMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskMetaText: {
    fontSize: 13,
    color: '#86868b',
    flex: 1,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
  },
  deadlineContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  deadlineText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  startTimeText: {
    fontSize: 12,
    color: '#3B82F6',
    fontWeight: '500',
  },
  detailButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#000000',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  detailButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  showMoreButton: {
    paddingVertical: 14,
    paddingHorizontal: 20,
    marginVertical: 16,
    marginHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#EFF6FF',
    borderRadius: 10,
    borderWidth: 1.5,
    borderColor: '#3B82F6',
  },
  showMoreButtonContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  showMoreButtonText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#3B82F6',
    letterSpacing: 0.3,
  },
  loadingContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#86868b',
  },
  emptyContainer: {
    padding: 40,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
  },
  emptyText: {
    fontSize: 14,
    color: '#86868b',
    textAlign: 'center',
  },
  errorContainer: {
    margin: 20,
    padding: 16,
    backgroundColor: '#FEE',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#FCC',
  },
  errorText: {
    fontSize: 14,
    color: '#C00',
    marginBottom: 8,
  },
  retryButton: {
    alignSelf: 'flex-start',
    backgroundColor: '#C00',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 4,
  },
  retryButtonText: {
    fontSize: 12,
    color: '#FFF',
    fontWeight: '600',
  },
  inactiveWarning: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 6,
    marginBottom: 12,
  },
  inactiveWarningText: {
    fontSize: 12,
    color: '#92400E',
    fontWeight: '500',
    flex: 1,
  },
  inactiveBadge: {
    backgroundColor: '#F3F4F6',
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 4,
  },
  inactiveBadgeText: {
    fontSize: 11,
    color: '#6B7280',
    fontWeight: '500',
  },
  // Skeleton Styles
  skeleton: {
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  skeletonBadge: {
    width: 70,
    height: 20,
    borderRadius: 4,
  },
  skeletonTaskId: {
    width: 80,
    height: 14,
    borderRadius: 4,
  },
  skeletonTaskTitle: {
    width: '85%',
    height: 20,
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonDescLine: {
    width: '100%',
    height: 14,
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonDescLineShort: {
    width: '65%',
    height: 14,
    borderRadius: 4,
    marginBottom: 10,
  },
  skeletonMetaItem: {
    width: 120,
    height: 14,
    borderRadius: 4,
  },
  skeletonButton: {
    width: '100%',
    height: 36,
    borderRadius: 8,
  },
});