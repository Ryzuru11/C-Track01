import React, { useEffect, useState } from 'react';
import { Tabs, useRouter } from 'expo-router';
import { Platform, View, DeviceEventEmitter } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from '@/components/ui/icon-symbol';
import * as Notifications from 'expo-notifications';
import { isRunningInExpoGo } from 'expo';
import api from '@/services/api';

// =========================================================
// 🔥 1. MESIN PEMAKSA NOTIFIKASI FOREGROUND 
// =========================================================
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,  // Menampilkan banner pop-up walau aplikasi sedang dibuka
    shouldPlaySound: true,  // Mengaktifkan suara/getaran notifikasi
    shouldSetBadge: true,   // Memperbarui angka merah pada ikon aplikasi
  } as Notifications.NotificationBehavior), // 👈 Tambahkan Type Assertion ini agar TS aman
});

export default function TabLayout() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const [hasUnread, setHasUnread] = useState(false);

  useEffect(() => {
    // =========================================================
    // 🤖 INVESTIGASI: CEK IZIN & TOKEN TERKINI EMULATOR
    // =========================================================
    async function configureAndroidChannel() {
      // 1. Minta Izin Resmi ke Sistem Operasi Android
      const { status: existingStatus } = await Notifications.getPermissionsAsync();
      let finalStatus = existingStatus;
      if (existingStatus !== 'granted') {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      console.log('🔔 [C-TRACK DEBUG] STATUS IZIN NOTIFIKASI OS:', finalStatus);

      // 2. Ambil Token Asli yang Sedang Aktif di Emulator Detik Ini
      try {
        if (!isRunningInExpoGo()) {
          const tokenData = await Notifications.getExpoPushTokenAsync();
          console.log('🎫 [C-TRACK DEBUG] TOKEN ASLI EMULATOR SAAT INI:', tokenData.data);
        }
      } catch (err) {
        console.log('❌ [C-TRACK DEBUG] Gagal mengambil token terkini:', err);
      }
// 3. Daftarkan Kanal Prioritas Tinggi Android
      if (Platform.OS === 'android') {
        // Kanal 1: Untuk Notifikasi Default (seperti Chat/Komentar)
        await Notifications.setNotificationChannelAsync('default', {
          name: 'Notifikasi Umum',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7A',
          sound: 'default', // 👈 🔥 INI KUNCI UTAMA YANG HILANG SEBELUMNYA
        });

        // Kanal 2: Untuk Notifikasi Tugas (Sesuai dengan payload backend kamu)
        await Notifications.setNotificationChannelAsync('task-notifications', {
          name: 'Notifikasi Tugas',
          importance: Notifications.AndroidImportance.MAX,
          vibrationPattern: [0, 250, 250, 250],
          lightColor: '#FF231F7A',
          sound: 'default', // 👈 🔥 WAJIB ADA AGAR BUNYI
        });
      }
    }
    configureAndroidChannel();
    // =========================================================
    // 📡 2. MESIN PENANGKAP KLIK NOTIFIKASI (DEEP LINKING)
    // =========================================================
    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data;
      
      console.log('📱 Notifikasi diklik! Data payload:', data);

      // Cek Notifikasi Tugas Baru (NEW_TASK)
      if (data && data.type === 'NEW_TASK' && data.takenTaskId) {
        console.log(`🚀 Mengarahkan user langsung ke detail tugas: ${data.takenTaskId}`);
        router.push(`/task-detail?taskId=${data.takenTaskId}`);
      } 
      // Cek Notifikasi Chat/Komentar Baru (NEW_COMMENT)
      else if (data && data.category === 'NEW_COMMENT' && data.relatedId) {
        console.log(`🚀 Mengarahkan user langsung ke halaman chat: ${data.relatedId}`);
        router.push(`/forum/${data.relatedId}`);
      }
    });

    const foregroundSub = Notifications.addNotificationReceivedListener(notification => {
      setHasUnread(true);
    });

    const fetchUnreadStatus = async () => {
      try {
        const response = await api.get('/notifications');
        const unread = response.data.some((n: any) => !n.isRead);
        setHasUnread(unread);
      } catch (err) {
        // ignore
      }
    };
    fetchUnreadStatus();
    const interval = setInterval(fetchUnreadStatus, 10000);

    const eventSub = DeviceEventEmitter.addListener('notificationsRead', fetchUnreadStatus);

    return () => {
      subscription.remove();
      foregroundSub.remove();
      clearInterval(interval);
      eventSub.remove();
    };
  }, []);
  // =========================================================

  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: '#000000',
        tabBarInactiveTintColor: '#86868b',
        headerShown: false,
        tabBarStyle: {
          backgroundColor: '#FFFFFF',
          borderTopWidth: 1,
          borderTopColor: '#e5e5ea',
          height: Platform.OS === 'ios' ? 88 : 60 + insets.bottom,
          paddingBottom: Platform.OS === 'ios' ? insets.bottom || 28 : insets.bottom || 8,
          paddingTop: 8,
          elevation: 0,
        },
        tabBarLabelStyle: {
          fontSize: 11,
          fontWeight: '500',
          letterSpacing: 0.3,
        },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{
          title: 'Beranda',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={22} name={focused ? 'house.fill' : 'house'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="laporan"
        options={{
          title: 'Laporan',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={22} name={focused ? 'doc.text.fill' : 'doc.text'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="map"
        options={{
          title: 'Peta',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={22} name={focused ? 'map.fill' : 'map'} color={color} />
          ),
        }}
      />
      <Tabs.Screen
        name="notification"
        options={{
          title: 'Notifikasi',
          tabBarIcon: ({ color, focused }) => (
            <View>
              <IconSymbol size={22} name={focused ? 'bell.fill' : 'bell'} color={color} />
              {hasUnread && (
                <View
                  style={{
                    position: 'absolute',
                    top: -2,
                    right: -2,
                    width: 8,
                    height: 8,
                    borderRadius: 4,
                    backgroundColor: '#22C55E',
                  }}
                />
              )}
            </View>
          ),
        }}
      />
      <Tabs.Screen
        name="profile"
        options={{
          title: 'Profil',
          tabBarIcon: ({ color, focused }) => (
            <IconSymbol size={22} name={focused ? 'person.fill' : 'person'} color={color} />
          ),
        }}
      />
    </Tabs>
  );
}