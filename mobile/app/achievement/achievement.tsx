import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  StatusBar,
  ScrollView,
  TouchableOpacity,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { getMyAchievement } from '@/services/achievementService';
import { IconSymbol } from '@/components/ui/icon-symbol';
// Hapus import Stack
// import { Stack } from 'expo-router';
import { useRouter } from 'expo-router'; // Tambahkan ini
import { useAppContext } from '@/context/AppContext';
import UserAvatar from '@/components/UserAvatar';

const formatDuration = (ms: number) => {
  if (!ms || ms <= 0) return '0m';

  const totalMinutes = Math.floor(ms / 60000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}j`;

  return `${hours}j ${minutes}m`;
};

const PencapaianScreen = () => {
  const { user } = useAppContext();
  const router = useRouter(); // Tambahkan ini
  const currentUserId = user?.id ?? '';
  const userName = user?.name ?? 'User';
  const [achievement, setAchievement] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadAchievement();
  }, []);

  const loadAchievement = async () => {
    try {
      const data = await getMyAchievement();
      setAchievement(data);
    } catch (error) {
      console.log(error);
    } finally {
      setLoading(false);
    }
  };

  const scoreLabel =
    achievement?.score >= 90
      ? 'EXCELLENT'
      : achievement?.score >= 75
        ? 'GOOD'
        : achievement?.score >= 50
          ? 'FAIR'
          : 'POOR';

  if (loading) {
    return (
      <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center' }}>
        <Text>Loading Achievement...</Text>
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#fff" />

      {/* Custom Header - Sama seperti task-detail */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Pencapaian</Text>
        <View style={styles.headerRight} />
      </View>

      <ScrollView showsVerticalScrollIndicator={false}>
        {/* Dark Section - Profile & Rank */}
        <View style={styles.darkSection}>
          {/* Rank Badge */}
          <View style={styles.rankBadge}>
            <Text style={styles.rankStar}>⭐</Text>
            <Text style={styles.rankText}>RANK #{achievement?.rank || '-'}</Text>
            <Text style={styles.rankStar}>⭐</Text>
          </View>

          {/* Circular Progress with Avatar */}
          <View style={styles.circleContainer}>
            <View style={styles.outerCircle}>
              <UserAvatar
                userId={currentUserId ? String(currentUserId) : ''}
                name={userName}
                size={112}
              />
            </View>
          </View>

          {/* User Info */}
          <Text style={styles.userName}>{achievement?.name || 'User'}</Text>
          <Text style={styles.userSubtitle}>Statistik kamu saat ini</Text>

          {/* Behavior Score Card */}
          <View style={styles.scoreCard}>
            <View style={styles.scoreLeft}>
              <Text style={styles.scoreNumber}>{achievement?.score ?? 0}</Text>
              <Text style={styles.scoreDenominator}>/100</Text>
            </View>
            <View
              style={{
                width: 1,
                height: 45,
                backgroundColor: '#555',
                marginHorizontal: 12,
              }}
            />
            <View style={styles.scoreRight}>
              <View style={styles.fairBadge}>
                <Text style={styles.fairText}>{scoreLabel}</Text>
              </View>
              <Text style={styles.behaviorLabel}>Behavior Score</Text>
              <View style={styles.progressBarBg}>
                <View
                  style={[
                    styles.progressBarFill,
                    { width: `${achievement?.score || 0}%` },
                  ]}
                />
              </View>
            </View>
          </View>
        </View>

        {/* White Content Section */}
        <View style={styles.whiteSection}>
          {/* Statistik Utama */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Statistik Utama</Text>
            <View style={styles.statsRow}>
              <View style={styles.statItem}>
                <View style={[styles.statIcon, { backgroundColor: '#e8f5e9' }]}>
                  <IconSymbol size={20} name="checkmark.circle.fill" color="#4caf50" />
                </View>
                <Text style={styles.statValue}>
                  {achievement?.completionRate}
                  <Text style={styles.statUnit}>%</Text>
                </Text>
                <Text style={styles.statLabel}>COMPLETION</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={[styles.statIcon, { backgroundColor: '#f5f5f5' }]}>
                  <IconSymbol size={20} name="doc.text" color="#666" />
                </View>
                <Text style={styles.statValue}>{achievement?.totalReports}</Text>
                <Text style={styles.statLabel}>LAPORAN</Text>
              </View>
              <View style={styles.statDivider} />
              <View style={styles.statItem}>
                <View style={[styles.statIcon, { backgroundColor: '#f5f5f5' }]}>
                  <IconSymbol size={20} name="location.north.fill" color="#666" />
                </View>
                <Text style={styles.statValue}>
                  {Math.round(achievement?.totalDistanceKm || 0)}
                  <Text style={styles.statUnit}>km</Text>
                </Text>
                <Text style={styles.statLabel}>TOTAL JARAK</Text>
              </View>
            </View>
          </View>

          {/* Tugas */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Tugas</Text>
            <View style={styles.tugasRow}>
              <View style={[styles.tugasBox, styles.tugasSelesai]}>
                <Text style={[styles.tugasNumber, { color: '#4caf50' }]}>
                  {achievement?.completedTasks}
                </Text>
                <Text style={[styles.tugasLabel, { color: '#4caf50' }]}>SELESAI</Text>
              </View>
              <View style={[styles.tugasBox, styles.tugasAktif]}>
                <Text style={[styles.tugasNumber, { color: '#333' }]}>
                  {achievement?.inProgressTasks}
                </Text>
                <Text style={[styles.tugasLabel, { color: '#333' }]}>AKTIF</Text>
              </View>
              <View style={[styles.tugasBox, styles.tugasPending]}>
                <Text style={[styles.tugasNumber, { color: '#ff9800' }]}>
                  {achievement?.pendingTasks}
                </Text>
                <Text style={[styles.tugasLabel, { color: '#ff9800' }]}>PENDING</Text>
              </View>
            </View>
            <View style={styles.totalTugasRow}>
              <Text style={styles.totalTugasLabel}>Total Tugas</Text>
              <Text style={styles.totalTugasValue}>{achievement?.totalTasks}</Text>
            </View>
          </View>

          {/* Rata-rata */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Rata-rata</Text>
            <View style={styles.rataRow}>
              <View style={styles.rataItem}>
                <View style={[styles.statIcon, { backgroundColor: '#f5f5f5' }]}>
                  <IconSymbol size={20} name="chart.line.uptrend.xyaxis" color="#666" />
                </View>
                <Text style={styles.rataValue}>
                  {achievement?.avgDistanceKm?.toFixed(1) || 0}
                </Text>
                <Text style={styles.rataLabel}>AVG TUGAS/JARAK</Text>
              </View>
              <View style={styles.rataDivider} />
              <View style={styles.rataItem}>
                <View style={[styles.statIcon, { backgroundColor: '#f5f5f5' }]}>
                  <IconSymbol size={20} name="clock.fill" color="#666" />
                </View>
                <Text style={styles.rataValue}>
                  {formatDuration(achievement?.avgDurationMs || 0)}
                </Text>
                <Text style={styles.rataLabel}>AVG DURASI/TUGAS</Text>
              </View>
            </View>
          </View>

          {/* Leaderboard Banner - Hanya Rank 1 */}
          {achievement?.rank === 1 && (
            <View style={styles.leaderboardBanner}>
              <View style={styles.leaderboardIcon}>
                <Text style={{ fontSize: 22 }}>🏆</Text>
              </View>

              <View style={styles.leaderboardContent}>
                <Text style={styles.leaderboardTitle}>
                  Juara #1 Leaderboard
                </Text>

                <Text style={styles.leaderboardSubtitle}>
                  Selamat! Kamu berada di posisi teratas saat ini 🎉
                </Text>
              </View>
            </View>
          )}

          <View style={{ height: 30 }} />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },

  // Custom Header Styles (copy dari task-detail)
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

  // Dark Section
  darkSection: {
    backgroundColor: '#1b1b1b',
    paddingTop: 20,
    paddingBottom: 40,
    alignItems: 'center',
  },
  rankBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#2d2d2d',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
    marginBottom: 18,
  },
  rankStar: {
    fontSize: 14,
    marginHorizontal: 4,
  },
  rankText: {
    color: '#ffd700',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
  },

  // Circle
  circleContainer: {
    marginBottom: 16,
  },
  outerCircle: {
    width: 120,
    height: 120,
    borderRadius: 60,
    borderWidth: 4,
    borderColor: '#3a3a4e',
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  progressArcTop: {
    position: 'absolute',
    top: -4,
    left: 35,
    width: 70,
    height: 8,
    backgroundColor: '#d9d9d9',
    borderRadius: 4,
  },
  progressArcLeft: {
    position: 'absolute',
    bottom: 15,
    left: -4,
    width: 8,
    height: 50,
    backgroundColor: '#d9d9d9',
    borderRadius: 4,
  },
  progressArcRight: {
    position: 'absolute',
    bottom: 15,
    right: -4,
    width: 8,
    height: 50,
    backgroundColor: '#d9d9d9',
    borderRadius: 4,
  },
  progressArcTopRight: {
    position: 'absolute',
    top: 25,
    right: 15,
    width: 8,
    height: 35,
    backgroundColor: '#d9d9d9',
    borderRadius: 4,
  },
  innerCircle: {
    width: 65,
    height: 65,
    borderRadius: 32.5,
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
  },

  userName: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  userSubtitle: {
    color: '#888',
    fontSize: 12,
    marginBottom: 14,
  },

  // Score Card
  scoreCard: {
    flexDirection: 'row',
    backgroundColor: '#2f2f2f',
    borderRadius: 14,
    padding: 14,
    width: '78%',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#444',
  },
  scoreLeft: {
    alignItems: 'center',
    marginRight: 20,
  },
  scoreNumber: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '700',
  },
  scoreDenominator: {
    color: '#888',
    fontSize: 14,
    marginTop: -4,
  },
  scoreRight: {
    flex: 1,
  },
  fairBadge: {
    backgroundColor: '#6d5220',
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 8,
    alignSelf: 'flex-start',
    marginBottom: 6,
  },
  fairText: {
    color: '#ff9800',
    fontWeight: '700',
    fontSize: 14,
    letterSpacing: 1,
  },
  behaviorLabel: {
    color: '#888',
    fontSize: 12,
    marginBottom: 6,
  },
  progressBarBg: {
    height: 4,
    backgroundColor: '#555',
    borderRadius: 2,
    overflow: 'hidden',
  },
  progressBarFill: {
    height: '100%',
    backgroundColor: '#ff9800',
    borderRadius: 3,
  },

  // White Section
  whiteSection: {
    backgroundColor: '#f5f5f5',
    flex: 1,
    paddingTop: 20,
  },
  card: {
    backgroundColor: '#fff',
    marginHorizontal: 16,
    marginBottom: 16,
    borderRadius: 16,
    padding: 20,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.05,
    shadowRadius: 8,
    elevation: 2,
  },
  cardTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 16,
  },

  // Stats Row
  statsRow: {
    flexDirection: 'row',
    justifyContent: 'space-around',
    alignItems: 'center',
  },
  statItem: {
    alignItems: 'center',
    flex: 1,
  },
  statIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 8,
  },
  statValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
  },
  statUnit: {
    fontSize: 12,
    color: '#888',
    fontWeight: '400',
  },
  statLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  statDivider: {
    width: 1,
    height: 60,
    backgroundColor: '#eee',
  },

  // Tugas
  tugasRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 16,
  },
  tugasBox: {
    flex: 1,
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    marginHorizontal: 4,
  },
  tugasSelesai: {
    backgroundColor: '#e8f5e9',
  },
  tugasAktif: {
    backgroundColor: '#f5f5f5',
  },
  tugasPending: {
    backgroundColor: '#fff8e1',
  },
  tugasNumber: {
    fontSize: 28,
    fontWeight: '700',
  },
  tugasLabel: {
    fontSize: 10,
    fontWeight: '700',
    marginTop: 4,
    letterSpacing: 0.5,
  },
  totalTugasRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
  },
  totalTugasLabel: {
    fontSize: 14,
    color: '#666',
  },
  totalTugasValue: {
    fontSize: 14,
    fontWeight: '700',
    color: '#333',
  },

  // Rata-rata
  rataRow: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  rataItem: {
    flex: 1,
    alignItems: 'center',
  },
  rataValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#333',
    marginTop: 8,
  },
  rataLabel: {
    fontSize: 10,
    color: '#888',
    fontWeight: '600',
    letterSpacing: 0.5,
    marginTop: 4,
  },
  rataDivider: {
    width: 1,
    height: 80,
    backgroundColor: '#eee',
  },

  // Leaderboard Banner
  leaderboardBanner: {
    flexDirection: 'row',
    backgroundColor: '#1a1a2e',
    marginHorizontal: 16,
    borderRadius: 16,
    padding: 16,
    alignItems: 'center',
  },
  leaderboardIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2a2a3e',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  leaderboardContent: {
    flex: 1,
  },
  leaderboardTitle: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  leaderboardSubtitle: {
    color: '#aaa',
    fontSize: 12,
  },
});

export default PencapaianScreen;