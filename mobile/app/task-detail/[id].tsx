import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { useLocalSearchParams, useRouter, Stack } from 'expo-router';
import { Ionicons } from '@expo/vector-icons';
import axios from 'axios';
// ✅ Tambahkan import AsyncStorage
import AsyncStorage from '@react-native-async-storage/async-storage';

const API_URL = 'http://10.0.2.2:8000/api';

export default function TaskDetailScreen() {
  const router = useRouter();

  const { id, taskDataString } = useLocalSearchParams();
  const [taskData, setTaskData] = useState<any>(null);

  const [isStarting, setIsStarting] = useState(false);

  useEffect(() => {
    if (taskDataString && typeof taskDataString === 'string') {
      try {
        const parsedData = JSON.parse(taskDataString);
        setTaskData(parsedData);
      } catch (error) {
        console.error("Gagal membaca data tugas yang dikirim", error);
      }
    }
  }, [taskDataString]);

  // 🔥 Fungsi dengan metode PATCH & JWT Token
  const handleStartTask = async () => {
    setIsStarting(true);
    try {
      // Bersihkan ID dari spasi tersembunyi
      const cleanId = typeof id === 'string' ? id.trim() : id[0].trim();

      // ✅ AMBIL TOKEN DINAMIS DARI STORAGE
      const token = await AsyncStorage.getItem('userToken');

      if (!token) {
        Alert.alert("Gagal", "Sesi login tidak ditemukan. Silakan login ulang.");
        setIsStarting(false);
        return;
      }

      // ✅ TEMBAK API DENGAN HEADER AUTHORIZATION
      await axios.patch(`${API_URL}/my-tasks/${cleanId}/start`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });

      Alert.alert(
        "Berhasil!",
        "Status tugas sekarang sedang Anda kerjakan.",
        [
          {
            text: "OK",
            onPress: () => {
              // Update status di layar saat ini dulu
              setTaskData((prev: any) => ({ ...prev, status: 'in_progress' }));

              // 🔥 Beri jeda sedikit agar pop-up tertutup penuh
              setTimeout(() => {
                // Kita gunakan router.push agar aman
                router.push({
                  pathname: "/task-detail",
                  // Kirim parameter id & taskId sekaligus (jaga-jaga file sebelah memintanya)
                  params: { id: cleanId, taskId: cleanId }
                } as any);
              }, 300); // Jeda 0.3 detik
            }
          }
        ]
      );

    } catch (error: any) {
      console.error("Error starting task:", error);
      const errorMsg = error.response?.data?.message || "Terjadi kesalahan saat memulai tugas.";
      Alert.alert("Gagal", errorMsg);
    } finally {
      setIsStarting(false);
    }
  };

  return (
    <View style={styles.container}>
      <Stack.Screen options={{ headerShown: false }} />

      <View style={styles.header}>
        <TouchableOpacity
          onPress={() => {
            if (router.canGoBack()) {
              router.back();
            } else {
              router.replace('/(tabs)/notification');
            }
          }}
          style={styles.backButton}
        >
          <Ionicons name="arrow-back" size={24} color="#333" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Detail Tugas</Text>
      </View>

      {taskData ? (
        <ScrollView style={styles.content}>
          <View style={[styles.statusBadge, taskData.status === 'in_progress' && styles.statusBadgeActive]}>
            <Text style={[styles.statusText, taskData.status === 'in_progress' && styles.statusTextActive]}>
              {taskData.status === 'in_progress' ? 'SEDANG DIKERJAKAN' : (taskData.status || 'BARU')}
            </Text>
          </View>

          <Text style={styles.taskTitle}>{taskData.title}</Text>
          <Text style={styles.taskId}>ID: {id}</Text>

          <View style={styles.infoBox}>
            <Text style={styles.label}>Pesan Notifikasi:</Text>
            <Text style={styles.description}>{taskData.message}</Text>
          </View>

          <View style={styles.infoBox}>
            <Text style={styles.label}>Waktu Diberikan:</Text>
            <Text style={styles.description}>
              {new Date(taskData.createdAt).toLocaleString('id-ID')}
            </Text>
          </View>

          {/* Tombol Aksi */}
          {taskData.status !== 'in_progress' && taskData.status !== 'completed' ? (
            <TouchableOpacity
              style={styles.actionButton}
              onPress={handleStartTask}
              disabled={isStarting}
            >
              {isStarting ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text style={styles.actionButtonText}>Kerjakan Tugas</Text>
              )}
            </TouchableOpacity>
          ) : (
            <TouchableOpacity
              style={[styles.actionButton, { backgroundColor: '#4CAF50' }]}
              onPress={() => alert("Fitur selesaikan tugas menyusul!")}
            >
              <Text style={styles.actionButtonText}>Selesaikan Tugas</Text>
            </TouchableOpacity>
          )}

        </ScrollView>
      ) : (
        <View style={styles.center}>
          <Text style={{ color: '#ff0000' }}>Gagal memuat data tugas.</Text>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8F9FA' },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  header: {
    flexDirection: 'row', alignItems: 'center',
    padding: 20, paddingTop: 50, backgroundColor: '#fff',
    borderBottomWidth: 1, borderBottomColor: '#E0E0E0',
  },
  backButton: { marginRight: 15 },
  headerTitle: { fontSize: 18, fontWeight: 'bold', color: '#333' },
  content: { padding: 20 },
  statusBadge: {
    backgroundColor: '#E8F5E9', alignSelf: 'flex-start',
    paddingHorizontal: 10, paddingVertical: 5, borderRadius: 15, marginBottom: 10
  },
  statusText: { color: '#4CAF50', fontWeight: 'bold', fontSize: 12 },
  statusBadgeActive: { backgroundColor: '#FFF3E0' },
  statusTextActive: { color: '#FF9800' },
  taskTitle: { fontSize: 22, fontWeight: 'bold', color: '#333', marginBottom: 5 },
  taskId: { fontSize: 12, color: '#999', marginBottom: 20 },
  infoBox: {
    backgroundColor: '#fff', padding: 15, borderRadius: 10,
    borderWidth: 1, borderColor: '#eee', marginBottom: 15
  },
  label: { fontSize: 14, fontWeight: 'bold', color: '#555', marginBottom: 5 },
  description: { fontSize: 15, color: '#444', lineHeight: 22 },
  actionButton: {
    backgroundColor: '#FF5722', padding: 15, borderRadius: 10,
    alignItems: 'center', marginTop: 10
  },
  actionButtonText: { color: 'white', fontWeight: 'bold', fontSize: 16 }
});