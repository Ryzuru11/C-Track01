import React, { useState, useEffect, useRef } from 'react';
import { useGpsGuard } from '@/hooks/useGpsGuard';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Modal,
  TextInput,
  Platform,
  Image,
  Keyboard,
  Animated,
  KeyboardAvoidingView,
  type ScrollViewInstance,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as ImagePicker from 'expo-image-picker';
import * as FileSystem from 'expo-file-system/legacy';
import { manipulateAsync, SaveFormat } from 'expo-image-manipulator';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { profileAPI } from '@/services/api';
import { showToast, showDialog } from '@/utils/alert';
import { useAppContext } from '@/context/AppContext';

const cTrackLogo = require('@/assets/images/C-Track.png');

interface UserData {
  id: string;
  name: string;
  email: string;
  phoneNumber?: string;
  department?: string;
  position?: string;
  address?: string;
  avatar?: string | null;
  status?: string;
  role?: string;
}

export default function ProfileScreen() {
  const insets = useSafeAreaInsets();
  useGpsGuard();

  const router = useRouter();
  const { refreshUser } = useAppContext();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Keyboard state
  const [keyboardVisible, setKeyboardVisible] = useState(false);
  const [keyboardHeight, setKeyboardHeight] = useState(0);

  // Edit profile modal state
  const [editModalVisible, setEditModalVisible] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [editName, setEditName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [editAddress, setEditAddress] = useState('');

  // Change password modal state
  const [passwordModalVisible, setPasswordModalVisible] = useState(false);
  const [isSavingPassword, setIsSavingPassword] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  // Avatar upload modal state
  const [avatarModalVisible, setAvatarModalVisible] = useState(false);
  const [isUploadingAvatar, setIsUploadingAvatar] = useState(false);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  const scrollViewRef = useRef<ScrollViewInstance | null>(null);

  // ── Keyboard Listeners ──────────────────────────────────────
  useEffect(() => {
    const keyboardWillShow = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillShow' : 'keyboardDidShow',
      (e) => {
        setKeyboardVisible(true);
        setKeyboardHeight(e.endCoordinates.height);
      }
    );
    const keyboardWillHide = Keyboard.addListener(
      Platform.OS === 'ios' ? 'keyboardWillHide' : 'keyboardDidHide',
      () => {
        setKeyboardVisible(false);
        setKeyboardHeight(0);
      }
    );

    return () => {
      keyboardWillShow.remove();
      keyboardWillHide.remove();
    };
  }, []);

  useEffect(() => {
    fetchUserData();
  }, []);

  const fetchUserData = async () => {
    setIsLoading(true);
    try {
      const response = await profileAPI.getProfile();
      const user = response.user as UserData;
      setUserData(user);
      await AsyncStorage.setItem('user', JSON.stringify(user));
      refreshUser();
    } catch (error: any) {
      console.error('Error fetching user data from API:', error);
      try {
        const userJson = await AsyncStorage.getItem('user');
        if (userJson) {
          setUserData(JSON.parse(userJson));
        }
      } catch (e) {
        console.error('Error reading from cache:', e);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const openEditModal = () => {
    setEditName(userData?.name || '');
    setEditPhone(userData?.phoneNumber || '');
    setEditAddress(userData?.address || '');
    setEditModalVisible(true);
  };

  const handleSaveProfile = async () => {
    if (!userData?.id) return;
    if (!editName.trim()) {
      showToast('Nama tidak boleh kosong.', 'warning');
      return;
    }

    setIsSaving(true);
    try {
      const response = await profileAPI.updateProfile(
        userData.id,
        editName.trim(),
        editPhone.trim() || undefined,
        undefined,
        undefined,
        editAddress.trim() || undefined
      );

      const updated: UserData = {
        ...userData,
        name: (response as any).user?.name ?? editName.trim(),
        phoneNumber: (response as any).user?.phoneNumber ?? editPhone.trim(),
        address: (response as any).user?.address ?? editAddress.trim(),
      };
      setUserData(updated);
      await AsyncStorage.setItem('user', JSON.stringify(updated));
      refreshUser();

      setEditModalVisible(false);
      showToast('Profil berhasil diperbarui.', 'success');
    } catch (error: any) {
      showToast(error.message || 'Gagal memperbarui profil.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const openPasswordModal = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmPassword('');
    setShowCurrent(false);
    setShowNew(false);
    setShowConfirm(false);
    setPasswordModalVisible(true);
  };

  const handleChangePassword = async () => {
    if (!currentPassword.trim()) {
      showToast('Masukkan password saat ini.', 'warning');
      return;
    }
    if (newPassword.length < 6) {
      showToast('Password baru minimal 6 karakter.', 'warning');
      return;
    }
    if (newPassword !== confirmPassword) {
      showToast('Konfirmasi password tidak cocok.', 'warning');
      return;
    }

    setIsSavingPassword(true);
    try {
      await profileAPI.changePassword(currentPassword, newPassword);
      setPasswordModalVisible(false);
      showToast('Password berhasil diperbarui.', 'success');
    } catch (error: any) {
      showToast(error.message || 'Gagal mengganti password.', 'error');
    } finally {
      setIsSavingPassword(false);
    }
  };

  const handleLogout = async () => {
    showDialog(
      'Logout',
      'Apakah kamu yakin ingin logout?',
      [
        { text: 'Batal', style: 'cancel' },
        {
          text: 'Logout',
          style: 'destructive',
          onPress: async () => {
            try {
              await AsyncStorage.removeItem('userToken');
              await AsyncStorage.removeItem('userEmail');
              await AsyncStorage.removeItem('user');
              router.replace('/login');
            } catch (error) {
              console.error('Logout error:', error);
              showToast('Gagal logout. Coba lagi.', 'error');
            }
          },
        },
      ]
    );
  };

  // Handle camera photo for avatar
  const handleCameraAvatarPhoto = async () => {
    setAvatarModalVisible(false);
    try {
      const { status } = await ImagePicker.requestCameraPermissionsAsync();
      if (status !== 'granted') {
        showToast('Izin kamera diperlukan untuk mengambil foto', 'warning');
        return;
      }

      const result = await ImagePicker.launchCameraAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setAvatarPreview(result.assets[0].uri);
        setAvatarModalVisible(true);
      }
    } catch (error) {
      showToast('Terjadi kesalahan saat mengambil foto', 'error');
    }
  };

  // Handle gallery photo for avatar
  const handleGalleryAvatarPhoto = async () => {
    setAvatarModalVisible(false);
    try {
      const { status } = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (status !== 'granted') {
        showToast('Izin galeri diperlukan untuk memilih foto', 'warning');
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (!result.canceled && result.assets[0]) {
        setAvatarPreview(result.assets[0].uri);
        setAvatarModalVisible(true);
      }
    } catch (error) {
      showToast('Terjadi kesalahan saat memilih foto', 'error');
    }
  };

  // Handle save avatar
  const handleSaveAvatar = async () => {
    if (!avatarPreview || !userData?.id) return;

    setIsUploadingAvatar(true);
    try {
      const manipulatedImage = await manipulateAsync(
        avatarPreview,
        [{ resize: { width: 400, height: 400 } }],
        { compress: 0.7, format: SaveFormat.JPEG }
      );

      const base64 = await FileSystem.readAsStringAsync(manipulatedImage.uri, {
        encoding: 'base64',
      });

      const response = await profileAPI.uploadAvatar(userData.id, base64);

      const updatedUser = { ...userData, avatar: base64 };
      setUserData(updatedUser);
      await AsyncStorage.setItem('user', JSON.stringify(updatedUser));
      refreshUser();

      setAvatarPreview(null);
      setAvatarModalVisible(false);
      showToast('Foto profil berhasil diperbarui', 'success');
    } catch (error: any) {
      console.error('Avatar upload error:', error);
      showToast(error.message || 'Gagal mengunggah foto profil', 'error');
    } finally {
      setIsUploadingAvatar(false);
    }
  };

  // ── Render ────────────────────────────────────────────────────────────────

  const renderHeader = () => (
    <View style={styles.header}>
      <Text style={styles.headerTitle}>Profil</Text>
      <TouchableOpacity style={styles.logoButton} onPress={fetchUserData}>
        <Image source={cTrackLogo} style={styles.headerIcon} />
      </TouchableOpacity>
    </View>
  );

  const renderProfileCard = () => (
    <View style={styles.profileCard}>
      {isLoading ? (
        <ActivityIndicator size="large" color="#1d1d1f" style={{ marginVertical: 20 }} />
      ) : (
        <>
          <TouchableOpacity
            style={styles.avatarContainer}
            onPress={() => setAvatarModalVisible(true)}
          >
            {userData?.avatar ? (
              <>
                <Image
                  source={{ uri: userData.avatar.startsWith('data:') ? userData.avatar : `data:image/jpeg;base64,${userData.avatar}` }}
                  style={styles.avatar}
                />
                <View style={styles.avatarOverlay}>
                  <IconSymbol size={24} name="camera.fill" color="#FFFFFF" />
                </View>
              </>
            ) : (
              <>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>
                    {userData?.name?.charAt(0).toUpperCase() || 'U'}
                  </Text>
                </View>
                <View style={styles.avatarOverlay}>
                  <IconSymbol size={24} name="camera.fill" color="#FFFFFF" />
                </View>
              </>
            )}
          </TouchableOpacity>
          <Text style={styles.userName}>{userData?.name || 'User'}</Text>
          <Text style={styles.userEmail}>{userData?.email || '-'}</Text>

          <View style={styles.chipsRow}>
            {userData?.department ? (
              <View style={styles.userInfoChip}>
                <IconSymbol size={12} name="building.2.fill" color="#1d1d1f" />
                <Text style={styles.userInfoText}>{userData.department}</Text>
              </View>
            ) : null}
            {userData?.position ? (
              <View style={styles.userInfoChip}>
                <IconSymbol size={12} name="briefcase.fill" color="#1d1d1f" />
                <Text style={styles.userInfoText}>{userData.position}</Text>
              </View>
            ) : null}
            {userData?.status ? (
              <View style={[styles.userInfoChip, { backgroundColor: userData.status === 'active' ? '#D1FAE5' : '#FEE2E2' }]}>
                <IconSymbol size={12} name="circle.fill" color={userData.status === 'active' ? '#10B981' : '#EF4444'} />
                <Text style={[styles.userInfoText, { color: userData.status === 'active' ? '#065F46' : '#991B1B' }]}>
                  {userData.status === 'active' ? 'Aktif' : 'Tidak Aktif'}
                </Text>
              </View>
            ) : null}
          </View>
        </>
      )}
    </View>
  );

  const renderInfoSkeleton = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Informasi Detail</Text>
      <View style={styles.menuContainer}>
        {[1, 2, 3].map((i) => (
          <View key={i} style={[styles.infoRow, i === 3 && { borderBottomWidth: 0 }]}>
            <View style={styles.infoRowLeft}>
              <View style={[styles.skeleton, styles.skeletonIcon]} />
              <View style={{ flex: 1 }}>
                <View style={[styles.skeleton, styles.skeletonLabel]} />
                <View style={[styles.skeleton, styles.skeletonValue]} />
              </View>
            </View>
          </View>
        ))}
      </View>
    </View>
  );

  const renderInfoSection = () => (
    <View style={styles.section}>
      <Text style={styles.sectionTitle}>Informasi Detail</Text>
      <View style={styles.menuContainer}>
        <InfoRow icon="phone.fill" label="No. Telepon" value={userData?.phoneNumber || '-'} />
        <InfoRow icon="location.fill" label="Alamat" value={userData?.address || '-'} />
        {userData?.role ? (
          <InfoRow icon="shield.fill" label="Role" value={userData.role} isLast />
        ) : null}
      </View>
    </View>
  );

  const renderEditModal = () => (
    <Modal
      visible={editModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setEditModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.keyboardAvoidingView,
            Platform.OS === 'android' && { paddingBottom: keyboardHeight }
          ]}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modalContainer, { paddingBottom: keyboardVisible ? 0 : Math.max(insets.bottom, 24) }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setEditModalVisible(false)} disabled={isSaving}>
                <Text style={styles.modalCancel}>Batal</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Edit Profil</Text>
              <TouchableOpacity onPress={handleSaveProfile} disabled={isSaving}>
                {isSaving ? (
                  <ActivityIndicator size="small" color="#10B981" />
                ) : (
                  <Text style={styles.modalSave}>Simpan</Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Nama */}
              <Text style={styles.fieldLabel}>Nama</Text>
              <TextInput
                style={styles.fieldInput}
                value={editName}
                onChangeText={setEditName}
                placeholder="Masukkan nama"
                placeholderTextColor="#c7c7cc"
                autoCapitalize="words"
              />

              {/* No. Telepon */}
              <Text style={styles.fieldLabel}>No. Telepon</Text>
              <TextInput
                style={styles.fieldInput}
                value={editPhone}
                onChangeText={setEditPhone}
                placeholder="Masukkan nomor telepon"
                placeholderTextColor="#c7c7cc"
                keyboardType="phone-pad"
              />

              {/* Alamat */}
              <Text style={styles.fieldLabel}>Alamat</Text>
              <TextInput
                style={[styles.fieldInput, styles.fieldInputMultiline]}
                value={editAddress}
                onChangeText={setEditAddress}
                placeholder="Masukkan alamat"
                placeholderTextColor="#c7c7cc"
                multiline
                numberOfLines={3}
                textAlignVertical="top"
              />

              {/* Read-only fields info */}
              <View style={styles.readonlyNotice}>
                <IconSymbol size={14} name="lock.fill" color="#86868b" />
                <Text style={styles.readonlyNoticeText}>
                  Departemen, posisi, email, dan status tidak dapat diubah.
                </Text>
              </View>
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  const renderPasswordModal = () => (
    <Modal
      visible={passwordModalVisible}
      animationType="slide"
      transparent
      onRequestClose={() => setPasswordModalVisible(false)}
    >
      <View style={styles.modalOverlay}>
        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          style={[
            styles.keyboardAvoidingView,
            Platform.OS === 'android' && { paddingBottom: keyboardHeight }
          ]}
          keyboardVerticalOffset={0}
        >
          <View style={[styles.modalContainer, { paddingBottom: keyboardVisible ? 0 : Math.max(insets.bottom, 24) }]}>
            {/* Modal Header */}
            <View style={styles.modalHeader}>
              <TouchableOpacity onPress={() => setPasswordModalVisible(false)} disabled={isSavingPassword}>
                <Text style={styles.modalCancel}>Batal</Text>
              </TouchableOpacity>
              <Text style={styles.modalTitle}>Ganti Password</Text>
              <TouchableOpacity onPress={handleChangePassword} disabled={isSavingPassword}>
                {isSavingPassword ? (
                  <ActivityIndicator size="small" color="#10B981" />
                ) : (
                  <Text style={styles.modalSave}>Simpan</Text>
                )}
              </TouchableOpacity>
            </View>

            <ScrollView
              style={styles.modalBody}
              showsVerticalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
            >
              {/* Password Saat Ini */}
              <Text style={styles.fieldLabel}>Password Saat Ini</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={currentPassword}
                  onChangeText={setCurrentPassword}
                  placeholder="Masukkan password saat ini"
                  placeholderTextColor="#c7c7cc"
                  secureTextEntry={!showCurrent}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowCurrent(!showCurrent)} style={styles.eyeButton}>
                  <IconSymbol size={18} name={showCurrent ? 'eye.slash.fill' : 'eye.fill'} color="#86868b" />
                </TouchableOpacity>
              </View>

              {/* Password Baru */}
              <Text style={styles.fieldLabel}>Password Baru</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={newPassword}
                  onChangeText={setNewPassword}
                  placeholder="Minimal 6 karakter"
                  placeholderTextColor="#c7c7cc"
                  secureTextEntry={!showNew}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowNew(!showNew)} style={styles.eyeButton}>
                  <IconSymbol size={18} name={showNew ? 'eye.slash.fill' : 'eye.fill'} color="#86868b" />
                </TouchableOpacity>
              </View>

              {/* Konfirmasi Password */}
              <Text style={styles.fieldLabel}>Konfirmasi Password Baru</Text>
              <View style={styles.passwordInputWrapper}>
                <TextInput
                  style={styles.passwordInput}
                  value={confirmPassword}
                  onChangeText={setConfirmPassword}
                  placeholder="Ulangi password baru"
                  placeholderTextColor="#c7c7cc"
                  secureTextEntry={!showConfirm}
                  autoCapitalize="none"
                />
                <TouchableOpacity onPress={() => setShowConfirm(!showConfirm)} style={styles.eyeButton}>
                  <IconSymbol size={18} name={showConfirm ? 'eye.slash.fill' : 'eye.fill'} color="#86868b" />
                </TouchableOpacity>
              </View>

              {confirmPassword.length > 0 && newPassword !== confirmPassword ? (
                <Text style={styles.passwordMismatch}>Password tidak cocok</Text>
              ) : null}

              <View style={{ height: 10 }} />
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  );

  const renderAvatarModal = () => (
    <Modal
      visible={avatarModalVisible}
      transparent
      animationType="slide"
      onRequestClose={() => {
        if (!isUploadingAvatar) setAvatarModalVisible(false);
      }}
    >
      <View style={styles.avatarModalOverlay}>
        <SafeAreaView style={styles.avatarModalSafeArea}>
          {/* Modal Header */}
          <View style={styles.avatarModalHeader}>
            <Text style={styles.avatarModalHeaderTitle}>
              {avatarPreview ? 'Pratinjau Foto' : 'Foto Profil'}
            </Text>
            <TouchableOpacity
              onPress={() => {
                setAvatarPreview(null);
                setAvatarModalVisible(false);
              }}
              disabled={isUploadingAvatar}
              style={styles.avatarModalCloseButton}
            >
              <IconSymbol size={20} name="xmark" color="#1d1d1f" />
            </TouchableOpacity>
          </View>

          {/* Content */}
          <View style={styles.avatarModalContent}>
            {avatarPreview ? (
              <>
                <View style={styles.previewContainer}>
                  <View style={styles.previewImageWrapper}>
                    <Image
                      source={{ uri: avatarPreview }}
                      style={styles.previewImage}
                    />
                  </View>
                  <Text style={styles.previewLabel}>Pratinjau foto profil Anda</Text>
                </View>

                <View style={styles.avatarModalButtonsContainer}>
                  <TouchableOpacity
                    style={[styles.avatarModalButton, styles.avatarSecondaryButton]}
                    onPress={() => setAvatarPreview(null)}
                    disabled={isUploadingAvatar}
                  >
                    <IconSymbol size={18} name="arrow.counterclockwise" color="#1d1d1f" />
                    <Text style={[styles.avatarModalButtonText, { color: '#1d1d1f' }]}>Ubah Foto</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={[styles.avatarModalButton, styles.avatarPrimaryButton]}
                    onPress={handleSaveAvatar}
                    disabled={isUploadingAvatar}
                  >
                    {isUploadingAvatar ? (
                      <>
                        <ActivityIndicator size="small" color="#FFFFFF" />
                        <Text style={styles.avatarModalButtonText}>Menyimpan...</Text>
                      </>
                    ) : (
                      <>
                        <IconSymbol size={18} name="checkmark.circle.fill" color="#FFFFFF" />
                        <Text style={styles.avatarModalButtonText}>Simpan Foto</Text>
                      </>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            ) : (
              <>
                <View style={styles.avatarOptionsHeader}>
                  <Text style={styles.avatarOptionsTitle}>Pilih sumber foto</Text>
                  <Text style={styles.avatarOptionsDesc}>Ambil foto baru atau pilih dari galeri Anda</Text>
                </View>

                <View style={styles.avatarOptionsContainer}>
                  <TouchableOpacity
                    style={styles.avatarOptionCard}
                    onPress={handleCameraAvatarPhoto}
                    disabled={isUploadingAvatar}
                    activeOpacity={0.7}
                  >
                    <View style={styles.optionIconCircle}>
                      <IconSymbol size={36} name="camera.fill" color="#10B981" />
                    </View>
                    <Text style={styles.optionCardTitle}>Ambil Foto</Text>
                    <Text style={styles.optionCardDesc}>Gunakan kamera perangkat</Text>
                  </TouchableOpacity>

                  <TouchableOpacity
                    style={styles.avatarOptionCard}
                    onPress={handleGalleryAvatarPhoto}
                    disabled={isUploadingAvatar}
                    activeOpacity={0.7}
                  >
                    <View style={styles.optionIconCircle}>
                      <IconSymbol size={36} name="photo.fill.on.rectangle.fill" color="#3B82F6" />
                    </View>
                    <Text style={styles.optionCardTitle}>Pilih dari Galeri</Text>
                    <Text style={styles.optionCardDesc}>Pilih dari foto yang ada</Text>
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>

          {!avatarPreview && (
            <View style={styles.avatarModalFooter}>
              <TouchableOpacity
                style={styles.avatarCancelButton}
                onPress={() => setAvatarModalVisible(false)}
                disabled={isUploadingAvatar}
              >
                <Text style={styles.avatarCancelButtonText}>Batal</Text>
              </TouchableOpacity>
            </View>
          )}
        </SafeAreaView>
      </View>
    </Modal>
  );

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      {renderHeader()}
      {renderEditModal()}
      {renderPasswordModal()}
      {renderAvatarModal()}

      <ScrollView
        ref={scrollViewRef}
        style={styles.scrollView}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: 20 }}
      >
        {/* Profile Card */}
        {renderProfileCard()}

        {/* Action Buttons */}
        {!isLoading && (
          <View style={styles.actionButtonsRow}>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#1d1d1f' }]} onPress={openEditModal}>
              <IconSymbol size={16} name="pencil" color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Edit Profil</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionButton, { backgroundColor: '#3B82F6' }]} onPress={openPasswordModal}>
              <IconSymbol size={16} name="lock.fill" color="#FFFFFF" />
              <Text style={styles.actionButtonText}>Ganti Password</Text>
            </TouchableOpacity>
          </View>
        )}

        {/* Detail Info */}
        {isLoading ? renderInfoSkeleton() : renderInfoSection()}

        {/* Logout Button */}
        <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
          <IconSymbol size={18} name="arrow.right.square.fill" color="#EF4444" />
          <Text style={styles.logoutText}>Logout</Text>
        </TouchableOpacity>

        <Text style={styles.versionText}>Version 1.0.0</Text>
      </ScrollView>
    </SafeAreaView>
  );
}

// ── Small helper component ────────────────────────────────────────────────────
function InfoRow({
  icon,
  label,
  value,
  isLast,
}: {
  icon: any;
  label: string;
  value: string;
  isLast?: boolean;
}) {
  return (
    <View style={[styles.infoRow, isLast && { borderBottomWidth: 0 }]}>
      <View style={styles.infoRowLeft}>
        <View style={styles.menuIcon}>
          <IconSymbol size={16} name={icon} color="#86868b" />
        </View>
        <Text style={styles.infoLabel}>{label}</Text>
      </View>
      <Text style={styles.infoValue} numberOfLines={2}>{value}</Text>
    </View>
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
  profileCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 20,
    marginHorizontal: 20,
    marginTop: 20,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  avatarContainer: {
    position: 'relative',
    marginBottom: 12,
  },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#1d1d1f',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarText: {
    fontSize: 32,
    fontWeight: '700',
    color: '#FFFFFF',
  },
  avatarOverlay: {
    position: 'absolute',
    bottom: 0,
    right: 0,
    backgroundColor: 'rgba(0, 0, 0, 0.7)',
    width: 28,
    height: 28,
    borderRadius: 14,
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  avatarModalSafeArea: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    overflow: 'hidden',
  },
  avatarModalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  avatarModalHeaderTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    letterSpacing: -0.3,
  },
  avatarModalCloseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
  },
  avatarModalContent: {
    flex: 1,
    paddingHorizontal: 20,
    paddingVertical: 24,
  },
  previewContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  previewImageWrapper: {
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 5,
  },
  previewImage: {
    width: 220,
    height: 220,
    borderRadius: 110,
    backgroundColor: '#f5f5f7',
  },
  previewLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#86868b',
    textAlign: 'center',
  },
  avatarOptionsHeader: {
    marginBottom: 24,
  },
  avatarOptionsTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 6,
  },
  avatarOptionsDesc: {
    fontSize: 13,
    color: '#86868b',
    lineHeight: 19,
  },
  avatarOptionsContainer: {
    gap: 12,
    marginBottom: 20,
  },
  avatarOptionCard: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#e5e5ea',
    borderRadius: 16,
    paddingVertical: 20,
    paddingHorizontal: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  optionIconCircle: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 12,
  },
  optionCardTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 4,
  },
  optionCardDesc: {
    fontSize: 12,
    color: '#86868b',
    textAlign: 'center',
  },
  avatarModalButtonsContainer: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 12,
  },
  avatarModalButton: {
    flex: 1,
    flexDirection: 'row',
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  avatarPrimaryButton: {
    backgroundColor: '#10B981',
  },
  avatarSecondaryButton: {
    backgroundColor: '#f5f5f7',
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  avatarModalButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  avatarModalFooter: {
    paddingHorizontal: 20,
    paddingVertical: 12,
  },
  avatarCancelButton: {
    paddingVertical: 14,
    alignItems: 'center',
    backgroundColor: '#f5f5f7',
    borderRadius: 12,
  },
  avatarCancelButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  userName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#1d1d1f',
    marginBottom: 4,
  },
  userEmail: {
    fontSize: 13,
    color: '#86868b',
    marginBottom: 12,
  },
  chipsRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'center',
    gap: 6,
  },
  userInfoChip: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f7',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 20,
    gap: 4,
  },
  userInfoText: {
    fontSize: 12,
    color: '#86868b',
    fontWeight: '500',
  },
  actionButtonsRow: {
    flexDirection: 'row',
    marginHorizontal: 20,
    marginTop: 14,
    gap: 10,
  },
  actionButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 10,
    paddingVertical: 12,
    gap: 7,
  },
  actionButtonText: {
    fontSize: 13,
    fontWeight: '600',
    color: '#FFFFFF',
  },
  passwordInputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#e5e5ea',
    paddingRight: 4,
  },
  passwordInput: {
    flex: 1,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1d1d1f',
  },
  eyeButton: {
    padding: 8,
  },
  passwordMismatch: {
    fontSize: 12,
    color: '#EF4444',
    marginTop: 6,
    marginLeft: 4,
  },
  section: {
    paddingHorizontal: 20,
    marginTop: 20,
    marginBottom: 4,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '500',
    color: '#86868b',
    marginBottom: 10,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  menuContainer: {
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  menuIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    backgroundColor: '#f5f5f7',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 14,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  infoRowLeft: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '500',
    color: '#1d1d1f',
  },
  infoValue: {
    fontSize: 13,
    color: '#86868b',
    maxWidth: '50%',
    textAlign: 'right',
  },
  logoutButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FFFFFF',
    borderRadius: 12,
    padding: 14,
    marginHorizontal: 20,
    marginTop: 20,
    marginBottom: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  logoutText: {
    fontSize: 15,
    fontWeight: '500',
    color: '#EF4444',
  },
  versionText: {
    fontSize: 11,
    color: '#86868b',
    textAlign: 'center',
    marginBottom: 20,
  },
  // ── Modal ──────────────────────────────────────────────────────────────────
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  keyboardAvoidingView: {
    flex: 1,
    justifyContent: 'flex-end',
  },
  modalContainer: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    maxHeight: '85%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingVertical: 16,
    borderBottomWidth: 1,
    borderBottomColor: '#e5e5ea',
  },
  modalTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1d1d1f',
  },
  modalCancel: {
    fontSize: 15,
    color: '#86868b',
  },
  modalSave: {
    fontSize: 15,
    fontWeight: '600',
    color: '#10B981',
  },
  modalBody: {
    padding: 20,
    paddingBottom: 8,
  },
  fieldLabel: {
    fontSize: 12,
    fontWeight: '500',
    color: '#86868b',
    marginBottom: 6,
    marginTop: 14,
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  fieldInput: {
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 15,
    color: '#1d1d1f',
    borderWidth: 1,
    borderColor: '#e5e5ea',
  },
  fieldInputMultiline: {
    minHeight: 80,
    paddingTop: 12,
  },
  readonlyNotice: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 16,
    marginBottom: 8,
    backgroundColor: '#f5f5f7',
    borderRadius: 10,
    padding: 12,
  },
  readonlyNoticeText: {
    fontSize: 12,
    color: '#86868b',
    flex: 1,
    lineHeight: 18,
  },
  // ── Skeleton Loader ────────────────────────────────────────────────────
  skeleton: {
    backgroundColor: '#E5E7EB',
    overflow: 'hidden',
  },
  skeletonIcon: {
    width: 34,
    height: 34,
    borderRadius: 17,
    marginRight: 12,
  },
  skeletonLabel: {
    width: '60%',
    height: 12,
    borderRadius: 4,
    marginBottom: 6,
  },
  skeletonValue: {
    width: '80%',
    height: 14,
    borderRadius: 4,
  },
});