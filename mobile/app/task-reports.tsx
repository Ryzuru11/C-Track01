import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, ActivityIndicator, Image } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter, useFocusEffect } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { reportsAPI, tasksAPI, getUserAvatar } from '@/services/api';
import { LocationTrackingService } from '@/services/locationTrackingRefactored';
import { showToast, showDialog } from '@/utils/alert';
import { useAppContext } from '@/context/AppContext';

interface Report {
  reportId: string;
  ticketNumber?: string;
  report: string;
  createdAt: string;
  image?: string;
  user: {
    id: string;
    name: string;
    email: string;
    avatar?: string;
  };
}

// ── UserAvatar component with lazy photo loading ──────────────────────────
const UserAvatar = ({
  userId,
  name,
  size = 36,
  fallbackBg = '#1d1d1f',
  borderColor,
}: {
  userId: string;
  name: string;
  size?: number;
  fallbackBg?: string;
  borderColor?: string;
}) => {
  const [avatarUri, setAvatarUri] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (userId) {
      getUserAvatar(userId).then((uri) => {
        if (isMounted && uri) setAvatarUri(uri);
      });
    }
    return () => { isMounted = false; };
  }, [userId]);

  const initials = (name || '?').charAt(0).toUpperCase();
  const containerStyle = {
    width: size,
    height: size,
    borderRadius: size / 2,
    justifyContent: 'center' as const,
    alignItems: 'center' as const,
    backgroundColor: avatarUri ? 'transparent' : fallbackBg,
    ...(borderColor ? { borderWidth: 2, borderColor } : {}),
    overflow: 'hidden' as const,
  };

  return (
    <View style={containerStyle}>
      {avatarUri ? (
        <Image
          source={{ uri: avatarUri }}
          style={{ width: size, height: size, borderRadius: size / 2 }}
        />
      ) : (
        <Text style={{ color: '#FFFFFF', fontSize: size * 0.36, fontWeight: '700' }}>
          {initials}
        </Text>
      )}
    </View>
  );
};

export default function TaskReportsScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const takenTaskId = params.takenTaskId as string;

  const [isLoading, setIsLoading] = useState(true);
  const [takenTask, setTakenTask] = useState<any>(null);
  const [reports, setReports] = useState<Report[]>([]);
  const [isCompletingTask, setIsCompletingTask] = useState(false);
  const [userHasCompletedTask, setUserHasCompletedTask] = useState(false);
  const [assignedUsers, setAssignedUsers] = useState<any[]>([]);

  // ── Context ──────────────────────────────────────────────────────────────
  const { user } = useAppContext();
  const currentUserId = user?.id ?? null;

  useEffect(() => {
    if (takenTaskId) {
      loadReportsForTask();
    }
  }, [takenTaskId]);

  // Reload reports when screen comes into focus
  useFocusEffect(
    useCallback(() => {
      console.log('📱 Task Reports screen focused - refreshing data...');
      if (takenTaskId) {
        loadReportsForTask();
      }
    }, [takenTaskId])
  );

  /**
   * Safely parse userStatuses — handles both JSON string and object forms.
   */
  const parseUserStatuses = (raw: any): Record<string, string> => {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    if (typeof raw === 'object') return raw as Record<string, string>;
    return {};
  };

  /**
   * Derive status selesai user murni dari userStatuses server.
   */
  const deriveUserCompletion = (takenTaskData: any, userId: string | null) => {
    if (!userId || !takenTaskData?.userStatuses) return false;
    const statuses = parseUserStatuses(takenTaskData.userStatuses);
    return statuses[userId] === 'completed';
  };

  const loadReportsForTask = async () => {
    try {
      setIsLoading(true);
      console.log('📥 Loading reports for task:', takenTaskId);

      // userId comes from AppContext — always available, no API fetch needed
      const userId = currentUserId;

      const response = await reportsAPI.getReportsForTakenTask(takenTaskId);
      console.log('📊 Task Reports Response:', response);

      if (response.takenTask) {
        setTakenTask(response.takenTask);
        const isDone = deriveUserCompletion(response.takenTask, userId);
        setUserHasCompletedTask(isDone);
        console.log(`✅ Task loaded - Status: ${response.takenTask.status}, userDone: ${isDone}`);
      }

      if (response.reports) {
        setReports(response.reports);
        console.log(`✅ Loaded ${response.reports.length} reports for task`);
      }

      // Load data tim lengkap dari assignment
      try {
        const assignmentResp = await tasksAPI.getTakenTaskDetail(takenTaskId);
        console.log('📋 Assignment response:', JSON.stringify(assignmentResp).substring(0, 500));
        // Try multiple paths the API might return users under
        const users =
          assignmentResp?.takenTask?.users ??
          assignmentResp?.users ??
          assignmentResp?.data?.users ??
          null;
        if (users && Array.isArray(users) && users.length > 0) {
          setAssignedUsers(users);
          console.log(`✅ Loaded ${users.length} assigned users:`, users.map((u: any) => u.name));
        } else {
          // Fallback: jika API tidak return users terpisah, cek dari response.takenTask langsung
          const directUsers = assignmentResp?.takenTask?.task?.assignments
            ?.map((a: any) => a.user)
            .filter(Boolean);
          if (directUsers && directUsers.length > 0) {
            setAssignedUsers(directUsers);
            console.log(`✅ Loaded ${directUsers.length} users from assignments:`, directUsers.map((u: any) => u.name));
          } else {
            console.warn('⚠️ No users found in response. Keys:', Object.keys(assignmentResp || {}));
          }
        }
      } catch (err) {
        console.warn('⚠️ Gagal load assigned users:', err);
      }
    } catch (error) {
      console.error('❌ Error loading task reports:', error);
    } finally {
      setIsLoading(false);
    }
  };

  /**
   * Build user info map - prioritas: assignedUsers > takenTask.users > report authors
   */
  const buildUserMap = () => {
    const userMap: Record<string, { name: string; email: string }> = {};
    // Priority 1: assigned users dari API (data tim lengkap)
    assignedUsers.forEach((user: any) => {
      if (user.id) userMap[user.id] = { name: user.name || 'Unknown', email: user.email || '' };
    });
    // Priority 2: takenTask.users jika ada
    if (takenTask?.users && Array.isArray(takenTask.users)) {
      takenTask.users.forEach((user: any) => {
        if (user.id && !userMap[user.id]) userMap[user.id] = { name: user.name || 'Unknown', email: user.email || '' };
      });
    }
    // Priority 3: fallback dari report authors
    reports.forEach((report) => {
      if (report.user?.id && !userMap[report.user.id]) {
        userMap[report.user.id] = { name: report.user.name, email: report.user.email };
      }
    });
    return userMap;
  };

  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    const day = date.getDate();
    const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];
    const month = monthNames[date.getMonth()];
    const year = date.getFullYear();
    return `${day} ${month} ${year}`;
  };

  const formatTime = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' });
  };

  const getPhotoCount = (imageString?: string) => {
    if (!imageString) return 0;
    try {
      const images = JSON.parse(imageString);
      return Array.isArray(images) ? images.length : 0;
    } catch {
      return 0;
    }
  };

  const handleAddReport = () => {
    if (!takenTask) return;

    // Check if user has already completed the task
    if (userHasCompletedTask) {
      showToast('Anda sudah menyelesaikan laporan. Tunggu teman lainnya untuk menyelesaikan tugas ini.', 'info');
      return;
    }

    // Check if all users have completed the task
    const statuses = parseUserStatuses(takenTask.userStatuses);
    const allUsersCompleted = Object.keys(statuses).length > 0 &&
      Object.values(statuses).every(status => status === 'completed');

    if (allUsersCompleted) {
      showToast('Tidak dapat menambah laporan untuk tugas yang sudah selesai', 'warning');
      return;
    }

    // Navigate to report creation screen with task data
    const taskData = {
      taskId: takenTaskId,
      taskTitle: takenTask.task?.title || 'Task',
      taskLocation: takenTask.task?.location,
      taskLatitude: takenTask.task?.latitude,
      taskLongitude: takenTask.task?.longitude,
      taskDate: takenTask.date ? new Date(takenTask.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }) : new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
      taskStartTime: takenTask.startTime,
    };

    router.push(`/report-detail?reportId=new&takenTaskId=${takenTaskId}&taskData=${encodeURIComponent(JSON.stringify(taskData))}`);
  };

  const handleCompleteTask = async () => {
    if (!takenTask) return;

    // Check if user has already completed the task
    if (userHasCompletedTask) {
      showToast('Anda sudah menyelesaikan laporan. Tunggu teman lainnya selesai.', 'info');
      return;
    }

    // Check if all users have completed the task
    const statuses = parseUserStatuses(takenTask.userStatuses);
    const allUsersCompleted = Object.keys(statuses).length > 0 &&
      Object.values(statuses).every(status => status === 'completed');

    if (allUsersCompleted) {
      showToast('Tugas ini sudah selesai semua', 'info');
      return;
    }

    showDialog(
      'Selesaikan Tugas',
      'Apakah Anda yakin ingin menandai tugas ini sebagai selesai?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Selesai',
          onPress: async () => {
            try {
              setIsCompletingTask(true);

              // Stop location tracking when task is completed
              await LocationTrackingService.stopTracking();
              console.log('🛑 Tracking stopped - task completed');

              await tasksAPI.completeTask(takenTaskId);
              console.log('✅ Task completed successfully');

              // Reload dari server — userStatuses akan terupdate otomatis
              await loadReportsForTask();

              showToast('Laporan Anda berhasil diselesaikan', 'success');
            } catch (error: any) {
              console.error('Error completing task:', error);
              showToast(error.message || 'Gagal menyelesaikan tugas', 'error');
            } finally {
              setIsCompletingTask(false);
            }
          },
        },
      ]
    );
  };

  const renderTaskHeader = () => {
    if (!takenTask) return null;

    const userMap = buildUserMap();
    // Use assignedUsers directly if available, otherwise fall back to userStatuses keys
    const teamMembers: Array<{ id: string; name: string; email: string }> =
      assignedUsers.length > 0
        ? assignedUsers.map((u: any) => ({ id: u.id || u.userId || '', name: u.name || 'Anggota Tim', email: u.email || '' }))
        : Object.keys(takenTask.userStatuses || {}).map((uid) => ({
          id: uid,
          name: userMap[uid]?.name || `User ${uid.substring(0, 6)}`,
          email: userMap[uid]?.email || '',
        }));
    const teamMemberIds = Object.keys(takenTask.userStatuses || {});

    return (
      <View style={styles.taskHeaderCard}>
        <View style={styles.taskHeaderTop}>
          <View style={styles.taskHeaderLeft}>
            <View style={styles.taskIcon}>
              <IconSymbol name="briefcase.fill" size={20} color="#FFFFFF" />
            </View>
            <View style={styles.taskHeaderInfo}>
              <Text style={styles.taskTicket}>{takenTask.ticketNumber || 'Task'}</Text>
              <Text style={styles.taskTitle}>{takenTask.task?.title || 'Task'}</Text>
            </View>
          </View>
          <View style={[
            styles.statusBadge,
            {
              backgroundColor: (() => {
                const statuses = parseUserStatuses(takenTask.userStatuses);
                const allUsersCompleted = Object.keys(statuses).length > 0 &&
                  Object.values(statuses).every(status => status === 'completed');
                return allUsersCompleted ? '#1d1d1f' : '#10B981';
              })(),
            },
          ]}>
            <IconSymbol
              size={11}
              name={
                (() => {
                  const statuses = parseUserStatuses(takenTask.userStatuses);
                  const allUsersCompleted = Object.keys(statuses).length > 0 &&
                    Object.values(statuses).every(status => status === 'completed');
                  return allUsersCompleted ? 'checkmark.circle.fill' : 'bolt.fill';
                })()
              }
              color="#FFFFFF"
            />
            <Text style={styles.statusBadgeText}>
              {(() => {
                const statuses = parseUserStatuses(takenTask.userStatuses);
                const allUsersCompleted = Object.keys(statuses).length > 0 &&
                  Object.values(statuses).every(status => status === 'completed');
                return allUsersCompleted ? 'SELESAI' : 'AKTIF';
              })()}
            </Text>
          </View>
        </View>

        {takenTask.task?.location && (
          <View style={styles.taskLocation}>
            <IconSymbol name="location.fill" size={14} color="#86868b" />
            <Text style={styles.taskLocationText}>{takenTask.task.location}</Text>
          </View>
        )}

        <View style={styles.taskStats}>
          <View style={styles.taskStat}>
            <IconSymbol name="doc.text.fill" size={16} color="#1d1d1f" />
            <Text style={styles.taskStatValue}>{reports.length}</Text>
            <Text style={styles.taskStatLabel}>Laporan</Text>
          </View>
          {takenTask.date && (
            <View style={styles.taskStat}>
              <IconSymbol name="calendar" size={16} color="#1d1d1f" />
              <Text style={styles.taskStatValue}>
                {new Date(takenTask.date).toLocaleDateString('id-ID', { day: 'numeric', month: 'short' })}
              </Text>
              <Text style={styles.taskStatLabel}>Tanggal</Text>
            </View>
          )}
        </View>

        {/* Team Section */}
        {teamMembers.length > 0 && (
          <View style={styles.teamSection}>
            <Text style={styles.teamSectionTitle}>Tim Tugas ({teamMembers.length} anggota)</Text>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.teamMembersList}
            >
              {teamMembers.map((member) => {
                const statuses = parseUserStatuses(takenTask.userStatuses);
                const memberStatus = statuses[member.id];
                const isCompleted = memberStatus === 'completed';
                return (
                  <View key={member.id} style={styles.teamMemberItem}>
                    <UserAvatar
                      userId={member.id}
                      name={member.name}
                      size={40}
                      fallbackBg={isCompleted ? '#10B981' : '#1d1d1f'}
                      borderColor={isCompleted ? '#10B981' : undefined}
                    />
                    <View style={styles.teamMemberInfo}>
                      <Text style={styles.teamMemberName} numberOfLines={1}>{member.name}</Text>
                      <View style={styles.teamMemberStatusBadge}>
                        <IconSymbol
                          size={10}
                          name={isCompleted ? 'checkmark.circle.fill' : 'clock.fill'}
                          color={isCompleted ? '#10B981' : '#86868b'}
                        />
                        <Text style={[styles.teamMemberStatusText, { color: isCompleted ? '#10B981' : '#86868b' }]}>
                          {isCompleted ? 'Selesai' : 'Proses'}
                        </Text>
                      </View>
                    </View>
                  </View>
                );
              })}
            </ScrollView>
          </View>
        )}
      </View>
    );
  };

  const renderReportCard = (report: Report) => {
    const photoCount = getPhotoCount(report.image);
    const hasPhoto = photoCount > 0;
    const statuses = parseUserStatuses(takenTask?.userStatuses);
    const allUsersCompleted = Object.keys(statuses).length > 0 &&
      Object.values(statuses).every(status => status === 'completed');

    return (
      <TouchableOpacity
        key={report.reportId}
        style={styles.reportCard}
        onPress={() => router.push(`/report-detail?reportId=${report.reportId}&takenTaskId=${takenTaskId}`)}
      >
        <View style={styles.reportHeader}>
          <View style={styles.reportHeaderLeft}>
            <UserAvatar
              userId={report.user.id}
              name={report.user.name}
              size={36}
              fallbackBg="#1d1d1f"
            />
            <View>
              <Text style={styles.reportTicket}>{report.ticketNumber || report.reportId.substring(0, 8).toUpperCase()}</Text>
              <Text style={styles.reportAuthor}>{report.user.name}</Text>
            </View>
          </View>
          <View style={styles.reportDate}>
            <Text style={styles.reportDateText}>{formatDate(report.createdAt)}</Text>
            <Text style={styles.reportTimeText}>{formatTime(report.createdAt)}</Text>
          </View>
        </View>

        <Text style={styles.reportDescription} numberOfLines={3}>
          {report.report}
        </Text>

        {/* Row 1: Edit + Lihat Detail */}
        <View style={styles.reportActionRow}>
          {report.user.id === currentUserId && !allUsersCompleted && (
            <TouchableOpacity
              style={styles.editButton}
              onPress={() => router.push(`/report-detail?reportId=${report.reportId}&takenTaskId=${takenTaskId}&editMode=true`)}
            >
              <IconSymbol size={13} name="pencil" color="#1d1d1f" />
              <Text style={styles.editButtonText}>Edit</Text>
            </TouchableOpacity>
          )}
          <TouchableOpacity
            style={styles.viewButton}
            onPress={() => router.push(`/report-detail?reportId=${report.reportId}&takenTaskId=${takenTaskId}`)}
          >
            <IconSymbol size={13} name="eye.fill" color="#1d1d1f" />
            <Text style={styles.viewButtonText}>Lihat Detail</Text>
          </TouchableOpacity>
        </View>

        {/* Row 2: Foto count (left) + Forum Diskusi (right) */}
        <View style={styles.reportFooter}>
          <View style={styles.reportFooterLeft}>
            {hasPhoto && (
              <View style={styles.photoIndicator}>
                <IconSymbol size={13} name="photo.fill" color="#1d1d1f" />
                <Text style={styles.photoIndicatorText}>{photoCount} Foto</Text>
              </View>
            )}
          </View>
          <TouchableOpacity
            style={styles.forumButton}
            onPress={() => router.push(`/forum/${report.reportId}`)}
          >
            <IconSymbol size={14} name="message.fill" color="#FFFFFF" />
            <Text style={styles.forumButtonText}>Forum Diskusi</Text>
          </TouchableOpacity>
        </View>
      </TouchableOpacity>
    );
  };

  const renderEmptyState = () => (
    <View style={styles.emptyContainer}>
      <View style={styles.emptyIconContainer}>
        <IconSymbol size={48} name="doc.text" color="#86868b" />
      </View>
      <Text style={styles.emptyTitle}>Belum Ada Laporan</Text>
      <Text style={styles.emptyDescription}>
        Belum ada laporan yang dibuat untuk tugas ini
      </Text>
    </View>
  );

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
        <Text style={styles.headerTitle}>Laporan</Text>
        <View style={styles.headerRight} />
      </View>

      {isLoading ? (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="large" color="#1d1d1f" />
          <Text style={styles.loadingText}>Memuat laporan...</Text>
        </View>
      ) : (
        <ScrollView
          style={styles.scrollView}
          showsVerticalScrollIndicator={false}
          contentContainerStyle={styles.scrollViewContent}
        >
          {/* Task Header */}
          {renderTaskHeader()}

          {/* Action Buttons / Status Banner */}
          {takenTask && (() => {
            // Cek apakah semua user sudah selesai berdasarkan userStatuses
            const statuses = parseUserStatuses(takenTask.userStatuses);
            const allUsersCompleted = Object.keys(statuses).length > 0 &&
              Object.values(statuses).every(status => status === 'completed');

            // Semua user selesai → task fully completed
            if (allUsersCompleted) {
              return (
                <View style={styles.completedBanner}>
                  <View style={styles.completedBannerIcon}>
                    <IconSymbol size={28} name="checkmark.circle.fill" color="#10B981" />
                  </View>
                  <View style={styles.completedBannerText}>
                    <Text style={styles.completedBannerTitle}>Tugas Selesai</Text>
                    <Text style={styles.completedBannerDesc}>Semua anggota tim telah menyelesaikan laporan</Text>
                  </View>
                </View>
              );
            }

            // User ini sudah selesai, tapi masih menunggu yang lain
            if (userHasCompletedTask) {
              return (
                <View style={styles.actionsContainer}>
                  <View
                    style={[
                      styles.actionButton,
                      styles.addReportButton,
                      styles.actionButtonDisabled,
                    ]}
                  >
                    <IconSymbol size={18} name="plus.circle.fill" color="#FFFFFF" />
                    <Text style={styles.actionButtonText}>Tambah Laporan</Text>
                  </View>
                  <View
                    style={[
                      styles.actionButton,
                      styles.completeButton,
                      styles.actionButtonDisabled,
                    ]}
                  >
                    <IconSymbol size={18} name="checkmark.circle.fill" color="#FFFFFF" />
                    <Text style={styles.actionButtonText}>Menunggu Tim</Text>
                  </View>
                </View>
              );
            }

            // Normal: tombol tambah laporan + selesai
            return (
              <View style={styles.actionsContainer}>
                <TouchableOpacity
                  style={[styles.actionButton, styles.addReportButton]}
                  onPress={handleAddReport}
                >
                  <IconSymbol size={18} name="plus.circle.fill" color="#FFFFFF" />
                  <Text style={styles.actionButtonText}>Tambah Laporan</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  style={[
                    styles.actionButton,
                    styles.completeButton,
                    isCompletingTask && styles.buttonDisabled,
                  ]}
                  onPress={handleCompleteTask}
                  disabled={isCompletingTask}
                >
                  {isCompletingTask ? (
                    <>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                      <Text style={styles.actionButtonText}>Memproses...</Text>
                    </>
                  ) : (
                    <>
                      <IconSymbol size={18} name="checkmark.circle.fill" color="#FFFFFF" />
                      <Text style={styles.actionButtonText}>Selesai</Text>
                    </>
                  )}
                </TouchableOpacity>
              </View>
            );
          })()}

          {/* Reports List */}
          <View style={styles.reportsSection}>
            <View style={styles.reportsSectionHeader}>
              <Text style={styles.sectionTitle}>Daftar Laporan</Text>
              <Text style={styles.reportCount}>{reports.length} Laporan</Text>
            </View>

            {reports.length === 0 ? (
              renderEmptyState()
            ) : (
              <View style={styles.reportsList}>
                {reports.map((report) => renderReportCard(report))}
              </View>
            )}
          </View>

          {/* Bottom spacer - gives room to scroll */}
          <View style={styles.bottomSpacer} />
        </ScrollView>
      )}
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
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 14,
    color: '#86868b',
    fontWeight: '500',
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 32,
  },
  taskHeaderCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  taskHeaderTop: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 12,
  },
  taskHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
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
  },
  taskTicket: {
    fontSize: 11,
    fontWeight: '600',
    color: '#86868b',
    marginBottom: 2,
  },
  taskTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  statusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 6,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  taskLocation: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 12,
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
  },
  taskLocationText: {
    fontSize: 13,
    color: '#86868b',
    flex: 1,
  },
  taskStats: {
    flexDirection: 'row',
    gap: 20,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
  },
  taskStat: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  taskStatValue: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  taskStatLabel: {
    fontSize: 12,
    color: '#86868b',
  },
  actionsContainer: {
    flexDirection: 'row',
    gap: 10,
    paddingHorizontal: 20,
    marginTop: 16,
  },
  completedBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: '#10B981',
    borderRadius: 14,
    marginHorizontal: 20,
    marginTop: 16,
    padding: 16,
    borderWidth: 1,
    borderColor: '#10B981',
  },
  completedBannerIcon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  completedBannerText: {
    flex: 1,
  },
  completedBannerTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#FFFFFF',
    marginBottom: 2,
  },
  completedBannerDesc: {
    fontSize: 12,
    color: '#FFFFFF',
    lineHeight: 18,
  },
  waitingBanner: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    marginHorizontal: 20,
    marginTop: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
    overflow: 'hidden',
  },
  waitingBannerTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    padding: 16,
    backgroundColor: '#f5f5f7',
  },
  waitingBannerIconWrap: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#1d1d1f',
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitingBannerTextWrap: {
    flex: 1,
  },
  waitingBannerTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  waitingBannerDesc: {
    fontSize: 12,
    color: '#86868b',
    lineHeight: 17,
  },
  waitingBannerDivider: {
    height: 1,
    backgroundColor: '#e5e5ea',
    marginHorizontal: 0,
  },
  waitingStatusButton: {
    backgroundColor: '#f5f5f7',
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  waitingStatusButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#86868b',
  },
  teamSection: {
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
    marginTop: 12,
  },
  teamSectionTitle: {
    fontSize: 13,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 10,
  },
  teamMembersList: {
    flexDirection: 'row',
    gap: 10,
    paddingBottom: 2,
  },
  teamMemberItem: {
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    minWidth: 80,
    paddingHorizontal: 10,
    paddingVertical: 10,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  teamMemberAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    justifyContent: 'center',
    alignItems: 'center',
  },
  teamMemberAvatarText: {
    color: '#FFFFFF',
    fontSize: 13,
    fontWeight: '700',
  },
  teamMemberInfo: {
    alignItems: 'center',
  },
  teamMemberName: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
    textAlign: 'center',
    maxWidth: 80,
  },
  teamMemberStatusBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 3,
  },
  teamMemberStatusText: {
    fontSize: 9,
    fontWeight: '500',
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  addReportButton: {
    backgroundColor: '#1d1d1f',
  },
  completeButton: {
    backgroundColor: '#10B981',
  },
  waitingButton: {
    backgroundColor: '#555555',
  },
  waitingButton2: {
    backgroundColor: '#B45309',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.5,
  },
  actionButtonDisabled: {
    opacity: 0.5,
  },
  reportsSection: {
    marginTop: 20,
    paddingHorizontal: 20,
  },
  reportsSectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  sectionTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  reportCount: {
    fontSize: 13,
    fontWeight: '500',
    color: '#86868b',
  },
  reportsList: {
    gap: 12,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 10,
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    flex: 1,
  },
  reportAvatar: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#1d1d1f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  reportAvatarText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '600',
  },
  reportTicket: {
    fontSize: 11,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  reportAuthor: {
    fontSize: 12,
    color: '#86868b',
  },
  reportDate: {
    alignItems: 'flex-end',
  },
  reportDateText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  reportTimeText: {
    fontSize: 11,
    color: '#86868b',
  },
  reportDescription: {
    fontSize: 13,
    color: '#1d1d1f',
    lineHeight: 19,
    marginBottom: 10,
  },
  photoIndicator: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    marginBottom: 10,
  },
  photoIndicatorText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  reportFooter: {
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#e5e5ea',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  reportFooterLeft: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
  },
  reportActionRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 10,
  },
  viewButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#f5f5f7',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  viewButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 5,
    backgroundColor: '#f5f5f7',
    paddingVertical: 7,
    paddingHorizontal: 14,
    borderRadius: 5,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  editButtonText: {
    fontSize: 12,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  forumButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#1d1d1f',
    paddingVertical: 8,
    paddingHorizontal: 14,
    borderRadius: 5,
  },
  forumButtonText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  emptyContainer: {
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 60,
    paddingHorizontal: 40,
  },
  emptyIconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 16,
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 8,
  },
  emptyDescription: {
    fontSize: 14,
    color: '#86868b',
    textAlign: 'center',
    lineHeight: 20,
  },
  bottomSpacer: {
    height: 40,
  },
});