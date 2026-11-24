import React, { useState, useRef, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TextInput,
  TouchableOpacity,
  Animated,
  Platform,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
  Image,
  ActivityIndicator,
  Easing,
} from 'react-native';
import { showToast, showDialog } from '@/utils/alert';
import { SafeAreaView } from 'react-native-safe-area-context';
import { StatusBar } from 'expo-status-bar';
import { API_BASE_URL } from '@/config/api.config';
import { useRouter } from 'expo-router';
import { IconSymbol } from '@/components/ui/icon-symbol';
import { authAPI } from '@/services/api';
import { reconnectSocket } from '@/services/socketService';
import {
  registerPushTokenAfterLogin,
  requestNotificationPermissionWithUI as requestNotificationPermissionWithFallback,
} from '@/services/notificationService';
import AsyncStorage from '@react-native-async-storage/async-storage';
import axios from 'axios';

export default function LoginScreen() {
  const router = useRouter();
  const scrollViewRef = useRef<ScrollView>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [emailError, setEmailError] = useState('');
  const [passwordError, setPasswordError] = useState('');

  // Spinner animation
  const spinAnim = useRef(new Animated.Value(0)).current;
  const spinLoop = useRef<Animated.CompositeAnimation | null>(null);

  const startSpin = () => {
    spinAnim.setValue(0);
    spinLoop.current = Animated.loop(
      Animated.timing(spinAnim, {
        toValue: 1,
        duration: 800,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinLoop.current.start();
  };

  const stopSpin = () => {
    spinLoop.current?.stop();
    spinAnim.setValue(0);
  };

  const spinInterpolate = spinAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['0deg', '360deg'],
  });

  // Load saved credentials on mount
  React.useEffect(() => {
    loadSavedCredentials();
  }, []);

  const loadSavedCredentials = async () => {
    try {
      const savedRememberMe = await AsyncStorage.getItem('rememberMe');
      const savedEmail = await AsyncStorage.getItem('savedEmail');
      const savedPassword = await AsyncStorage.getItem('savedPassword');

      if (savedRememberMe === 'true' && savedEmail && savedPassword) {
        setRememberMe(true);
        setEmail(savedEmail);
        setPassword(savedPassword);
      }
    } catch (error) {
      console.error('Error loading saved credentials:', error);
    }
  };

  const saveCredentials = async () => {
    try {
      if (rememberMe) {
        await AsyncStorage.setItem('rememberMe', 'true');
        await AsyncStorage.setItem('savedEmail', email);
        await AsyncStorage.setItem('savedPassword', password);
      } else {
        await AsyncStorage.removeItem('rememberMe');
        await AsyncStorage.removeItem('savedEmail');
        await AsyncStorage.removeItem('savedPassword');
      }
    } catch (error) {
      console.error('Error saving credentials:', error);
    }
  };

  // Handle focus untuk scroll ke input yang aktif
  const handleInputFocus = (offsetY: number = 0) => {
    setTimeout(() => {
      scrollViewRef.current?.scrollTo({
        y: offsetY,
        animated: true,
      });
    }, 300);
  };

  // Handle keyboard hide untuk kembali ke posisi awal
  const keyboardOffset = useRef(new Animated.Value(0)).current;

  React.useEffect(() => {
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

  // Validasi email
  const validateEmail = (emailStr: string) => {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    let error = '';

    if (emailStr && !emailRegex.test(emailStr)) {
      error = 'Please enter a valid email address';
    }

    setEmailError(error);
    return emailRegex.test(emailStr) || !emailStr;
  };

  const handleEmailChange = (emailStr: string) => {
    setEmail(emailStr);
    // Update error message on each change
    if (emailStr) {
      validateEmail(emailStr);
    } else {
      setEmailError('');
    }
  };

  // Validasi password
  const validatePassword = (pwd: string) => {
    const hasMinLength = pwd.length >= 8;
    const hasLetter = /[a-zA-Z]/.test(pwd);
    const hasNumber = /\d/.test(pwd);

    let error = '';
    if (pwd && !hasMinLength) {
      error = 'Password must be at least 8 characters';
    } else if (pwd && !hasLetter) {
      error = 'Password must contain at least one letter';
    } else if (pwd && !hasNumber) {
      error = 'Password must contain at least one number';
    }

    setPasswordError(error);
    return hasMinLength && hasLetter && hasNumber;
  };

  const handlePasswordChange = (pwd: string) => {
    setPassword(pwd);
    // Update error message on each change
    if (pwd) {
      validatePassword(pwd);
    } else {
      setPasswordError('');
    }
  };

  // Test API connectivity
  const testAPIConnection = async () => {
    try {
      console.log(`Testing connection to ${API_BASE_URL.replace('/api', '')}`);
      const response = await axios.get(`${API_BASE_URL.replace('/api', '')}/health`, {
        timeout: 5000,
      });
      console.log('Connection test successful:', response.data);
      showToast('Backend Express sedang berjalan.', 'success');
      return true;
    } catch (error: any) {
      console.log('Connection test failed:', error.message);
      let message = `Cannot connect to ${API_BASE_URL}\n\n`;

      if (error.code === 'ECONNREFUSED') {
        message += 'Backend Express is not running. Start it with:\ncd backend-express\nnpm run dev';
      } else if (error.code === 'ECONNABORTED') {
        message += 'Connection timeout. Backend may be overloaded or server is down.';
      } else if (error.message === 'Network Error') {
        message += 'Network unreachable. Check if device and server are on same network.';
      } else {
        message += `Error: ${error.message}`;
      }

      showToast(message, 'error');
      return false;
    }
  };

  const handleLogin = async () => {
    // Validasi input
    if (!email || !password) {
      showToast('Harap isi semua kolom', 'warning');
      return;
    }

    // Validasi email format
    if (!validateEmail(email)) {
      showToast('Masukkan alamat email yang valid', 'warning');
      return;
    }

    // Don't validate password complexity on login - only check if it's not empty

    setIsLoading(true);
    startSpin();
    try {
      console.log(`Attempting login to ${API_BASE_URL}`);

      // Call login with explicit 12-second timeout
      const response = await authAPI.login(email, password, 12000);
      // 🔥 SIMPAN TOKEN
      await AsyncStorage.setItem("userToken", response.token);

      console.log('Login successful:', response);

      // Save credentials if Remember Me is checked
      await saveCredentials();

      // Register push token with backend
      console.log('📱 Registering push token with backend...');
      const tokenResult = await registerPushTokenAfterLogin();

      if (!tokenResult.success) {
        console.warn('⚠️ Push token registration failed:', tokenResult.error);
        // Try requesting permission again as fallback (in case it was denied at first launch)
        const permGranted = await requestNotificationPermissionWithFallback();
        if (permGranted) {
          // Retry registering token after permission granted
          const retryResult = await registerPushTokenAfterLogin();
          if (!retryResult.success) {
            console.warn('⚠️ Push token still failed after retry:', retryResult.error);
          } else {
            console.log('✅ Push token registered after retry');
          }
        } else {
          // Notify user - but don't block login
          showDialog(
            'Notifikasi Dinonaktifkan',
            'Aktifkan notifikasi di Pengaturan agar bisa menerima tugas baru secara langsung.',
            [
              { text: 'Nanti', style: 'cancel' },
              {
                text: 'Buka Pengaturan',
                onPress: () => {
                  const { Linking } = require('react-native');
                  Linking.openSettings();
                },
              },
            ]
          );
        }
      } else {
        console.log('✅ Push token registered successfully');
      }

      // Initialize Socket.io connection for real-time notifications
      console.log('🔌 Connecting Socket.io after login...');
      await reconnectSocket();

      // Navigate ke tabs
      router.replace('/(tabs)');
    } catch (error: any) {
      console.error('Login error:', error);

      const isTimeout =
        error.code === 'ECONNABORTED' ||
        error.message?.toLowerCase().includes('timeout');
      const isNoInternet =
        error.message === 'Network Error' ||
        error.code === 'ERR_NETWORK' ||
        error.message?.toLowerCase().includes('network error');
      const isServerDown =
        error.code === 'ECONNREFUSED' ||
        error.message?.toLowerCase().includes('cannot connect');
      const isServerError =
        error.response?.status >= 500;

      if (isNoInternet) {
        showDialog(
          '📵 Tidak Ada Koneksi Internet',
          'Periksa koneksi Wi-Fi atau data seluler Anda, lalu coba lagi.',
          [
            { text: 'OK', style: 'default' },
          ]
        );
      } else if (isTimeout) {
        showDialog(
          '⏱ Server Tidak Merespons',
          'Permintaan login melebihi batas waktu (12 detik). Server mungkin sedang sibuk atau tidak dapat dijangkau.',
          [
            { text: 'Coba Lagi', onPress: handleLogin },
            { text: 'Batal', style: 'cancel' },
          ]
        );
      } else if (isServerDown) {
        showDialog(
          '🔌 Server Tidak Dapat Dijangkau',
          `Tidak dapat terhubung ke server (${API_BASE_URL}).\n\nPastikan:\n• Koneksi internet aktif\n• Server sedang berjalan\n• IP server sudah benar`,
          [
            { text: 'Coba Lagi', onPress: handleLogin },
            { text: 'Batal', style: 'cancel' },
          ]
        );
      } else if (isServerError) {
        showDialog(
          '⚠️ Server Bermasalah',
          'Server sedang mengalami gangguan internal. Coba beberapa saat lagi.',
          [{ text: 'OK', style: 'default' }]
        );
      } else {
        // Wrong credentials or validation error
        const msg =
          error.response?.data?.message ||
          error.message ||
          'Email atau password salah. Periksa kembali dan coba lagi.';
        showToast(msg, 'error');
      }
    } finally {
      setIsLoading(false);
      stopSpin();
    }
  };

  return (
    <SafeAreaView style={styles.container} edges={['top', 'left', 'right']}>
      <StatusBar style="light" />
      {/* Decorative Background */}
      <View style={styles.backgroundDecor}>
        <View style={[styles.circle, styles.circleTop]} />
        <View style={[styles.circle, styles.circleBottom]} />
      </View>

      {/* Form Section with Keyboard Handling */}
      <View style={styles.keyboardView}>
        <TouchableWithoutFeedback onPress={Keyboard.dismiss}>
          <ScrollView
            ref={scrollViewRef}
            style={styles.scrollView}
            contentContainerStyle={[styles.scrollViewContent]}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
            bounces={false}
          >
            {/* Header Section - Will scroll up with keyboard */}
            <View style={styles.header}>
              <View style={styles.logoContainer}>
                <Image
                  source={require('../assets/images/C-Track.png')}
                  style={styles.logoImage}
                  resizeMode="contain"
                />
              </View>
              <Text style={styles.appTitle}>C-TRACK</Text>
              <Text style={styles.subtitle}>Task Tracking System</Text>
            </View>

            {/* Login Form */}
            <View style={styles.formContainer}>
              <Text style={styles.welcomeText}>Welcome Back!</Text>
              <Text style={styles.loginSubtext}>Sign in to continue tracking</Text>

              {/* Email Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Email Address</Text>
                <View style={[styles.inputWrapper, emailError && styles.inputWrapperError]}>
                  <IconSymbol size={20} name="envelope.fill" color="#6B7280" />
                  <TextInput
                    style={styles.input}
                    placeholder="you@example.com"
                    placeholderTextColor="#9CA3AF"
                    value={email}
                    onChangeText={handleEmailChange}
                    onFocus={() => handleInputFocus(200)}
                    keyboardType="email-address"
                    autoCapitalize="none"
                    editable={!isLoading}
                  />
                </View>
                {emailError && (
                  <View style={styles.errorContainer}>
                    <IconSymbol size={14} name="exclamationmark.circle.fill" color="#EF4444" />
                    <Text style={styles.errorText}>{emailError}</Text>
                  </View>
                )}
              </View>

              {/* Password Input */}
              <View style={styles.inputContainer}>
                <Text style={styles.inputLabel}>Password</Text>
                <View style={[styles.inputWrapper, passwordError && styles.inputWrapperError]}>
                  <IconSymbol size={20} name="lock.fill" color="#6B7280" />
                  <TextInput
                    style={styles.input}
                    placeholder="Password"
                    placeholderTextColor="#6B7280"
                    value={password}
                    onChangeText={handlePasswordChange}
                    onFocus={() => handleInputFocus(300)}
                    secureTextEntry={!showPassword}
                    autoCapitalize="none"
                    editable={!isLoading}
                  />
                  <TouchableOpacity
                    onPress={() => setShowPassword(!showPassword)}
                    style={styles.eyeIcon}
                    disabled={isLoading}
                  >
                    <IconSymbol
                      size={20}
                      name={showPassword ? 'eye.fill' : 'eye'}
                      color="#6B7280"
                    />
                  </TouchableOpacity>
                </View>
                {passwordError && (
                  <View style={styles.errorContainer}>
                    <IconSymbol size={14} name="exclamationmark.circle.fill" color="#EF4444" />
                    <Text style={styles.errorText}>{passwordError}</Text>
                  </View>
                )}
              </View>

              {/* Remember Me & Forgot Password */}
              <View style={styles.optionsRow}>
                <TouchableOpacity
                  style={styles.rememberMeContainer}
                  onPress={async () => {
                    const newRememberMe = !rememberMe;
                    setRememberMe(newRememberMe);
                    // Clear saved credentials immediately if unchecked
                    if (!newRememberMe) {
                      try {
                        await AsyncStorage.removeItem('rememberMe');
                        await AsyncStorage.removeItem('savedEmail');
                        await AsyncStorage.removeItem('savedPassword');
                      } catch (error) {
                        console.error('Error clearing credentials:', error);
                      }
                    }
                  }}
                  disabled={isLoading}
                >
                  <View style={[styles.checkbox, rememberMe && styles.checkboxActive]}>
                    {rememberMe && <IconSymbol size={14} name="checkmark" color="#FFFFFF" />}
                  </View>
                  <Text style={styles.rememberMeText}>Remember me</Text>
                </TouchableOpacity>

                <TouchableOpacity disabled={isLoading}>
                  <Text style={styles.forgotPasswordText}>Forgot Password?</Text>
                </TouchableOpacity>
              </View>

              {/* Login Button */}
              <TouchableOpacity
                style={[styles.loginButton, isLoading && styles.loginButtonDisabled]}
                onPress={handleLogin}
                disabled={isLoading}
              >
                {isLoading ? (
                  <View style={styles.loadingRow}>
                    <Animated.View style={{ transform: [{ rotate: spinInterpolate }], marginRight: 10 }}>
                      <ActivityIndicator size="small" color="#FFFFFF" />
                    </Animated.View>
                    <Text style={styles.loginButtonText}>Signing In...</Text>
                  </View>
                ) : (
                  <>
                    <Text style={styles.loginButtonText}>Sign In</Text>
                    <IconSymbol size={20} name="arrow.right" color="#FFFFFF" />
                  </>
                )}
              </TouchableOpacity>
            </View>
          </ScrollView>
        </TouchableWithoutFeedback>
        <Animated.View style={{ height: keyboardOffset }} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#1F2937',
  },
  keyboardView: {
    flex: 1,
  },
  scrollView: {
    flex: 1,
  },
  scrollViewContent: {
    flexGrow: 1,
  },
  backgroundDecor: {
    position: 'absolute',
    width: '100%',
    height: '100%',
  },
  circle: {
    position: 'absolute',
    borderRadius: 1000,
    backgroundColor: 'rgba(255, 255, 255, 0.05)',
  },
  circleTop: {
    width: 300,
    height: 300,
    top: -150,
    right: -100,
  },
  circleBottom: {
    width: 250,
    height: 250,
    bottom: -100,
    left: -80,
  },
  header: {
    alignItems: 'center',
    paddingTop: 40,
    paddingBottom: 30,
  },
  logoContainer: {
    marginBottom: 20,
  },
  logoImage: {
    width: 100,
    height: 100,
    borderRadius: 24,
  },
  appTitle: {
    fontSize: 28,
    fontWeight: '700',
    color: '#FFFFFF',
    letterSpacing: 2,
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    color: '#9CA3AF',
    fontWeight: '500',
  },
  formContainer: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 30,
    borderTopRightRadius: 30,
    paddingHorizontal: 24,
    paddingTop: 40,
    paddingBottom: 20,
  },
  welcomeText: {
    fontSize: 24,
    fontWeight: '700',
    color: '#1F2937',
    marginBottom: 8,
  },
  loginSubtext: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 30,
  },
  inputContainer: {
    marginBottom: 20,
  },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#374151',
    marginBottom: 8,
  },
  inputWrapper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#F9FAFB',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  input: {
    flex: 1,
    marginLeft: 12,
    fontSize: 16,
    color: '#1F2937',
  },
  eyeIcon: {
    padding: 4,
  },
  inputWrapperError: {
    borderColor: '#FCA5A5',
    backgroundColor: '#FEF2F2',
  },
  errorContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 8,
    paddingHorizontal: 4,
  },
  errorText: {
    fontSize: 12,
    color: '#EF4444',
    fontWeight: '500',
  },
  optionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 30,
  },
  rememberMeContainer: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  checkbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: '#D1D5DB',
    marginRight: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  checkboxActive: {
    backgroundColor: '#1A1A1A',
    borderColor: '#1A1A1A',
  },
  rememberMeText: {
    fontSize: 14,
    color: '#6B7280',
  },
  forgotPasswordText: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '600',
  },
  loginButton: {
    flexDirection: 'row',
    backgroundColor: '#111111',
    borderRadius: 12,
    paddingVertical: 16,
    justifyContent: 'center',
    alignItems: 'center',
    marginTop: 10,
    shadowColor: '#000000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.45,
    shadowRadius: 10,
    elevation: 8,
  },
  loginButtonDisabled: {
    opacity: 0.6,
  },
  loginButtonText: {
    fontSize: 16,
    fontWeight: '700',
    color: '#FFFFFF',
    marginRight: 8,
  },
  loadingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 25,
  },
  dividerLine: {
    flex: 1,
    height: 1,
    backgroundColor: '#E5E7EB',
  },
  dividerText: {
    fontSize: 12,
    color: '#9CA3AF',
    marginHorizontal: 16,
  },
  socialButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 16,
    marginBottom: 30,
  },
  socialButton: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#F9FAFB',
    borderWidth: 1,
    borderColor: '#E5E7EB',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpContainer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
  },
  signUpText: {
    fontSize: 14,
    color: '#6B7280',
  },
  signUpLink: {
    fontSize: 14,
    color: '#1A1A1A',
    fontWeight: '700',
  },
});
