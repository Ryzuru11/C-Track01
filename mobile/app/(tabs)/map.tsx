import React, { useState, useCallback } from 'react';
import { useGpsGuard } from '@/hooks/useGpsGuard';
import { View, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useFocusEffect } from 'expo-router';
import { useAppContext } from '@/context/AppContext';
import { IconSymbol } from '@/components/ui/icon-symbol';
import TrackingMap from '@/components/TrackingMap';
import { tasksAPI } from '@/services/api';

interface ActiveTaskInfo {
  destinationLatitude: number;
  destinationLongitude: number;
  destinationLabel: string;
  ticketNumber: string;
}

export default function MapScreen() {
  useGpsGuard();

  const { user } = useAppContext();
  const currentUserId = user?.id ?? null;
  const userAvatar    = user?.avatar ?? null;

  const [isLoading, setIsLoading] = useState(true);
  const [activeTask, setActiveTask] = useState<ActiveTaskInfo | null>(null);

  useFocusEffect(
    useCallback(() => {
      let isMounted = true;

      const load = async () => {
        setIsLoading(true);
        try {
          const userId = currentUserId;

          const response = await tasksAPI.getMyTasks();
          const tasks: any[] = (response as any).tasks || [];

          const found = tasks.find((t: any) => {
            const status =
              userId && t.userStatuses?.[userId]
                ? t.userStatuses[userId]
                : t.status;
            return status === 'in_progress';
          });

          if (isMounted) {
            if (found && found.task?.latitude && found.task?.longitude) {
              const next: ActiveTaskInfo = {
                destinationLatitude: parseFloat(found.task.latitude),
                destinationLongitude: parseFloat(found.task.longitude),
                destinationLabel: found.task.location || found.task.title || 'Lokasi Tugas',
                ticketNumber: found.ticketNumber || found.takenTaskId?.substring(0, 8) || '',
              };
              setActiveTask(prev =>
                prev &&
                prev.destinationLatitude === next.destinationLatitude &&
                prev.destinationLongitude === next.destinationLongitude &&
                prev.destinationLabel === next.destinationLabel &&
                prev.ticketNumber === next.ticketNumber
                  ? prev
                  : next
              );
            } else {
              setActiveTask(null);
            }
          }
        } catch (e) {
          console.error('MapScreen: failed to load active task', e);
          if (isMounted) setActiveTask(null);
        } finally {
          if (isMounted) setIsLoading(false);
        }
      };

      load();
      return () => { isMounted = false; };
    }, [])
  );

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      {/* Header */}
      <View style={styles.header}>
        <Text style={styles.headerTitle}>Peta Tracking</Text>
        {activeTask && (
          <Text style={styles.headerSubtitle}>#{activeTask.ticketNumber}</Text>
        )}
      </View>

      {isLoading ? (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#000000" />
          <Text style={styles.loadingText}>Memuat peta…</Text>
        </View>
      ) : activeTask ? (
        <View style={styles.mapWrapper}>
          <TrackingMap
            destinationLatitude={activeTask.destinationLatitude}
            destinationLongitude={activeTask.destinationLongitude}
            destinationLabel={activeTask.destinationLabel}
            driverLabel="Posisi Anda"
            userAvatar={userAvatar}
            containerStyle={styles.trackingMapContainer}
            mapWrapperStyle={styles.trackingMapWrapper}
          />
        </View>
      ) : (
        <View style={styles.center}>
          <IconSymbol name="map" size={56} color="#86868b" />
          <Text style={styles.emptyTitle}>Tidak Ada Tugas Aktif</Text>
          <Text style={styles.emptySubtitle}>
            Peta akan tampil saat ada tugas yang sedang berjalan.
          </Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#FFFFFF',
  },
  header: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1C1C1E',
  },
  headerSubtitle: {
    fontSize: 13,
    color: '#86868b',
    fontWeight: '500',
  },
  mapWrapper: {
    flex: 1,
  },
  trackingMapContainer: {
    flex: 1,
    borderRadius: 0,
  },
  trackingMapWrapper: {
    flex: 1,
    height: undefined,
    borderRadius: 0,
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 12,
  },
  loadingText: {
    marginTop: 12,
    fontSize: 14,
    color: '#86868b',
  },
  emptyTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1C1C1E',
    textAlign: 'center',
  },
  emptySubtitle: {
    fontSize: 14,
    color: '#86868b',
    textAlign: 'center',
    lineHeight: 20,
  },
});
