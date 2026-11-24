import React, { useState, useEffect, useRef } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Image, TextInput, Modal, ActivityIndicator, FlatList, Dimensions, StatusBar, Keyboard, TouchableWithoutFeedback, Animated, Platform } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import * as ImagePicker from 'expo-image-picker';
import * as Location from 'expo-location';
import * as FileSystem from 'expo-file-system/legacy';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { CapturedReportPhoto, reportsAPI, tasksAPI } from '@/services/api';
import { API_BASE_URL } from '@/config/api.config';
import { showToast, showDialog } from '@/utils/alert';

interface LocationPoint {
  id: string;
  time: string;
  location: string;
  coordinates: string;
  notes?: string;
}

interface Photo {
  id: string;
  uri: string;
  name: string;
  capture?: Omit<CapturedReportPhoto, 'image'>;
}

const { width: SCREEN_WIDTH } = Dimensions.get("window");
const MAX_REPORT_PHOTOS = 3;
const MAX_TASK_DISTANCE_METERS = 100;

function distanceInMeters(
  latitude: number,
  longitude: number,
  targetLatitude: number,
  targetLongitude: number,
): number {
  const earthRadiusMeters = 6_371_000;
  const latitudeDelta = ((targetLatitude - latitude) * Math.PI) / 180;
  const longitudeDelta = ((targetLongitude - longitude) * Math.PI) / 180;
  const latitudeFrom = (latitude * Math.PI) / 180;
  const latitudeTo = (targetLatitude * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeFrom) * Math.cos(latitudeTo) * Math.sin(longitudeDelta / 2) ** 2;

  return earthRadiusMeters * 2 * Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine));
}

function attachPhotoImage(photo: Photo, image: string): CapturedReportPhoto {
  if (!photo.capture) {
    throw new Error('Foto lama tanpa verifikasi GPS harus dihapus dan diambil ulang dari kamera.');
  }

  return { ...photo.capture, image };
}

// ── Fullscreen Image Viewer ────────────────────────────────────
const ImageViewerModal = ({ images, initialIndex, visible, onClose }: {
  images: string[];
  initialIndex: number;
  visible: boolean;
  onClose: () => void;
}) => {
  const [currentIdx, setCurrentIdx] = useState(initialIndex);

  useEffect(() => { setCurrentIdx(initialIndex); }, [initialIndex]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <StatusBar hidden />
      <View style={ivStyles.overlay}>
        <TouchableOpacity style={ivStyles.closeBtn} onPress={onClose}>
          <Text style={ivStyles.closeText}>✕</Text>
        </TouchableOpacity>
        <Text style={ivStyles.counter}>{currentIdx + 1} / {images.length}</Text>
        <FlatList
          data={images}
          horizontal
          pagingEnabled
          initialScrollIndex={initialIndex}
          getItemLayout={(_, index) => ({ length: SCREEN_WIDTH, offset: SCREEN_WIDTH * index, index })}
          keyExtractor={(_, i) => String(i)}
          onMomentumScrollEnd={(e) => {
            const idx = Math.round(e.nativeEvent.contentOffset.x / SCREEN_WIDTH);
            setCurrentIdx(idx);
          }}
          renderItem={({ item }) => (
            <View style={{ width: SCREEN_WIDTH, height: "100%", justifyContent: "center", alignItems: "center" }}>
              <Image
                source={{ uri: item }}
                style={{ width: "100%", height: "100%" }}
                resizeMode="contain"
              />
            </View>
          )}
          showsHorizontalScrollIndicator={false}
        />
      </View>
    </Modal>
  );
};

const ivStyles = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" },
  closeBtn: { position: "absolute", top: 48, right: 20, zIndex: 10, backgroundColor: "rgba(255,255,255,0.15)", borderRadius: 20, width: 36, height: 36, alignItems: "center", justifyContent: "center" },
  closeText: { color: "#fff", fontSize: 18, fontWeight: "700" },
  counter: { position: "absolute", top: 56, alignSelf: "center", color: "#fff", fontSize: 14, zIndex: 10, backgroundColor: "rgba(0,0,0,0.4)", paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
});

export default function ReportDetailScreen() {
  const router = useRouter();
  const params = useLocalSearchParams();
  const scrollViewRef = useRef<ScrollView>(null);

  // Keyboard offset animation
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  // Parse task data if passed from task detail
  let taskData = null;
  if (params.taskData && typeof params.taskData === 'string') {
    try {
      taskData = JSON.parse(decodeURIComponent(params.taskData));
    } catch (error) {
      console.error('Error parsing task data:', error);
    }
  }

  // State management
  const isNewReport = params.reportId === 'new';
  const startInEditMode = params.editMode === 'true';
  const [isEditingDescription, setIsEditingDescription] = useState(isNewReport || startInEditMode);
  const [isEditingReport, setIsEditingReport] = useState(startInEditMode); // Track if in edit mode for existing report
  const [reportDescription, setReportDescription] = useState(
    isNewReport
      ? ''
      : 'Inspeksi rutin gedung sudah selesai. Tidak ada temuan masalah. Semua sistem berjalan normal dan tidak terlihat kerusakan struktural maupun sistem elektrikal.'
  );
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [removedPhotos, setRemovedPhotos] = useState<string[]>([]); // Track photos removed during edit
  const [showPhotoOptions, setShowPhotoOptions] = useState(false);
  const [hasDraft, setHasDraft] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [teamMembers, setTeamMembers] = useState<any[]>([]);
  const [isLoadingTeam, setIsLoadingTeam] = useState(false);
  const [isLoadingReport, setIsLoadingReport] = useState(false);
  const [reportData, setReportData] = useState<any>(null);
  const [isReadOnly, setIsReadOnly] = useState(false);
  const [loadingPhotos, setLoadingPhotos] = useState<Record<string, boolean>>({});
  const [viewerImages, setViewerImages] = useState<string[]>([]);
  const [viewerIndex, setViewerIndex] = useState(0);
  const [viewerVisible, setViewerVisible] = useState(false);

  const openViewer = (images: string[], index: number) => {
    setViewerImages(images);
    setViewerIndex(index);
    setViewerVisible(true);
  };

  // ── Keyboard handling ──────────────────────────────────────
  useEffect(() => {
    const showEvent = Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow';
    const hideEvent = Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide';

    const showSub = Keyboard.addListener(showEvent, (e) => {
      Animated.timing(keyboardOffset, {
        toValue: e.endCoordinates.height,
        duration: Platform.OS === 'ios' ? e.duration : 220,
        useNativeDriver: false,
      }).start();
    });

    const hideSub = Keyboard.addListener(hideEvent, (e) => {
      scrollViewRef.current?.scrollTo({ y: 0, animated: true });
      Animated.timing(keyboardOffset, {
        toValue: 0,
        duration: Platform.OS === 'ios' ? e.duration : 220,
        useNativeDriver: false,
      }).start();
    });

    return () => {
      showSub.remove();
      hideSub.remove();
    };
  }, []);

  // Handle focus untuk scroll ke input
  const handleInputFocus = (offsetY: number = 0) => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: offsetY,
        animated: true,
      });
    }, 300);
  };

  // Load draft on mount for new reports
  useEffect(() => {
    if (isNewReport && taskData?.taskId) {
      loadDraft();
    } else if (!isNewReport && params.reportId) {
      // Load existing report from API (includes team members)
      loadReportDetails();
    }
  }, [params.reportId]);

  // Load team members for NEW reports only (from taken task)
  useEffect(() => {
    if (isNewReport && params.takenTaskId && typeof params.takenTaskId === 'string') {
      loadTeamMembers();
    }
  }, [params.takenTaskId, isNewReport]);

  const loadDraft = async () => {
    try {
      const draftKey = `report_draft_${taskData?.taskId}`;
      const draftJson = await AsyncStorage.getItem(draftKey);

      if (draftJson) {
        const draft = JSON.parse(draftJson);
        setReportDescription(draft.description || '');
        setPhotos(draft.photos || []);
        setHasDraft(true);
        console.log('Draft loaded successfully');
      }
    } catch (error) {
      console.error('Error loading draft:', error);
    }
  };

  const loadReportDetails = async () => {
    try {
      setIsLoadingReport(true);
      const reportId = params.reportId as string;
      console.log('=== Loading Report Details ===');
      console.log('Report ID:', reportId);

      const response = await reportsAPI.getReportDetails(reportId);
      console.log('=== API Response ===');
      console.log('Full response:', JSON.stringify(response, null, 2));

      if (response.report) {
        const report = response.report;
        setReportData(report);
        setReportDescription(report.report || '');
        setIsReadOnly(true);
        setIsEditingDescription(false);

        console.log('=== Report Data Loaded ===');
        console.log('Report ID:', report.reportId);
        console.log('Ticket Number:', report.ticketNumber);
        console.log('Title:', report.takenTask?.task?.title);
        console.log('Created At:', report.created_at);
        console.log('Has Images:', !!report.image);
        console.log('Image String:', report.image);
        console.log('Has Team:', !!report.takenTask?.users);

        // Parse photos from image array
        if (report.image) {
          try {
            console.log('=== Parsing Images ===');
            console.log('Image type:', typeof report.image);
            console.log('Image value:', report.image.substring(0, 100) + '...'); // Log first 100 chars

            const imageArray = typeof report.image === 'string'
              ? JSON.parse(report.image)
              : report.image;

            console.log('Parsed image array length:', Array.isArray(imageArray) ? imageArray.length : 'not an array');

            if (Array.isArray(imageArray)) {
              const photosList = imageArray.map((imgData: string, index: number) => {
                // Check if the image is a filename, URL, or base64
                let fullImageUri: string;

                if (imgData.startsWith('data:image')) {
                  // Already a data URI, use as-is (legacy format)
                  fullImageUri = imgData;
                  console.log(`Photo ${index + 1} is a data URI (legacy)`);
                } else if (imgData.startsWith('http')) {
                  // It's a full URL from another source
                  fullImageUri = imgData;
                  console.log(`Photo ${index + 1} URL:`, fullImageUri.substring(0, 50) + '...');
                } else if (imgData.includes('.jpg') || imgData.includes('.jpeg') || imgData.includes('.png') || imgData.includes('.webp')) {
                  // It's a filename, construct the URL
                  // Remove /api from base URL for static content
                  const staticBaseUrl = API_BASE_URL.replace('/api', '');
                  fullImageUri = `${staticBaseUrl}/uploads/reports/${imgData}`;
                  console.log(`Photo ${index + 1} filename: ${imgData} → URL: ${fullImageUri}`);
                } else {
                  // It's just base64, reconstruct the data URI (legacy format)
                  fullImageUri = `data:image/jpeg;base64,${imgData}`;
                  console.log(`Photo ${index + 1} reconstructed from base64 (legacy)`);
                }

                return {
                  id: `${index}`,
                  uri: fullImageUri,
                  name: `photo_${index + 1}`,
                };
              });
              setPhotos(photosList);
              console.log(`✅ Loaded ${photosList.length} photos`);
            }
          } catch (error) {
            console.error('❌ Error parsing images:', error);
          }
        } else {
          console.log('⚠️ No images in report');
        }

        // Load team members from the taken task
        if (report.takenTask?.users && Array.isArray(report.takenTask.users)) {
          setTeamMembers(report.takenTask.users);
          console.log(`✅ Loaded ${report.takenTask.users.length} team members`);
        } else {
          console.log('⚠️ No team members in report');
        }
      }
    } catch (error) {
      console.error('❌ Error loading report details:', error);
      showToast('Gagal memuat detail laporan', 'error');
    } finally {
      setIsLoadingReport(false);
    }
  };

  const loadTeamMembers = async () => {
    try {
      setIsLoadingTeam(true);
      const takenTaskId = params.takenTaskId as string;
      const response = await tasksAPI.getTakenTaskDetail(takenTaskId);

      if (response.assignment && response.assignment.assigned_users) {
        setTeamMembers(response.assignment.assigned_users);
      }
    } catch (error) {
      console.error('Error loading team members:', error);
    } finally {
      setIsLoadingTeam(false);
    }
  };

  // Helper function to convert image to base64 (compression handled by backend)
  const convertImageToBase64 = async (uri: string): Promise<string> => {
    try {
      // Convert image to base64 without compression
      // Backend will handle compression using Sharp for better results
      const base64 = await FileSystem.readAsStringAsync(uri, {
        encoding: 'base64',
      });

      console.log(`📸 Image converted to base64, length: ${base64.length} bytes`);

      // Return only the base64 string without data URI prefix
      // Backend will compress using Sharp before storing
      return base64;
    } catch (error) {
      console.error('Error converting image to base64:', error);
      throw error;
    }
  };

  // Complete the task after successful report submission
  const completeTask = async (takenTaskId: string) => {
    try {
      await tasksAPI.completeTask(takenTaskId);
      console.log('Task marked as completed');
      return true;
    } catch (error: any) {
      console.error('Error completing task:', error);
      return false;
    }
  };

  const deleteDraft = async () => {
    showDialog(
      'Hapus Draft',
      'Apakah Anda yakin ingin menghapus draft ini?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Hapus',
          style: 'destructive',
          onPress: async () => {
            try {
              const draftKey = `report_draft_${taskData?.taskId}`;
              await AsyncStorage.removeItem(draftKey);
              setHasDraft(false);
              setReportDescription('');
              setPhotos([]);
              showToast('Draft berhasil dihapus', 'success');
            } catch (error) {
              console.error('Error deleting draft:', error);
              showToast('Gagal menghapus draft', 'error');
            }
          },
        },
      ]
    );
  };

  // Report data - use loaded data, task data for new reports, or fallback to mock data
  const report = reportData ? {
    id: reportData.reportId,
    ticketNumber: reportData.ticketNumber || 'N/A',
    taskId: reportData.takenTaskId || 'N/A',
    title: reportData.takenTask?.task?.title || 'Laporan',
    location: reportData.takenTask?.task?.location || '',
    description: reportData.takenTask?.task?.description || '',
    date: new Date(reportData.createdAt).toLocaleDateString('id-ID', {
      day: 'numeric',
      month: 'short',
      year: 'numeric'
    }),
    time: new Date(reportData.createdAt).toLocaleTimeString('id-ID', {
      hour: '2-digit',
      minute: '2-digit'
    }),
    status: 'completed',
    startTime: reportData.takenTask?.startTime
      ? new Date(reportData.takenTask.startTime).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })
      : '-',
    endTime: reportData.takenTask?.endTime
      ? new Date(reportData.takenTask.endTime).toLocaleTimeString('id-ID', {
        hour: '2-digit',
        minute: '2-digit'
      })
      : '-',
    duration: reportData.takenTask?.endTime && reportData.takenTask?.startTime
      ? (() => {
        const start = new Date(reportData.takenTask.startTime);
        const end = new Date(reportData.takenTask.endTime);
        const diffMs = end.getTime() - start.getTime();
        const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
        const diffMinutes = Math.floor((diffMs % (1000 * 60 * 60)) / (1000 * 60));
        return `${diffHours}j ${diffMinutes}m`;
      })()
      : '-',
    hasPhoto: photos.length > 0,
    user: reportData.user,
    reportDescription: reportData.report || '',
    createdAt: reportData.createdAt,
  } : isNewReport && taskData ? {
    id: 'NEW',
    ticketNumber: 'RPT-PENDING',
    taskId: taskData.taskId,
    title: taskData.taskTitle || 'Laporan Baru',
    date: taskData.taskDate || new Date().toLocaleDateString('id-ID', { day: 'numeric', month: 'short', year: 'numeric' }),
    time: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    status: 'draft',
    startTime: taskData.taskStartTime ? new Date(taskData.taskStartTime).toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }) : '-',
    endTime: new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit' }),
    duration: '-',
    hasPhoto: false,
  } : {
    id: params.reportId || 'RPT-001',
    ticketNumber: 'RPT-000001',
    taskId: 'TSK-005',
    title: 'Inspeksi Gedung B - Lantai 5',
    date: '16 Feb 2026',
    time: '14:30',
    status: 'completed',
    startTime: '08:00',
    endTime: '14:30',
    duration: '6.5 jam',
    hasPhoto: true,
  };

  // Handle adding photo from camera
  const handleCameraPhoto = async () => {
    setShowPhotoOptions(false);
    if (photos.length >= MAX_REPORT_PHOTOS) {
      showToast(`Maksimal ${MAX_REPORT_PHOTOS} foto untuk satu laporan`, 'warning');
      return;
    }

    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Izin kamera diperlukan untuk mengambil foto', 'warning');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: false,
        quality: 0.8,
      });

      if (!result.canceled && result.assets && result.assets.length > 0) {
        const asset = result.assets[0];
        const { status: locationPermission } = await Location.requestForegroundPermissionsAsync();
        if (locationPermission !== 'granted') {
          showToast('Izin lokasi diperlukan untuk memverifikasi foto di lokasi tugas', 'warning');
          return;
        }

        const position = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
        });
        const coordinates = position.coords as Location.LocationObjectCoords & { mocked?: boolean };
        if (coordinates.mocked) {
          showToast('Lokasi tiruan terdeteksi. Matikan aplikasi GPS palsu untuk mengambil foto.', 'error');
          return;
        }

        const accuracy = coordinates.accuracy;
        if (accuracy === null || accuracy > MAX_TASK_DISTANCE_METERS) {
          showToast('Akurasi GPS belum cukup. Pindah ke area terbuka lalu coba lagi.', 'warning');
          return;
        }

        const taskLatitude = Number(taskData?.taskLatitude ?? reportData?.takenTask?.task?.latitude);
        const taskLongitude = Number(taskData?.taskLongitude ?? reportData?.takenTask?.task?.longitude);
        if (!Number.isFinite(taskLatitude) || !Number.isFinite(taskLongitude)) {
          showToast('Koordinat lokasi tugas belum tersedia; foto tidak dapat diverifikasi', 'error');
          return;
        }

        const distance = distanceInMeters(
          coordinates.latitude,
          coordinates.longitude,
          taskLatitude,
          taskLongitude,
        );
        if (distance > MAX_TASK_DISTANCE_METERS) {
          showToast(`Kamu harus berada maksimal ${MAX_TASK_DISTANCE_METERS} meter dari lokasi tugas`, 'error');
          return;
        }

        const capture = {
          latitude: coordinates.latitude,
          longitude: coordinates.longitude,
          accuracy,
          capturedAt: new Date().toISOString(),
          mocked: false,
        };
        const newPhoto: Photo = {
          id: Date.now().toString(),
          uri: asset.uri,
          name: `Photo ${photos.length + 1}`,
          capture,
        };
        setPhotos([...photos, newPhoto]);
        showToast(`Foto berhasil ditambahkan (${photos.length + 1}/${MAX_REPORT_PHOTOS})`, 'success');
      }
    } catch (error) {
      showToast('Gagal memverifikasi lokasi foto. Pastikan GPS aktif lalu coba lagi.', 'error');
      console.error(error);
    }
  };

  // Handle removing photo
  const handleRemovePhoto = (photoId: string) => {
    showDialog('Hapus Foto', 'Apakah Anda yakin ingin menghapus foto ini?', [
      {
        text: 'Batal',
        style: 'cancel'
      },
      {
        text: 'Hapus',
        onPress: () => {
          const photoToRemove = photos.find(p => p.id === photoId);
          if (photoToRemove && isEditingReport && photoToRemove.uri.startsWith(`${API_BASE_URL.replace('/api', '')}/uploads`)) {
            // Track removed photos during edit - extract filename from URI
            const filename = photoToRemove.uri.split('/').pop();
            if (filename && !removedPhotos.includes(filename)) {
              setRemovedPhotos([...removedPhotos, filename]);
            }
          }
          setPhotos(photos.filter(p => p.id !== photoId));
        },
        style: 'destructive'
      }
    ]);
  };

  // Handle save description
  const handleSaveDescription = () => {
    if (reportDescription.trim() === '') {
      showToast('Judul tidak boleh kosong', 'warning');
      return;
    }
    setIsEditingDescription(false);
    showToast('Judul laporan telah diperbarui', 'success');
  };

  // Handle save draft to AsyncStorage
  const handleSaveDraft = async () => {
    try {
      const draftData = {
        taskId: taskData?.taskId || report.taskId,
        title: report.title,
        description: reportDescription,
        photos: photos,
        date: report.date,
        time: report.time,
        savedAt: new Date().toISOString(),
      };

      await AsyncStorage.setItem(
        `report_draft_${taskData?.taskId || report.id}`,
        JSON.stringify(draftData)
      );

      setHasDraft(true);
      showToast('Draft laporan berhasil disimpan.', 'success');
      setTimeout(() => router.back(), 1500);
    } catch (error) {
      showToast('Gagal menyimpan draft laporan', 'error');
      console.error('Error saving draft:', error);
    }
  };

  // Handle submit report - saves report to database WITHOUT completing task
  // Task must be completed separately via task-reports screen
  const handleUpdateReport = async () => {
    if (reportDescription.trim() === '') {
      showToast('Deskripsi laporan harus diisi', 'warning');
      return;
    }

    showDialog(
      'Perbarui Laporan',
      'Apakah Anda yakin ingin memperbarui laporan ini?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Perbarui',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              const reportId = params.reportId as string;

              // Convert new photos to base64
              let capturedPhotos: CapturedReportPhoto[] = [];
              if (photos.length > 0) {
                // Filter out photos that are already URLs/from existing report
                const newPhotosOnly = photos.filter(
                  photo => !photo.uri.startsWith('http') && !photo.uri.startsWith(`${API_BASE_URL.replace('/api', '')}/uploads`)
                );

                if (newPhotosOnly.length > 0) {
                  if (newPhotosOnly.some((photo) => !photo.capture)) {
                    throw new Error('Foto lama tanpa verifikasi GPS harus dihapus dan diambil ulang dari kamera.');
                  }
                  console.log(`Converting ${newPhotosOnly.length} verified photos to base64...`);
                  capturedPhotos = await Promise.all(
                    newPhotosOnly.map(async (photo) =>
                      attachPhotoImage(photo, await convertImageToBase64(photo.uri))
                    )
                  );
                }
              }

              console.log('Updating report to API...', {
                reportId,
                descriptionLength: reportDescription.length,
                newPhotosCount: capturedPhotos.length,
                removedPhotosCount: removedPhotos.length,
              });

              // Call API to update report
              const response = await reportsAPI.updateReport(
                reportId,
                reportDescription,
                capturedPhotos.length > 0 ? capturedPhotos : undefined,
                removedPhotos.length > 0 ? removedPhotos : undefined
              );

              console.log('Report updated successfully:', response);

              setIsSubmitting(false);
              setIsEditingReport(false);
              setRemovedPhotos([]);

              // Reload report details to show updated data
              await loadReportDetails();

              showToast('Laporan berhasil diperbarui.', 'success');
            } catch (error: any) {
              console.error('Error updating report:', error);
              setIsSubmitting(false);
              showToast(error.message || 'Gagal memperbarui laporan. Silakan coba lagi.', 'error');
            }
          },
        },
      ]
    );
  };

  const handleSubmitReport = async () => {
    if (reportDescription.trim() === '') {
      showToast('Deskripsi laporan harus diisi', 'warning');
      return;
    }

    if (photos.length === 0) {
      showToast('Minimal 1 foto harus diunggah', 'warning');
      return;
    }

    if (photos.length > MAX_REPORT_PHOTOS) {
      showToast(`Maksimal ${MAX_REPORT_PHOTOS} foto untuk satu laporan`, 'warning');
      return;
    }

    if (photos.some((photo) => !photo.capture)) {
      showToast('Foto draft lama perlu dihapus dan diambil ulang langsung dari kamera di lokasi tugas', 'warning');
      return;
    }

    showDialog(
      'Simpan Laporan',
      'Apakah Anda yakin ingin menyimpan laporan ini? Tugas akan tetap aktif dan dapat menerima laporan tambahan.',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Simpan',
          onPress: async () => {
            setIsSubmitting(true);
            try {
              // Convert captured photos to base64 while keeping their GPS evidence.
              console.log('Converting verified photos to base64...');
              const capturedPhotos = await Promise.all(
                photos.map(async (photo) =>
                  attachPhotoImage(photo, await convertImageToBase64(photo.uri))
                )
              );

              // Get taken_task_id from taskData
              const takenTaskId = taskData?.taskId;
              if (!takenTaskId) {
                throw new Error('Task assignment ID not found');
              }

              console.log('Submitting report to API...', {
                takenTaskId,
                descriptionLength: reportDescription.length,
                photosCount: capturedPhotos.length,
              });

              // Call API to submit report
              const response = await reportsAPI.createReport(
                takenTaskId,
                reportDescription,
                capturedPhotos
              );

              console.log('Report submitted successfully:', response);

              // Delete draft after successful submission
              const draftKey = `report_draft_${taskData?.taskId || report.id}`;
              await AsyncStorage.removeItem(draftKey);

              setIsSubmitting(false);
              showToast('Laporan berhasil disimpan.', 'success');
              setTimeout(() => router.back(), 1500);
            } catch (error: any) {
              console.error('Error submitting report:', error);
              setIsSubmitting(false);
              showToast(error.message || 'Gagal menyimpan laporan. Silakan coba lagi.', 'error');
            }
          },
        },
      ]
    );
  };

  // Location history from tracking
  const locationHistory: LocationPoint[] = [
    {
      id: '1',
      time: '14:30',
      location: 'Gedung B - Lantai 5, Ruang Meeting',
      coordinates: '-6.1944, 106.8229',
      notes: 'Selesai inspeksi, dokumentasi lengkap',
    },
    {
      id: '2',
      time: '13:15',
      location: 'Gedung B - Lantai 4, Koridor Utama',
      coordinates: '-6.1940, 106.8225',
      notes: 'Pemeriksaan sistem HVAC',
    },
    {
      id: '3',
      time: '11:30',
      location: 'Gedung B - Lantai 3, Ruang Server',
      coordinates: '-6.1938, 106.8228',
      notes: 'Pengecekan server dan network equipment',
    },
    {
      id: '4',
      time: '10:00',
      location: 'Gedung B - Lantai 2, Ruang Elektrikal',
      coordinates: '-6.1935, 106.8230',
      notes: 'Inspeksi panel listrik utama',
    },
    {
      id: '5',
      time: '08:30',
      location: 'Gedung B - Lantai 1, Lobby',
      coordinates: '-6.1932, 106.8232',
      notes: 'Check-in dan persiapan peralatan',
    },
  ];

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed': return '#10B981';
      case 'pending': return '#F59E0B';
      case 'draft': return '#6B7280';
      default: return '#D1D5DB';
    }
  };

  const getStatusText = (status: string) => {
    switch (status) {
      case 'completed': return 'Selesai';
      case 'pending': return 'Tertunda';
      case 'draft': return 'Draft';
      default: return '';
    }
  };

  // Check if report can be submitted
  const canSubmit = reportDescription.trim().length > 0 && photos.length > 0;

  return (
    <SafeAreaView style={styles.container} edges={['top']}>
      <ImageViewerModal
        images={viewerImages}
        initialIndex={viewerIndex}
        visible={viewerVisible}
        onClose={() => setViewerVisible(false)}
      />
      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity
          style={styles.backButton}
          onPress={() => router.back()}
        >
          <IconSymbol name="arrow.left" size={20} color="#1d1d1f" />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>
          {isNewReport ? 'Buat Laporan Baru' : 'Detail Laporan'}
        </Text>
        <View style={{ width: 36 }} />
      </View>

      {/* Draft Status Banner */}
      {hasDraft && isNewReport && (
        <View style={styles.draftBanner}>
          <View style={styles.draftBannerContent}>
            <IconSymbol name="doc.text.fill" size={16} color="#F59E0B" />
            <Text style={styles.draftBannerText}>Draft tersimpan</Text>
          </View>
          <TouchableOpacity onPress={deleteDraft}>
            <Text style={styles.draftDeleteText}>Hapus</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* Main Content with Keyboard Handling */}
      <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
        <View style={styles.keyboardView}>
          {/* Loading Skeleton */}
          {isLoadingReport ? (
            <ScrollView style={styles.scrollView} showsVerticalScrollIndicator={false}>
              {/* Report Card Skeleton */}
              <View style={styles.section}>
                <View style={styles.reportCard}>
                  <View style={styles.skeletonRow}>
                    <View style={[styles.skeleton, styles.skeletonBadge]} />
                    <View style={[styles.skeleton, styles.skeletonTicket]} />
                  </View>
                  <View style={[styles.skeleton, styles.skeletonTitle]} />
                  <View style={styles.skeletonMetaRow}>
                    <View style={[styles.skeleton, styles.skeletonMeta]} />
                    <View style={[styles.skeleton, styles.skeletonMeta]} />
                  </View>
                </View>
              </View>

              {/* Team Skeleton */}
              <View style={styles.section}>
                <View style={[styles.skeleton, styles.skeletonSectionTitle]} />
                <View style={styles.teamContainer}>
                  {[1, 2, 3].map((i) => (
                    <View key={i} style={styles.teamMemberCard}>
                      <View style={[styles.skeleton, styles.skeletonAvatar]} />
                      <View style={styles.teamMemberInfo}>
                        <View style={[styles.skeleton, styles.skeletonTeamName]} />
                        <View style={[styles.skeleton, styles.skeletonTeamPosition]} />
                      </View>
                    </View>
                  ))}
                </View>
              </View>

              {/* Description Skeleton */}
              <View style={styles.section}>
                <View style={[styles.skeleton, styles.skeletonSectionTitle]} />
                <View style={styles.descriptionCard}>
                  <View style={[styles.skeleton, styles.skeletonTextLine]} />
                  <View style={[styles.skeleton, styles.skeletonTextLine]} />
                  <View style={[styles.skeleton, styles.skeletonTextLineShort]} />
                </View>
              </View>

              {/* Photos Skeleton */}
              <View style={styles.section}>
                <View style={[styles.skeleton, styles.skeletonSectionTitle]} />
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View style={styles.photosGrid}>
                    {[1, 2, 3].map((i) => (
                      <View key={i} style={[styles.skeleton, styles.skeletonPhoto]} />
                    ))}
                  </View>
                </ScrollView>
              </View>
            </ScrollView>
          ) : (
            <ScrollView
              ref={scrollViewRef}
              style={styles.scrollView}
              showsVerticalScrollIndicator={false}
              contentContainerStyle={styles.scrollViewContent}
              keyboardShouldPersistTaps="handled"
            >
              {/* Report Info Card */}
              <View style={styles.section}>
                <View style={styles.reportCard}>
                  <View style={styles.reportHeader}>
                    <View style={styles.reportHeaderLeft}>
                      <View style={[
                        styles.statusBadge,
                        { backgroundColor: getStatusColor(report.status) }
                      ]}>
                        <Text style={styles.statusBadgeText}>
                          {getStatusText(report.status)}
                        </Text>
                      </View>
                      <Text style={styles.reportId}>{report.ticketNumber}</Text>
                    </View>
                  </View>

                  <Text style={styles.reportTitle}>{report.title}</Text>

                  <View style={styles.reportMeta}>
                    <View style={styles.reportMetaItem}>
                      <IconSymbol size={14} name="calendar" color="#86868b" />
                      <Text style={styles.reportMetaText}>{report.date}</Text>
                    </View>
                    <View style={styles.reportMetaItem}>
                      <IconSymbol size={14} name="clock.fill" color="#86868b" />
                      <Text style={styles.reportMetaText}>
                        {report.time || report.startTime}
                      </Text>
                    </View>
                    {report.duration && report.duration !== '-' && (
                      <View style={styles.reportMetaItem}>
                        <IconSymbol size={14} name="timer" color="#86868b" />
                        <Text style={styles.reportMetaText}>Durasi: {report.duration}</Text>
                      </View>
                    )}
                    {report.location && (
                      <View style={styles.reportMetaItem}>
                        <IconSymbol size={14} name="location.fill" color="#86868b" />
                        <Text style={styles.reportMetaText}>{report.location}</Text>
                      </View>
                    )}
                  </View>
                </View>
              </View>

              {/* Description */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Judul Laporan</Text>
                </View>

                {(isEditingDescription || isEditingReport) ? (
                  <View style={styles.descriptionEditCard}>
                    <TextInput
                      style={styles.descriptionInput}
                      multiline
                      placeholder="Masukkan Judul laporan..."
                      placeholderTextColor="#9CA3AF"
                      value={reportDescription}
                      onChangeText={setReportDescription}
                      onFocus={() => handleInputFocus(200)}
                    />
                  </View>
                ) : (
                  <View style={styles.descriptionCard}>
                    <Text style={styles.descriptionText}>{reportDescription}</Text>
                  </View>
                )}
              </View>

              {/* Photos */}
              <View style={styles.section}>
                <View style={styles.sectionHeader}>
                  <Text style={styles.sectionTitle}>Foto Dokumentasi</Text>
                  <View style={styles.photoCountBadge}>
                    <IconSymbol size={12} name="photo.fill" color="#1d1d1f" />
                    <Text style={styles.photoCountText}>{photos.length} Foto</Text>
                  </View>
                </View>

                {photos.length === 0 ? (
                  // Tampilkan tombol tambah foto ketika tidak ada foto
                  (isNewReport || isEditingReport) && (
                    <TouchableOpacity
                      style={styles.photoItem}
                      onPress={() => setShowPhotoOptions(true)}
                    >
                      <View style={styles.uploadPhotoPlaceholder}>
                        <IconSymbol size={28} name="plus" color="#1d1d1f" />
                        <Text style={styles.uploadPhotoText}>Tambah Foto</Text>
                      </View>
                    </TouchableOpacity>
                  )
                ) : (
                  // Tampilkan galeri foto dengan tombol tambah di akhir
                  <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                    <View style={styles.photosGrid}>
                      {/* Existing Photos */}
                      {photos.map((photo) => (
                        <View key={photo.id} style={styles.photoItem}>
                          {loadingPhotos[photo.id] && (
                            <View style={[styles.skeleton, styles.skeletonPhotoLoading]} />
                          )}
                          <TouchableOpacity
                            activeOpacity={0.85}
                            onPress={() => {
                              const imgUris = photos.map(p => p.uri);
                              const idx = photos.findIndex(p => p.id === photo.id);
                              openViewer(imgUris, idx);
                            }}
                            style={{ width: '100%', height: '100%' }}
                          >
                            <Image
                              source={{ uri: photo.uri }}
                              style={styles.photoImage}
                              onLoadStart={() => {
                                setLoadingPhotos(prev => ({ ...prev, [photo.id]: true }));
                              }}
                              onLoad={() => {
                                console.log('✅ Image loaded:', photo.uri);
                                setLoadingPhotos(prev => ({ ...prev, [photo.id]: false }));
                              }}
                              onError={(e) => {
                                console.error('❌ Image failed to load:', photo.uri);
                                console.error('Error details:', e.nativeEvent.error);
                                setLoadingPhotos(prev => ({ ...prev, [photo.id]: false }));
                              }}
                              resizeMode="cover"
                            />
                          </TouchableOpacity>
                          {photo.capture && (
                            <View pointerEvents="none" style={styles.photoWatermarkPreview}>
                              <View style={styles.photoWatermarkText}>
                                <Text numberOfLines={1} style={styles.photoWatermarkTitle}>C-TRACK • BUKTI FOTO</Text>
                                <Text numberOfLines={1} style={styles.photoWatermarkDetail}>
                                  {new Date(photo.capture.capturedAt).toLocaleString('id-ID')}
                                </Text>
                                <Text numberOfLines={1} style={styles.photoWatermarkDetail}>
                                  {photo.capture.latitude.toFixed(5)}, {photo.capture.longitude.toFixed(5)}
                                </Text>
                              </View>
                              <View style={styles.miniMapPreview}>
                                <View style={styles.miniMapRoadHorizontal} />
                                <View style={styles.miniMapRoadVertical} />
                                <View style={styles.miniMapTaskPin} />
                                <View style={styles.miniMapUserPin} />
                              </View>
                            </View>
                          )}
                          {(isNewReport || isEditingReport) && (
                            <TouchableOpacity
                              style={styles.photoDeleteButton}
                              onPress={() => handleRemovePhoto(photo.id)}
                            >
                              <IconSymbol size={14} name="xmark" color="#FFFFFF" />
                            </TouchableOpacity>
                          )}
                        </View>
                      ))}

                      {/* Upload Photo Button */}
                      {(isNewReport || isEditingReport) && photos.length < MAX_REPORT_PHOTOS && (
                        <TouchableOpacity
                          style={styles.photoItem}
                          onPress={() => setShowPhotoOptions(true)}
                        >
                          <View style={styles.uploadPhotoPlaceholder}>
                            <IconSymbol size={28} name="plus" color="#1d1d1f" />
                            <Text style={styles.uploadPhotoText}>Tambah Foto</Text>
                          </View>
                        </TouchableOpacity>
                      )}
                    </View>
                  </ScrollView>
                )}
              </View>

              {/* Actions */}
              <View style={styles.section}>
                {isNewReport ? (
                  <>
                    <View style={styles.actionsCard}>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.saveDraftButton]}
                        onPress={handleSaveDraft}
                      >
                        <Text style={styles.saveDraftButtonText}>Simpan Draft</Text>
                        <IconSymbol size={18} name="folder.fill" color="#000000" />
                      </TouchableOpacity>
                      {/* Submit Report Button - Only show if description and photos exist */}
                      {canSubmit && (
                        <TouchableOpacity
                          style={[
                            styles.actionButton,
                            styles.submitButton,
                            isSubmitting && styles.buttonDisabled
                          ]}
                          onPress={handleSubmitReport}
                          disabled={isSubmitting}
                        >
                          {isSubmitting ? (
                            <>
                              <ActivityIndicator size="small" color="#FFFFFF" />
                              <Text style={[styles.submitButtonText, { marginLeft: 8 }]}>
                                Menyimpan...
                              </Text>
                            </>
                          ) : (
                            <>
                              <Text style={styles.submitButtonText}>Kirim Laporan</Text>
                              <IconSymbol size={18} name="paperplane.fill" color="#FFFFFF" />
                            </>
                          )}
                        </TouchableOpacity>
                      )}
                    </View>

                    {/* Submission Requirements Info */}
                    {!canSubmit && (
                      <View style={styles.requirementsCard}>
                        <IconSymbol name="info.circle.fill" size={16} color="#F59E0B" />
                        <Text style={styles.requirementsText}>
                          Untuk mengirim laporan, lengkapi Judul dan upload minimal 1 foto
                        </Text>
                      </View>
                    )}
                  </>
                ) : isEditingReport ? (
                  <>
                    <View style={styles.actionsCard}>
                      <TouchableOpacity
                        style={[styles.actionButton, styles.saveDraftButton]}
                        onPress={() => {
                          setIsEditingReport(false);
                          setRemovedPhotos([]);
                          loadReportDetails(); // Reload to reset changes
                        }}
                      >
                        <Text style={styles.saveDraftButtonText}>Batal</Text>
                        <IconSymbol size={18} name="xmark" color="#000000" />
                      </TouchableOpacity>

                      {/* Update Report Button */}
                      <TouchableOpacity
                        style={[
                          styles.actionButton,
                          styles.submitButton,
                          isSubmitting && styles.buttonDisabled
                        ]}
                        onPress={handleUpdateReport}
                        disabled={isSubmitting}
                      >
                        {isSubmitting ? (
                          <>
                            <ActivityIndicator size="small" color="#FFFFFF" />
                            <Text style={[styles.actionButtonText, { color: '#FFFFFF', marginLeft: 8 }]}>
                              Memperbarui...
                            </Text>
                          </>
                        ) : (
                          <>
                            <Text style={styles.submitButtonText}>Perbarui Laporan</Text>
                            <IconSymbol size={18} name="checkmark" color="#FFFFFF" />
                          </>
                        )}
                      </TouchableOpacity>
                    </View>
                  </>
                ) : null}
              </View>



              {/* Forum Discussion Button - Only for existing reports */}
              {!isNewReport && (
                <View style={[styles.section, { marginTop: 48 }]}>
                  <TouchableOpacity
                    style={{
                      flexDirection: 'row',
                      backgroundColor: "#000",
                      padding: 12,
                      borderRadius: 8,
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                    onPress={() =>
                      router.push(`/forum/${String(params.reportId)}`)
                    }
                  >
                    <IconSymbol size={16} name="message.fill" color="#FFFFFF" />
                    <Text style={{ color: "#fff", fontWeight: "600" }}>
                      Buka Forum Diskusi
                    </Text>
                  </TouchableOpacity>
                </View>
              )}

              <View style={styles.bottomSpacer} />
            </ScrollView>
          )}
          <Animated.View style={{ height: keyboardOffset }} />
        </View>
      </TouchableWithoutFeedback>

      {/* Photo Upload Options Modal */}
      <Modal
        visible={showPhotoOptions}
        transparent
        animationType="slide"
        onRequestClose={() => setShowPhotoOptions(false)}
      >
        <SafeAreaView style={styles.modalContainer} edges={[]}>
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <View style={styles.modalHeader}>
                <Text style={styles.modalTitle}>Tambah Foto</Text>
                <TouchableOpacity onPress={() => setShowPhotoOptions(false)}>
                  <IconSymbol size={20} name="xmark" color="#1d1d1f" />
                </TouchableOpacity>
              </View>

              <View style={styles.modalOptions}>
                <TouchableOpacity
                  style={styles.modalOption}
                  onPress={handleCameraPhoto}
                >
                  <View style={styles.modalOptionIcon}>
                    <IconSymbol size={28} name="camera.fill" color="#1d1d1f" />
                  </View>
                  <View style={styles.modalOptionText}>
                    <Text style={styles.modalOptionTitle}>Ambil Foto Kamera</Text>
                    <Text style={styles.modalOptionDesc}>Ambil foto menggunakan kamera perangkat</Text>
                  </View>
                  <IconSymbol size={18} name="chevron.right" color="#86868b" />
                </TouchableOpacity>

              </View>
              <Text style={styles.photoCaptureNote}>
                Maksimal 3 foto. Galeri tidak tersedia; lokasi GPS harus aktif dan berada maksimal 100 meter dari titik tugas.
              </Text>

              <TouchableOpacity
                style={styles.modalCancelButton}
                onPress={() => setShowPhotoOptions(false)}
              >
                <Text style={styles.modalCancelButtonText}>Batal</Text>
              </TouchableOpacity>
              <View style={{ height: 20 }} />
            </View>
          </View>
        </SafeAreaView>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f7',
  },
  keyboardView: {
    flex: 1,
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  loadingText: {
    marginTop: 16,
    fontSize: 16,
    color: '#6B7280',
    fontWeight: '500',
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
  moreButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    paddingBottom: 32,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 16,
  },
  sectionHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  sectionTitle: {
    fontSize: 15,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 12,
    letterSpacing: -0.2,
  },
  reportCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  reportHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  reportHeaderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  statusBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  statusBadgeText: {
    fontSize: 10,
    fontWeight: '600',
    color: '#FFFFFF',
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  reportId: {
    fontSize: 12,
    fontWeight: '600',
    color: '#86868b',
  },
  reportTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 12,
  },
  reportMeta: {
    gap: 8,
  },
  reportMetaItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  reportMetaText: {
    fontSize: 13,
    color: '#86868b',
  },
  descriptionCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  descriptionEditCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 16,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  descriptionInput: {
    borderWidth: 1,
    borderColor: '#d2d2d7',
    borderRadius: 6,
    padding: 12,
    fontSize: 14,
    color: '#1d1d1f',
    minHeight: 120,
    textAlignVertical: 'top',
    marginBottom: 12,
  },
  descriptionText: {
    fontSize: 14,
    color: '#86868b',
    lineHeight: 22,
  },
  editButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#000000',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 4,
  },
  editButtonText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#FFFFFF',
  },
  cancelButton: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 4,
    backgroundColor: '#f5f5f7',
    alignItems: 'center',
  },
  cancelButtonText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#86868b',
  },
  photoCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f5f7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  photoCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  photosGrid: {
    flexDirection: 'row',
    gap: 12,
  },
  photoItem: {
    width: 200,
    height: 200,
    borderRadius: 12,
    overflow: 'hidden',
    position: 'relative',
  },
  photoImage: {
    width: '100%',
    height: '100%',
  },
  photoWatermarkPreview: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    minHeight: 58,
    paddingHorizontal: 7,
    paddingVertical: 5,
    backgroundColor: 'rgba(16, 24, 32, 0.86)',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  photoWatermarkText: {
    flex: 1,
  },
  photoWatermarkTitle: {
    color: '#ffffff',
    fontSize: 9,
    fontWeight: '700',
  },
  photoWatermarkDetail: {
    color: '#e5e7eb',
    fontSize: 8,
  },
  miniMapPreview: {
    width: 42,
    height: 42,
    borderRadius: 5,
    overflow: 'hidden',
    backgroundColor: '#e5e7eb',
  },
  miniMapRoadHorizontal: {
    position: 'absolute',
    top: 13,
    left: 0,
    right: 0,
    height: 6,
    backgroundColor: '#ffffff',
  },
  miniMapRoadVertical: {
    position: 'absolute',
    left: 19,
    top: 0,
    bottom: 0,
    width: 6,
    backgroundColor: '#ffffff',
  },
  miniMapTaskPin: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    left: 9,
    top: 22,
    backgroundColor: '#dc2626',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  miniMapUserPin: {
    position: 'absolute',
    width: 9,
    height: 9,
    borderRadius: 5,
    right: 7,
    top: 8,
    backgroundColor: '#2563eb',
    borderWidth: 1,
    borderColor: '#ffffff',
  },
  uploadPhotoPlaceholder: {
    flex: 1,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
    borderWidth: 2,
    borderColor: '#1d1d1f',
    borderStyle: 'dashed',
    borderRadius: 12,
  },
  uploadPhotoText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  photoDeleteButton: {
    position: 'absolute',
    top: 8,
    right: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: '#EF4444',
    justifyContent: 'center',
    alignItems: 'center',
  },
  // Skeleton Styles
  skeleton: {
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  skeletonRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  skeletonBadge: {
    width: 80,
    height: 20,
    borderRadius: 4,
  },
  skeletonTicket: {
    width: 100,
    height: 16,
    borderRadius: 4,
  },
  skeletonTitle: {
    width: '80%',
    height: 24,
    borderRadius: 6,
    marginBottom: 12,
  },
  skeletonMetaRow: {
    flexDirection: 'row',
    gap: 12,
  },
  skeletonMeta: {
    width: 100,
    height: 16,
    borderRadius: 4,
  },
  skeletonSectionTitle: {
    width: 120,
    height: 18,
    borderRadius: 4,
    marginBottom: 12,
  },
  skeletonAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
  },
  skeletonTeamName: {
    width: 120,
    height: 16,
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonTeamPosition: {
    width: 80,
    height: 12,
    borderRadius: 4,
  },
  skeletonTextLine: {
    width: '100%',
    height: 14,
    borderRadius: 4,
    marginBottom: 8,
  },
  skeletonTextLineShort: {
    width: '60%',
    height: 14,
    borderRadius: 4,
  },
  skeletonPhoto: {
    width: 200,
    height: 200,
    borderRadius: 12,
  },
  skeletonPhotoLoading: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 12,
    zIndex: 1,
  },
  locationCountBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: '#f5f5f7',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 4,
  },
  locationCountText: {
    fontSize: 11,
    fontWeight: '500',
    color: '#1d1d1f',
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
  actionsCard: {
    gap: 12,
    marginTop: 8,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    padding: 10,
    borderRadius: 6,
    backgroundColor: '#f5f5f7',
  },
  actionButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  primaryActionButton: {
    backgroundColor: '#000000',
  },
  saveDraftButton: {
    backgroundColor: '#FFFFFF',
    borderWidth: 0.8,
    borderColor: '#000000',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
  },
  saveDraftButtonText: {
    fontSize: 15,
    fontWeight: '400',
    color: '#000000',
  },
  submitButton: {
    backgroundColor: '#1C1C1E',
    borderRadius: 12,
    height: 48,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 0,
  },
  submitButtonText: {
    fontSize: 15,
    fontWeight: '400',
    color: '#FFFFFF',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  requirementsCard: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FEF3C7',
    padding: 12,
    borderRadius: 8,
    marginTop: 12,
  },
  requirementsText: {
    flex: 1,
    fontSize: 13,
    color: '#92400E',
    lineHeight: 18,
  },
  draftBanner: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#FEF3C7',
    paddingHorizontal: 20,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#FDE68A',
  },
  draftBannerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  draftBannerText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#92400E',
  },
  draftDeleteText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#EF4444',
  },
  modalContainer: {
    flex: 1,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  modalContent: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 20,
    paddingBottom: 20,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 17,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  modalOptions: {
    gap: 10,
    marginBottom: 16,
  },
  photoCaptureNote: {
    color: '#6b7280',
    fontSize: 12,
    textAlign: 'center',
    marginBottom: 14,
    lineHeight: 17,
  },
  modalOption: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 12,
    backgroundColor: '#f5f5f7',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  modalOptionIcon: {
    width: 48,
    height: 48,
    borderRadius: 8,
    backgroundColor: '#FFFFFF',
    justifyContent: 'center',
    alignItems: 'center',
  },
  modalOptionText: {
    flex: 1,
  },
  modalOptionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  modalOptionDesc: {
    fontSize: 12,
    color: '#86868b',
  },
  modalCancelButton: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 6,
    backgroundColor: '#f5f5f7',
    alignItems: 'center',
  },
  modalCancelButtonText: {
    fontSize: 14,
    fontWeight: '500',
    color: '#86868b',
  },
  teamContainer: {
    gap: 10,
    marginTop: 10,
  },
  teamMemberCard: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 12,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  teamMemberAvatar: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#3B82F6',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  teamMemberAvatarText: {
    color: '#FFFFFF',
    fontSize: 16,
    fontWeight: '600',
  },
  teamMemberInfo: {
    flex: 1,
  },
  teamMemberName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 2,
  },
  teamMemberPosition: {
    fontSize: 12,
    color: '#86868b',
  },
  bottomSpacer: {
    height: 40,
  },
});