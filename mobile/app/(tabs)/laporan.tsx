import React, { useState, useEffect, useCallback } from 'react';
import { useGpsGuard } from '@/hooks/useGpsGuard';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, RefreshControl, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter, useFocusEffect } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { reportsAPI } from '@/services/api';

const cTrackLogo = require('@/assets/images/C-Track.png');

interface TaskWithReports {
  takenTaskId: string;
  ticketNumber?: string;
  task: {
    taskId: string;
    title: string;
    location?: string;
    description?: string;
  };
  date?: string;
  startTime?: string;
  endTime?: string;
  status: string;
  reportCount: number;
  reportsThisMonth?: number;
  reportsThisWeek?: number;
  latestReportDate: string;
  hasPhotos: boolean;
  photoCount?: number;
}

export default function LaporanScreen() {
  useGpsGuard();

  const router = useRouter();
  const [tasks, setTasks] = useState<TaskWithReports[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0); // Force re-render key
  const [showAllReports, setShowAllReports] = useState(false);
  const [statistics, setStatistics] = useState({
    total_reports: 0,
    reports_this_month: 0,
    reports_this_week: 0,
  });

  // Fetch tasks with reports on mount
  useEffect(() => {
    fetchTasksWithReports();
  }, []);

  // Reload data when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('📱 Laporan screen focused - refreshing data...');
      fetchTasksWithReports(false); // false = don't show skeleton loading
      setRefreshKey(prev => prev + 1); // Force re-render
    }, [])
  );

  const calculateStatisticsFromTasks = (tasksList: TaskWithReports[]) => {
    const tasksWithReports = tasksList.filter(task => task.reportCount > 0);

    const totalReports = tasksWithReports.reduce((sum, task) => sum + task.reportCount, 0);
    const reportsThisMonth = tasksWithReports.reduce((sum, task) => sum + (task.reportsThisMonth ?? 0), 0);
    const reportsThisWeek = tasksWithReports.reduce((sum, task) => sum + (task.reportsThisWeek ?? 0), 0);

    return {
      total_reports: totalReports,
      reports_this_month: reportsThisMonth,
      reports_this_week: reportsThisWeek,
    };
  };

  const fetchTasksWithReports = async (showLoading = true) => {
    try {
      if (showLoading) {
        setIsLoading(true);
      }
      const response = await reportsAPI.getMyTasksWithReports();

      console.log('📊 RAW API Response:', response);
      console.log('📊 Tasks count:', response.tasks?.length);

      if (response.tasks && response.tasks.length > 0) {
        // Log raw data first
        console.log('📊 First task raw data:', JSON.stringify(response.tasks[0], null, 2));
        
        // Deep clone to ensure React detects changes
        const freshTasks = JSON.parse(JSON.stringify(response.tasks));
        
        setTasks(freshTasks);
        
        // Use statistics from backend if available, otherwise calculate from tasks
        if (response.statistics) {
          setStatistics(response.statistics);
        } else {
          const calculatedStats = calculateStatisticsFromTasks(freshTasks);
          setStatistics(calculatedStats);
        }
        console.log(`✅ State updated with ${freshTasks.length} tasks`);
      } else {
        console.warn('⚠️ No tasks data in response');
        setTasks([]);
        setStatistics({
          total_reports: 0,
          reports_this_month: 0,
          reports_this_week: 0,
        });
      }
    } catch (error) {
      console.error('❌ Error fetching tasks with reports:', error);
      setTasks([]);
    } finally {
      if (showLoading) {
        setIsLoading(false);
      }
    }
  };

  const onRefresh = async () => {
    setIsRefreshing(true);
    await fetchTasksWithReports();
    setIsRefreshing(false);
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  // ── Render Functions ──────────────────────────────────────────────────────

  const renderHeader = () => (
    <View style={styles.header}>
      <View>
        <Text style={styles.headerTitle}>Laporan Tim</Text>
        <Text style={styles.headerSubtitle}>Semua laporan dari anggota tim</Text>
      </View>
      <TouchableOpacity style={styles.logoButton}>
        <Image
          source={cTrackLogo}
          style={styles.headerIcon}
        />
      </TouchableOpacity>
    </View>
  );

  const renderSummaryCard = () => (
    <View style={styles.summaryCard}>
      <Text style={styles.summaryTitle}>RINGKASAN LAPORAN TIM</Text>
      <View style={styles.summaryStats}>
        <View style={styles.summaryStatItem}>
          <View style={styles.summaryStatIcon}>
            <IconSymbol size={24} name="doc.text.fill" color="#FFFFFF" />
          </View>
          <Text style={styles.summaryStatValue}>{statistics.total_reports}</Text>
          <Text style={styles.summaryStatLabel}>Total</Text>
        </View>
        <View style={styles.summaryStatItem}>
          <View style={styles.summaryStatIcon}>
            <IconSymbol size={24} name="calendar.circle.fill" color="#FFFFFF" />
          </View>
          <Text style={styles.summaryStatValue}>{statistics.reports_this_month}</Text>
          <Text style={styles.summaryStatLabel}>Bulan Ini</Text>
        </View>
        <View style={styles.summaryStatItem}>
          <View style={styles.summaryStatIcon}>
            <IconSymbol size={24} name="calendar" color="#FFFFFF" />
          </View>
          <Text style={styles.summaryStatValue}>{statistics.reports_this_week}</Text>
          <Text style={styles.summaryStatLabel}>Minggu Ini</Text>
        </View>
      </View>
    </View>
  );

  const renderTaskSkeleton = () => (
    <View style={styles.tasksList}>
      {[1, 2, 3, 4].map((i) => (
        <View key={i} style={styles.taskCard}>
          <View style={styles.taskHeader}>
            <View style={styles.taskHeaderLeft}>
              <View style={[styles.skeleton, styles.skeletonIcon]} />
              <View>
                <View style={[styles.skeleton, styles.skeletonTicket]} />
                <View style={[styles.skeleton, styles.skeletonTitle]} />
              </View>
            </View>
            <View style={[styles.skeleton, styles.skeletonBadge]} />
          </View>
          <View style={styles.taskStats}>
            <View style={[styles.skeleton, styles.skeletonStat]} />
            <View style={[styles.skeleton, styles.skeletonStat]} />
          </View>
        </View>
      ))}
    </View>
  );

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <IconSymbol size={60} name="doc.text" color="#86868b" />
      </View>
      <Text style={styles.emptyTitle}>Belum Ada Laporan</Text>
      <Text style={styles.emptyDescription}>
        Laporan dari tim Anda akan muncul di sini
      </Text>
    </View>
  );

  const renderTaskCard = (task: TaskWithReports) => {
    // Log status when rendering
    console.log(`🎨 Rendering card for ${task.task?.title} with status: ${task.status}`);
    
    return (
      <TouchableOpacity
        key={`${task.takenTaskId}-${task.status}-${task.reportCount}`}
        style={styles.taskCard}
        onPress={() => router.push(`/task-reports?takenTaskId=${task.takenTaskId}`)}
      >
        {/* Header Section */}
        <View style={styles.taskHeader}>
          <View style={styles.taskHeaderLeft}>
            <View style={styles.taskIcon}>
              <IconSymbol size={22} name="briefcase.fill" color="#FFFFFF" />
            </View>
            <View style={styles.taskHeaderInfo}>
              <Text style={styles.taskTicket}>
                {task.ticketNumber || task.takenTaskId.substring(0, 8).toUpperCase()}
              </Text>
              <Text style={styles.taskTitle} numberOfLines={2}>{task.task.title}</Text>
            </View>
          </View>
          <View style={[styles.statusBadge, { backgroundColor: task.status === 'completed' ? '#10B981' : '#3B82F6' }]}>
            <Text style={styles.statusText}>
              {task.status === 'completed' ? 'SELESAI' : 'AKTIF'}
            </Text>
          </View>
        </View>

        {/* Location Section */}
        {task.task.location && (
          <View style={styles.taskLocation}>
            <IconSymbol size={14} name="location.fill" color="#86868b" />
            <Text style={styles.taskLocationText} numberOfLines={1}>
              {task.task.location}
            </Text>
          </View>
        )}

        {/* Stats Section */}
        <View style={styles.taskStats}>
          <View style={styles.taskStatItem}>
            <IconSymbol size={18} name="doc.text.fill" color="#1d1d1f" />
            <View style={styles.taskStatContent}>
              <Text style={styles.taskStatValue}>{task.reportCount}</Text>
              <Text style={styles.taskStatLabel}>Laporan</Text>
            </View>
          </View>

          <View style={styles.taskStatDivider} />

          <View style={styles.taskStatItem}>
            <IconSymbol size={18} name="calendar" color="#1d1d1f" />
            <View style={styles.taskStatContent}>
              <Text style={styles.taskStatValue}>
                {task.date ? formatDate(task.date).split(' ')[0] : '-'}
              </Text>
              <Text style={styles.taskStatLabel}>Tanggal</Text>
            </View>
          </View>

          {task.hasPhotos && (
            <>
              <View style={styles.taskStatDivider} />
              <View style={styles.taskStatItem}>
                <IconSymbol size={18} name="photo.fill" color="#1d1d1f" />
                <View style={styles.taskStatContent}>
                  <Text style={styles.taskStatValue}>{task.photoCount || 0}</Text>
                  <Text style={styles.taskStatLabel}>Foto</Text>
                </View>
              </View>
            </>
          )}
        </View>

        {/* Footer Section */}
        <View style={styles.taskFooter}>
          <Text style={styles.taskFooterText}>
            Laporan terakhir: {formatDate(task.latestReportDate)}
          </Text>
          <IconSymbol size={16} name="chevron.right" color="#c7c7cc" />
        </View>
      </TouchableOpacity>
    );
  };

  const getSortedTasks = () => {
    return tasks.sort((a, b) => {
      // aktif (not completed) comes first, then selesai (completed)
      const aIsCompleted = a.status === 'completed';
      const bIsCompleted = b.status === 'completed';
      
      if (aIsCompleted === bIsCompleted) {
        return 0; // Keep original order if same status
      }
      return aIsCompleted ? 1 : -1; // Aktif comes first
    });
  };

  const renderTasksList = () => {
    if (isLoading) return renderTaskSkeleton();
    if (tasks.length === 0) return renderEmptyState();
    
    const sortedTasks = getSortedTasks();
    const displayedTasks = showAllReports ? sortedTasks : sortedTasks.slice(0, 3);
    const hasMoreTasks = sortedTasks.length > 3;
    
    console.log(`🎨 Rendering ${displayedTasks.length} task cards (refreshKey: ${refreshKey})...`);
    
    return (
      <View style={styles.tasksList}>
        {displayedTasks.map((task, index) => (
          <View key={`task-${task.takenTaskId}-${task.status}-${refreshKey}-${index}`}>
            {renderTaskCard(task)}
          </View>
        ))}
        {hasMoreTasks && (
          <TouchableOpacity
            style={styles.showMoreButton}
            onPress={() => setShowAllReports(!showAllReports)}
            activeOpacity={0.7}
          >
            <View style={styles.showMoreButtonContent}>
              <Text style={styles.showMoreButtonText}>
                {showAllReports ? 'Tampilkan Lebih Sedikit' : `Tampilkan Lebih Banyak (${sortedTasks.length - 3})`}
              </Text>
              <IconSymbol
                size={18}
                name={showAllReports ? 'chevron.up' : 'chevron.down'}
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
          <RefreshControl
            refreshing={isRefreshing}
            onRefresh={onRefresh}
            tintColor="#1d1d1f"
          />
        }
      >
        {/* Summary Card */}
        {renderSummaryCard()}

        {/* Tasks List */}
        <View style={styles.reportsSection}>
          <View style={styles.reportsSectionHeader}>
            <Text style={styles.sectionTitle}>Laporan Tugas</Text>
            <Text style={styles.totalReportsText}>
              {tasks.length} Tugas
            </Text>
          </View>

          {renderTasksList()}
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
    paddingVertical: 12,
    backgroundColor: '#FFFFFF',
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  headerTitle: {
    fontSize: 20,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  headerSubtitle: {
    fontSize: 13,
    fontWeight: '500',
    color: '#86868b',
    marginTop: 2,
  },
  logoButton: {
    padding: 0,
    marginVertical: -8,
  },
  headerIcon: {
    width: 56,
    height: 56,
    resizeMode: 'contain',
  },
  scrollView: {
    flex: 1,
  },
  summaryCard: {
    backgroundColor: '#1a1a1a',
    borderRadius: 16,
    padding: 24,
    marginHorizontal: 20,
    marginTop: 20,
    borderWidth: 1,
    borderColor: 'rgba(255, 255, 255, 0.08)',
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
  },
  summaryTitle: {
    fontSize: 12,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
    marginBottom: 20,
    letterSpacing: 1,
  },
  summaryStats: {
    flexDirection: 'row',
    justifyContent: 'space-around',
  },
  summaryStatItem: {
    alignItems: 'center',
    gap: 8,
  },
  summaryStatIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(255, 255, 255, 0.12)',
  },
  summaryStatValue: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: -0.5,
  },
  summaryStatLabel: {
    fontSize: 11,
    color: 'rgba(255, 255, 255, 0.6)',
    textAlign: 'center',
    letterSpacing: 0.3,
    fontWeight: '500',
  },
  reportsSection: {
    marginTop: 24,
    paddingHorizontal: 20,
  },
  reportsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.4,
  },
  totalReportsText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#86868b',
    letterSpacing: 0.1,
  },
  loadingContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#86868b',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 20,
  },
  emptyTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1d1d1f',
    marginBottom: 8,
    letterSpacing: -0.3,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#86868b',
    textAlign: 'center',
    lineHeight: 21,
    fontWeight: '500',
  },
  tasksList: {
    gap: 16,
    paddingBottom: 20,
  },
  taskCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    padding: 18,
    borderWidth: 1,
    borderColor: '#e5e5ea',
    elevation: 2,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.06,
    shadowRadius: 8,
  },
  taskHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 14,
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flex: 1,
    gap: 12,
    marginRight: 8,
  },
  taskIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1d1d1f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  taskHeaderInfo: {
    flex: 1,
    paddingTop: 2,
  },
  taskTicket: {
    fontSize: 11,
    fontWeight: '600',
    color: '#86868b',
    marginBottom: 4,
    letterSpacing: 0.3,
  },
  taskTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    lineHeight: 22,
    letterSpacing: -0.2,
  },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 6,
    alignSelf: 'flex-start',
  },
  statusText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 0.6,
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
  taskLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 14,
    paddingLeft: 2,
  },
  taskLocationText: {
    fontSize: 13,
    color: '#86868b',
    flex: 1,
    lineHeight: 18,
  },
  taskStats: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 0,
    paddingVertical: 14,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    marginHorizontal: -2,
  },
  taskStatItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    flex: 1,
    paddingHorizontal: 4,
  },
  taskStatContent: {
    flexDirection: 'column',
  },
  taskStatValue: {
    fontSize: 16,
    fontWeight: '700',
    color: '#1d1d1f',
    lineHeight: 20,
    letterSpacing: -0.2,
  },
  taskStatLabel: {
    fontSize: 10,
    color: '#86868b',
    fontWeight: '500',
    marginTop: 1,
    letterSpacing: 0.2,
  },
  taskStatDivider: {
    width: 1,
    height: 32,
    backgroundColor: '#e5e5ea',
    marginHorizontal: 8,
  },
  taskFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginTop: 14,
    paddingTop: 2,
  },
  taskFooterText: {
    fontSize: 12,
    color: '#86868b',
    fontWeight: '500',
  },
  // Skeleton Styles
  skeleton: {
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  skeletonIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  skeletonTicket: {
    width: 100,
    height: 12,
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonTitle: {
    width: '80%',
    height: 16,
    borderRadius: 4,
  },
  skeletonBadge: {
    width: 60,
    height: 20,
    borderRadius: 4,
  },
  skeletonStat: {
    width: 80,
    height: 24,
    borderRadius: 6,
  },
});