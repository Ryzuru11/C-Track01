import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, ActivityIndicator, Alert } from 'react-native';
import { Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import axios from 'axios';
import { useRouter } from 'expo-router';
// 🔥 Tambahkan import AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage'; 

// 🔥 Gunakan IP 10.0.2.2 untuk emulator atau IP laptopmu untuk HP asli
const API_URL = 'http://10.0.2.2:8000/api';

export default function NotificationScreen() {
  const [notifications, setNotifications] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('TASK'); 
  const router = useRouter();

  const fetchNotifications = async () => {
    try {
      // ✅ AMBIL TOKEN SECARA DINAMIS DARI STORAGE
      // (Catatan: Pastikan nama key 'userToken' ini sama dengan yang kamu pakai saat nyimpen di proses Login)
      const token = await AsyncStorage.getItem('userToken'); 
      
      if (!token) {
        console.warn("Token tidak ditemukan, user mungkin belum login.");
        setLoading(false);
        return;
      }
      
      const response = await axios.get(`${API_URL}/notifications`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setNotifications(response.data);
    } catch (error: any) {
      console.error('Error fetching notifications:', error);
      if (error.response?.status === 401) {
        Alert.alert("Sesi Berakhir", "Sesi login Anda telah habis, silakan login kembali.");
        // Opsional: router.replace('/login');
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchNotifications();
  }, []);

  const handleTabPress = async (category: string) => {
    setActiveTab(category);

    const unreadInThisCategory = notifications.filter(n => n.category === category && !n.isRead);

    if (unreadInThisCategory.length > 0) {
      try {
        // ✅ AMBIL TOKEN SECARA DINAMIS JUGA DI SINI
        const token = await AsyncStorage.getItem('userToken'); 
        
        await axios.put(`${API_URL}/notifications/read-all/${category}`, {}, {
          headers: { Authorization: `Bearer ${token}` }
        });

        setNotifications(prevNotifs => 
          prevNotifs.map(n => n.category === category ? { ...n, isRead: true } : n)
        );
      } catch (error) {
        console.warn('Gagal update status baca di server, tapi tetap update tampilan lokal.');
        setNotifications(prevNotifs => 
          prevNotifs.map(n => n.category === category ? { ...n, isRead: true } : n)
        );
      }
    }
  };

  const getUnreadCount = (category: string) => {
    return notifications.filter((notif) => notif.category === category && !notif.isRead).length;
  };

  const filteredNotifications = notifications.filter(notif => notif.category === activeTab);

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator size="large" color="#FF5722" />
      </View>
    );
  }

  const CategoryItem = ({ icon, color, title, subtitle, unreadCount, category }: any) => (
    <TouchableOpacity 
      style={[styles.categoryItem, activeTab === category && styles.activeCategory]} 
      onPress={() => handleTabPress(category)} 
    >
      <View style={[styles.iconContainer, { backgroundColor: color }]}>
        <MaterialCommunityIcons name={icon} size={24} color="#fff" />
      </View>
      <View style={styles.textContainer}>
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.subtitle} numberOfLines={1}>{subtitle}</Text>
      </View>
      <View style={styles.rightContainer}>
        {unreadCount > 0 && (
          <View style={styles.badge}>
            <Text style={styles.badgeText}>{unreadCount}</Text>
          </View>
        )}
        <Ionicons name="chevron-forward" size={20} color={activeTab === category ? "#FF5722" : "#ccc"} />
      </View>
    </TouchableOpacity>
  );

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Notifikasi</Text>
        <Ionicons name="settings-outline" size={24} color="#FF5722" />
      </View>

      <CategoryItem 
        icon="clipboard-text" color="#FF9800" title="Info Tugas" 
        subtitle="Cek tugas harianmu di sini" unreadCount={getUnreadCount('TASK')} category="TASK"
      />
      <CategoryItem 
        icon="message-text" color="#4CAF50" title="Info Pesan" 
        subtitle="Pesan dari admin atau rekan kerja" unreadCount={getUnreadCount('CHAT')} category="CHAT"
      />
      <CategoryItem 
        icon="trophy" color="#F44336" title="Info Pencapaian" 
        subtitle="Prestasi kerja kamu bulan ini" unreadCount={getUnreadCount('ACHIEVEMENT')} category="ACHIEVEMENT"
      />

      <View style={styles.divider} />

      <ScrollView style={styles.listArea}>
        <Text style={styles.listHeader}>Pemberitahuan Terbaru</Text>
        
        {filteredNotifications.length > 0 ? (
          filteredNotifications.map((item) => (
            <TouchableOpacity 
              key={item.id} 
              style={styles.notificationCard}
              onPress={() => {
                if (item.category === 'TASK') {
                  const targetId = item.relatedId || item.id;
                  // 🔥 KIRIM DATA UTUH KE HALAMAN DETAIL MENGGUNAKAN JSON.STRINGIFY
                  router.push({
                    pathname: "/task-detail/[id]",
                    params: { 
                      id: targetId,
                      taskDataString: JSON.stringify(item) 
                    }
                  } as any);
                }
              }}
            >
              {!item.isRead && <View style={styles.unreadDot} />}
              <View style={[styles.cardContent, item.isRead && { marginLeft: 18 }]}>
                <Text style={[styles.notifTitle, item.isRead && { color: '#888' }]}>{item.title}</Text>
                <Text style={styles.notifMessage}>{item.message}</Text>
                <Text style={styles.notifTime}>Klik untuk lihat detail</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color="#DDD" />
            </TouchableOpacity>
          ))
        ) : (
          <View style={styles.emptyContainer}>
            <Ionicons name="notifications-off-outline" size={64} color="#ddd" />
            <Text style={styles.emptyText}>Tidak ada {activeTab.toLowerCase()} baru</Text>
          </View>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    backgroundColor: '#fff', padding: 15, borderBottomWidth: 1, borderBottomColor: '#eee'
  },
  headerTitle: { fontSize: 20, fontWeight: 'bold' },
  categoryItem: {
    flexDirection: 'row', backgroundColor: '#fff', padding: 15, 
    alignItems: 'center', borderBottomWidth: 1, borderBottomColor: '#eee'
  },
  activeCategory: { backgroundColor: '#FFF5F2' },
  iconContainer: {
    width: 40, height: 40, borderRadius: 20, 
    justifyContent: 'center', alignItems: 'center', marginRight: 15
  },
  textContainer: { flex: 1 },
  title: { fontSize: 16, fontWeight: 'bold', marginBottom: 2 },
  subtitle: { fontSize: 13, color: '#777' },
  rightContainer: { flexDirection: 'row', alignItems: 'center' },
  badge: {
    backgroundColor: '#FF5722', borderRadius: 10, minWidth: 20, height: 20,
    justifyContent: 'center', alignItems: 'center', marginRight: 10, paddingHorizontal: 5
  },
  badgeText: { color: '#fff', fontSize: 10, fontWeight: 'bold' },
  divider: { height: 10, backgroundColor: '#f5f5f5' },
  listArea: { flex: 1, backgroundColor: '#fff' },
  listHeader: { padding: 15, fontSize: 14, fontWeight: 'bold', color: '#666', borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  notificationCard: { 
    flexDirection: 'row', padding: 15, borderBottomWidth: 1, borderBottomColor: '#f0f0f0', backgroundColor: '#fff',
    alignItems: 'center' 
  },
  unreadDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#FF5722', marginRight: 10 }, 
  cardContent: { flex: 1 },
  notifTitle: { fontSize: 14, fontWeight: 'bold', color: '#333' },
  notifMessage: { fontSize: 13, color: '#666', marginTop: 4 },
  notifTime: { fontSize: 11, color: '#FF9800', marginTop: 8, fontWeight: '500' }, 
  emptyContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', paddingTop: 50 },
  emptyText: { marginTop: 10, color: '#999' }
});