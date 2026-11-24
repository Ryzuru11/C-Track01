import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Image,
  DeviceEventEmitter,
  TouchableOpacity,
  ScrollView
} from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { useRouter, useFocusEffect } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';
import { showDialog } from '@/utils/alert';
import * as Notifications from 'expo-notifications';

// 🔥 Menggunakan instance api sentral yang memiliki interceptor token otomatis
import api from '@/services/api'; // <-- Sesuaikan path file jika letak folder services berbeda

const cTrackLogo = require('@/assets/images/C-Track.png');

export default function NotificationScreen() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string | null>(null);
  const router = useRouter();

  // Fungsi untuk mengambil data notifikasi dari server
  const fetchNotifications = async () => {
    try {
      const response = await api.get('/notifications');
      setNotifications(response.data);
    } catch (error: any) {
      console.error('Error fetching notifications:', error.response?.data || error.message);
    } finally {
      setLoading(false);
    }
  };

  // Reload data dan reset filter setiap kali halaman difokus
  useFocusEffect(
    useCallback(() => {
      setActiveTab(null); // Reset filter kategori ke "Semua"
      fetchNotifications();
    }, [])
  );

  // Fungsi saat kategori tab ditekan — toggle filter on/off
  const handleTabPress = (category: string) => {
    // Jika kategori yang sama diklik lagi, matikan filter (tampilkan semua)
    if (activeTab === category) {
      setActiveTab(null);
    } else {
      setActiveTab(category);
    }
  };

  const getUnreadCount = (category: string) => {
    return notifications.filter((notif) => notif.category === category && !notif.isRead).length;
  };

  const handleOptionsPress = () => {
    showDialog('Hapus Riwayat Pemberitahuan', 'Apakah anda yakin ingin menghapus semua Riwayat pemberitahuan?', [
      { text: 'Batal', style: 'cancel' },
      {
        text: 'Hapus',
        style: 'destructive',
        onPress: async () => {
          try {
            // Hapus record notifikasi dari database backend
            await api.delete('/notifications/all');
            setNotifications([]);
            DeviceEventEmitter.emit('notificationsRead');
          } catch (error) {
            console.warn('Gagal menghapus semua notifikasi di server:', error);
            // Hapus dari state lokal saja jika server gagal
            setNotifications([]);
            DeviceEventEmitter.emit('notificationsRead');
          } finally {
            // ✅ FIX ANDROID 13: Hapus notifikasi dari system tray secara eksplisit.
            // Ini HARUS dilakukan terpisah dari delete DB.
            // Memanggil ini TIDAK mereset permission atau channel Android —
            // hanya membersihkan notifikasi yang sudah tampil di notification shade.
            // Tanpa ini, di Android 13 ada edge case dimana sistem salah
            // menginterpretasikan bahwa channel sudah di-dismiss oleh user
            // dan menunda/memblokir notifikasi baru berikutnya.
            try {
              await Notifications.dismissAllNotificationsAsync();
            } catch (dismissError) {
              // Non-critical: abaikan jika gagal
              console.warn('dismissAllNotifications minor error:', dismissError);
            }
          }
        },
      },
    ]);
  };

  const filteredNotifications = activeTab
    ? notifications.filter(notif => notif.category === activeTab)
    : notifications;

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#1d1d1dff" />
      </View>
    );
  }

  const CategoryItem = ({
    icon,
    title,
    subtitle,
    unreadCount,
    category,
  }: any) => {
    const isActive = activeTab === category;

    return (
      <TouchableOpacity
        style={[
          styles.categoryItem,
          isActive && styles.activeCategory,
        ]}
        onPress={() => handleTabPress(category)}
      >
        <View style={[
          styles.iconContainer,
          isActive && styles.activeIconContainer,
        ]}>
          <MaterialCommunityIcons
            name={icon}
            size={22}
            color={isActive ? '#111111' : '#fff'}
          />
        </View>

        <View style={styles.textContainer}>
          <Text
            style={[
              styles.title,
              isActive && styles.activeTitle,
            ]}
          >
            {title}
          </Text>

          <Text
            style={[
              styles.subtitle,
              isActive && styles.activeSubtitle,
            ]}
            numberOfLines={1}
          >
            {subtitle}
          </Text>
        </View>

        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>
              {unreadCount}
            </Text>
          </View>
        )}
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView
      style={styles.container}
      edges={['top', 'left', 'right']}
    >
      {/* Header */}
      <View style={styles.header}>
        <View>
          <Text style={styles.headerTitle}>Notifikasi</Text>
        </View>

        <TouchableOpacity style={styles.logoButton}>
          <Image
            source={cTrackLogo}
            style={styles.headerIcon}
          />
        </TouchableOpacity>
      </View>

      {/* Category */}
      <View style={styles.categoryList}>
        <CategoryItem
          icon="trophy-outline"
          title="Pencapaian"
          subtitle="Cek pencapaian yang sudah kamu raih"
          unreadCount={getUnreadCount('ACHIEVEMENT')}
          category="ACHIEVEMENT"
        />
        <CategoryItem
          icon="clipboard-text-outline"
          title="Tugas"
          subtitle="Lihat tugas yang harus di selesaikan"
          unreadCount={getUnreadCount('TASK')}
          category="TASK"
        />
        <CategoryItem
          icon="message-outline"
          title="Pesan"
          subtitle="Lihat pesan terbaru dari rekan kerja"
          unreadCount={getUnreadCount('NEW_COMMENT')}
          category="NEW_COMMENT"
        />
      </View>

      <View style={styles.divider} />

      {/* Sticky List Header */}
      <View style={styles.listHeaderContainer}>
        <Text style={styles.listHeaderTitle}>
          Pemberitahuan Terbaru
        </Text>
        <TouchableOpacity onPress={handleOptionsPress}>
          <Ionicons name="ellipsis-vertical" size={20} color="#666" />
        </TouchableOpacity>
      </View>

      {/* Notification List */}
      <ScrollView style={styles.listArea}>

        {filteredNotifications.length > 0 ? (
          filteredNotifications.map((item) => (
            <TouchableOpacity
              key={item.id}
              style={styles.notificationCard}
              onPress={async () => {
                // 1. Update status baca di server
                try {
                  await api.patch(`/notifications/${item.id}/read`);
                  DeviceEventEmitter.emit('notificationsRead');
                } catch (error: any) {
                  console.warn('Gagal update status baca di server:', error.message);
                }

                // 2. Update status baca di state lokal agar badge berkurang
                setNotifications((prevNotifs) =>
                  prevNotifs.map((n) => (n.id === item.id ? { ...n, isRead: true } : n))
                );

                // 3. Navigasi ke halaman detail sesuai kategori
                // TASK
                if (item.category === 'TASK') {
                  const targetId = item.relatedId || item.id;
                  router.push(`/task-detail?taskId=${targetId}`);
                  return;
                }

                // ACHIEVEMENT
                if (item.category === 'ACHIEVEMENT') {
                  router.push('/achievement/achievement');
                  return;
                }

                // NEW_COMMENT / CHAT
                if (item.category === 'NEW_COMMENT' || item.category === 'CHAT') {
                  const reportId = item.relatedId || item.id;
                  router.push(`/forum/${reportId}`);
                  return;
                }
              }}
            >
              {!item.isRead && (
                <View style={styles.unreadDot} />
              )}

              <View
                style={styles.cardContent}
              >
                <Text
                  style={[
                    styles.notifTitle,
                    item.isRead && { color: '#888' },
                  ]}
                >
                  {item.title
                    ? item.title
                      .replace(/[]/g, '')
                      .replace(/[]/g, '')
                      .trim()
                    : ''}
                </Text>

                <Text style={styles.notifMessage}>
                  {item.message}
                </Text>

                <Text style={styles.notifTime}>
                  Klik untuk lihat detail
                </Text>
              </View>

              <Ionicons
                name="chevron-forward"
                size={16}
                color="#DDD"
              />
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons
              name="notifications-off-outline"
              size={64}
              color="#ddd"
            />

            <Text style={styles.emptyText}>
              Tidak ada notifikasi baru
            </Text>
          </View>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F5F5'
  },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
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
  categoryList: {
    paddingHorizontal: 16,
    paddingTop: 12,
    gap: 8,
  },
  categoryItem: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    paddingVertical: 14,
    paddingHorizontal: 12,
    borderRadius: 15,
  },
  activeCategory: { backgroundColor: '#111111' },
  iconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  activeIconContainer: {
    backgroundColor: '#FFFFFF',
  },
  textContainer: { flex: 1 },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#111111',
  },
  activeTitle: { color: '#FFFFFF' },
  subtitle: {
    fontSize: 12,
    color: '#8E8E93',
    marginTop: 3,
  },
  activeSubtitle: {
    color: '#D1D1D6',
  },
  badge: {
    backgroundColor: '#22C55E',
    width: 24,
    height: 24,
    borderRadius: 12,
    justifyContent: 'center',
    alignItems: 'center',
  },
  badgeText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  divider: { height: 10, backgroundColor: '#f5f5f5' },
  listArea: { flex: 1, backgroundColor: '#fff' },
  listHeaderContainer: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 15, paddingVertical: 12, backgroundColor: '#fff', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  listHeaderTitle: { fontSize: 16, fontWeight: 'bold', color: '#1f1f1fff' },
  notificationCard: {
    flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fff',
    alignItems: 'center'
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#22C55E', marginRight: 10 },
  cardContent: { flex: 1 },
  notifTitle: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  notifMessage: { fontSize: 13, color: '#666', marginTop: 4 },
  notifTime: { fontSize: 11, color: '#22C55E', marginTop: 8, fontWeight: '500' },
  cardIconContainer: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#111111',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
  emptyText: { marginTop: 10, color: '#999' }
});