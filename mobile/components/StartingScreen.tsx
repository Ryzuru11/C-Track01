import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
    Alert,
    Animated,
    Dimensions,
    Easing,
    Image,
    Linking,
    Platform,
    ScrollView,
    StyleSheet,
    Text,
    TouchableOpacity,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import * as Device from 'expo-device';
import * as ImagePicker from 'expo-image-picker';
import * as IntentLauncher from 'expo-intent-launcher';
import * as Location from 'expo-location';
import * as Notifications from 'expo-notifications';
import AsyncStorage from '@react-native-async-storage/async-storage';

const { width, height } = Dimensions.get('window');
const APP_PACKAGE = 'com.lifemedia.trackingapp';
const BATTERY_OPT_ASKED_KEY = 'batteryOptimizationAsked';

type PermStatus = 'pending' | 'granted' | 'denied';

interface PermItem {
    key: string;
    label: string;
    desc: string;
    emoji: string;
    status: PermStatus;
}

interface StartingScreenProps {
    onFinish: () => void;
}

const INITIAL_PERMS: PermItem[] = [
    {
        key: 'location',
        label: 'Lokasi',
        desc: 'Untuk pelacakan tugas secara real-time',
        emoji: '📍',
        status: 'pending',
    },
    {
        key: 'background_location',
        label: 'Lokasi Latar Belakang',
        desc: 'Pilih "Izinkan Sepanjang Waktu" agar tracking tetap berjalan',
        emoji: '🗺️',
        status: 'pending',
    },
    {
        key: 'camera',
        label: 'Kamera',
        desc: 'Untuk mengambil foto laporan',
        emoji: '📷',
        status: 'pending',
    },
    {
        key: 'notification',
        label: 'Notifikasi',
        desc: 'Untuk menerima update tugas terbaru',
        emoji: '🔔',
        status: 'pending',
    },
    {
        key: 'battery',
        label: 'Baterai Tidak Dibatasi',
        desc: 'Agar tracking tidak terhenti saat layar mati',
        emoji: '🔋',
        status: 'pending',
    },
];

export default function StartingScreen({ onFinish }: StartingScreenProps) {
    const [perms, setPerms] = useState<PermItem[]>(INITIAL_PERMS);
    const [phase, setPhase] = useState<'welcome' | 'requesting' | 'done'>('welcome');

    // --- animations ---
    const containerOp = useRef(new Animated.Value(0)).current;
    const mascotScale = useRef(new Animated.Value(0.45)).current;
    const mascotOp = useRef(new Animated.Value(0)).current;
    const mascotBounce = useRef(new Animated.Value(0)).current;
    const contentOp = useRef(new Animated.Value(0)).current;
    const contentSlide = useRef(new Animated.Value(50)).current;
    const screenFade = useRef(new Animated.Value(1)).current;
    const bounceLoop = useRef<Animated.CompositeAnimation | null>(null);

    useEffect(() => {
        Animated.sequence([
            // 1. Fade in container
            Animated.timing(containerOp, {
                toValue: 1,
                duration: 350,
                useNativeDriver: true,
            }),
            // 2. Mascot pop in
            Animated.parallel([
                Animated.spring(mascotScale, {
                    toValue: 1,
                    tension: 55,
                    friction: 7,
                    useNativeDriver: true,
                }),
                Animated.timing(mascotOp, {
                    toValue: 1,
                    duration: 400,
                    useNativeDriver: true,
                }),
            ]),
            // 3. Content slide up
            Animated.parallel([
                Animated.timing(contentOp, {
                    toValue: 1,
                    duration: 420,
                    useNativeDriver: true,
                }),
                Animated.timing(contentSlide, {
                    toValue: 0,
                    duration: 420,
                    easing: Easing.out(Easing.back(1.1)),
                    useNativeDriver: true,
                }),
            ]),
        ]).start(() => {
            // Idle bounce loop
            bounceLoop.current = Animated.loop(
                Animated.sequence([
                    Animated.timing(mascotBounce, {
                        toValue: -10,
                        duration: 1300,
                        easing: Easing.inOut(Easing.sin),
                        useNativeDriver: true,
                    }),
                    Animated.timing(mascotBounce, {
                        toValue: 0,
                        duration: 1300,
                        easing: Easing.inOut(Easing.sin),
                        useNativeDriver: true,
                    }),
                ])
            );
            bounceLoop.current.start();
        });

        return () => {
            bounceLoop.current?.stop();
        };
    }, []);

    const requestAllPermissions = useCallback(async () => {
        setPhase('requesting');

        // 1. Foreground Location
        let fgGranted = false;
        try {
            const res = await Location.requestForegroundPermissionsAsync();
            fgGranted = res.status === 'granted';
            setPerms(prev =>
                prev.map(p =>
                    p.key === 'location'
                        ? { ...p, status: fgGranted ? 'granted' : 'denied' }
                        : p
                )
            );
        } catch {
            setPerms(prev =>
                prev.map(p => (p.key === 'location' ? { ...p, status: 'denied' } : p))
            );
        }

        // 2. Background Location — requires foreground first.
        // On Android 11+ the system takes the user to Settings to select
        // "Izinkan Sepanjang Waktu" (Allow all the time).
        if (fgGranted) {
            try {
                const bgRes = await Location.requestBackgroundPermissionsAsync();
                setPerms(prev =>
                    prev.map(p =>
                        p.key === 'background_location'
                            ? { ...p, status: bgRes.status === 'granted' ? 'granted' : 'denied' }
                            : p
                    )
                );
            } catch {
                setPerms(prev =>
                    prev.map(p =>
                        p.key === 'background_location' ? { ...p, status: 'denied' } : p
                    )
                );
            }
        } else {
            // Foreground denied → background cannot be granted
            setPerms(prev =>
                prev.map(p =>
                    p.key === 'background_location' ? { ...p, status: 'denied' } : p
                )
            );
        }

        // 3. Camera
        try {
            const res = await ImagePicker.requestCameraPermissionsAsync();
            setPerms(prev =>
                prev.map(p =>
                    p.key === 'camera'
                        ? { ...p, status: res.status === 'granted' ? 'granted' : 'denied' }
                        : p
                )
            );
        } catch {
            setPerms(prev =>
                prev.map(p => (p.key === 'camera' ? { ...p, status: 'denied' } : p))
            );
        }

        // 4. Notifications
        try {
            if (Device.isDevice) {
                const { status: existing } = await Notifications.getPermissionsAsync();
                let finalStatus = existing;
                if (existing !== 'granted') {
                    const { status } = await Notifications.requestPermissionsAsync();
                    finalStatus = status;
                }
                setPerms(prev =>
                    prev.map(p =>
                        p.key === 'notification'
                            ? { ...p, status: finalStatus === 'granted' ? 'granted' : 'denied' }
                            : p
                    )
                );
            } else {
                setPerms(prev =>
                    prev.map(p => (p.key === 'notification' ? { ...p, status: 'granted' } : p))
                );
            }
        } catch {
            setPerms(prev =>
                prev.map(p => (p.key === 'notification' ? { ...p, status: 'denied' } : p))
            );
        }

        // 5. Battery Optimization — Android only.
        // Show a pre-dialog (like Life360) explaining why, then open the system
        // "REQUEST_IGNORE_BATTERY_OPTIMIZATIONS" intent which lets the user
        // tap "Tidak Dibatasi" (Unrestricted) directly.
        if (Platform.OS === 'android') {
            await new Promise<void>((resolve) => {
                Alert.alert(
                    'Izinkan App Berjalan di Latar Belakang?',
                    'C-Track perlu berjalan tanpa batasan baterai agar pelacakan lokasi tetap aktif saat layar mati atau app diminimize.\n\nPilih "Tidak Dibatasi" di halaman berikutnya.',
                    [
                        {
                            text: 'Lewati',
                            style: 'cancel',
                            onPress: () => {
                                setPerms(prev =>
                                    prev.map(p =>
                                        p.key === 'battery' ? { ...p, status: 'denied' } : p
                                    )
                                );
                                resolve();
                            },
                        },
                        {
                            text: 'Izinkan',
                            onPress: async () => {
                                try {
                                    await IntentLauncher.startActivityAsync(
                                        'android.settings.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS',
                                        { data: `package:${APP_PACKAGE}` }
                                    );
                                    // Optimistically mark granted — user saw the settings page
                                    setPerms(prev =>
                                        prev.map(p =>
                                            p.key === 'battery' ? { ...p, status: 'granted' } : p
                                        )
                                    );
                                } catch (e) {
                                    console.warn('Battery optimization request failed:', e);
                                    setPerms(prev =>
                                        prev.map(p =>
                                            p.key === 'battery' ? { ...p, status: 'denied' } : p
                                        )
                                    );
                                }
                                resolve();
                            },
                        },
                    ],
                    { cancelable: false }
                );
            });
            await AsyncStorage.setItem(BATTERY_OPT_ASKED_KEY, 'true');
        } else {
            // iOS — battery optimization not applicable
            setPerms(prev =>
                prev.map(p => (p.key === 'battery' ? { ...p, status: 'granted' } : p))
            );
        }

        setPhase('done');
    }, []);

    const handleFinish = useCallback(() => {
        bounceLoop.current?.stop();
        Animated.timing(screenFade, {
            toValue: 0,
            duration: 450,
            easing: Easing.in(Easing.quad),
            useNativeDriver: true,
        }).start(() => onFinish());
    }, [onFinish]);

    const hasDenied = perms.some(p => p.status === 'denied');
    const allGranted = perms.every(p => p.status === 'granted');

    return (
        <Animated.View
            style={[styles.wrapper, { opacity: Animated.multiply(containerOp, screenFade) }]}
        >
            <LinearGradient
                colors={['#0a0a0a', '#111118', '#1a1a2e']}
                start={{ x: 0.1, y: 0 }}
                end={{ x: 0.9, y: 1 }}
                style={styles.gradient}
            >
                <ScrollView
                    contentContainerStyle={styles.scroll}
                    showsVerticalScrollIndicator={false}
                    bounces={false}
                >
                    {/* Mascot */}
                    <Animated.View
                        style={[
                            styles.mascotWrap,
                            {
                                opacity: mascotOp,
                                transform: [
                                    { scale: mascotScale },
                                    { translateY: mascotBounce },
                                ],
                            },
                        ]}
                    >
                        <Image
                            source={require('../assets/images/ctrack maskot.png')}
                            style={styles.mascot}
                            resizeMode="contain"
                        />
                    </Animated.View>

                    {/* Title */}
                    <Animated.View
                        style={[
                            styles.titleSection,
                            { opacity: contentOp, transform: [{ translateY: contentSlide }] },
                        ]}
                    >
                        <Text style={styles.welcome}>Selamat Datang di</Text>
                        <Text style={styles.appName}>C-Track</Text>
                        <Text style={styles.tagline}>TASK TRACKING SYSTEM</Text>
                    </Animated.View>

                    {/* Permission cards */}
                    <Animated.View
                        style={[
                            styles.permSection,
                            { opacity: contentOp, transform: [{ translateY: contentSlide }] },
                        ]}
                    >
                        <Text style={styles.permSectionTitle}>Izin yang Diperlukan</Text>
                        {perms.map(perm => (
                            <View key={perm.key} style={styles.permCard}>
                                <Text style={styles.permEmoji}>{perm.emoji}</Text>
                                <View style={styles.permInfoCol}>
                                    <Text style={styles.permLabel}>{perm.label}</Text>
                                    <Text style={styles.permDesc}>{perm.desc}</Text>
                                </View>
                                <View
                                    style={[
                                        styles.permBadge,
                                        perm.status === 'granted'
                                            ? styles.badgeGranted
                                            : perm.status === 'denied'
                                            ? styles.badgeDenied
                                            : styles.badgePending,
                                    ]}
                                >
                                    <Text style={styles.badgeText}>
                                        {perm.status === 'granted'
                                            ? '✓'
                                            : perm.status === 'denied'
                                            ? '✕'
                                            : '·'}
                                    </Text>
                                </View>
                            </View>
                        ))}
                    </Animated.View>

                    {/* Action buttons */}
                    <Animated.View style={[styles.actions, { opacity: contentOp }]}>
                        {phase === 'welcome' && (
                            <TouchableOpacity
                                style={styles.primaryBtn}
                                onPress={requestAllPermissions}
                                activeOpacity={0.85}
                            >
                                <Text style={styles.primaryBtnText}>🚀  Mulai & Berikan Izin</Text>
                            </TouchableOpacity>
                        )}

                        {phase === 'requesting' && (
                            <View style={styles.requestingRow}>
                                <Text style={styles.requestingText}>Meminta izin…</Text>
                            </View>
                        )}

                        {phase === 'done' && (
                            <>
                                {hasDenied && (
                                    <TouchableOpacity
                                        style={styles.settingsBtn}
                                        onPress={() => Linking.openSettings()}
                                        activeOpacity={0.85}
                                    >
                                        <Text style={styles.settingsBtnText}>⚙️  Buka Pengaturan</Text>
                                    </TouchableOpacity>
                                )}
                                <TouchableOpacity
                                    style={[
                                        styles.primaryBtn,
                                        hasDenied && styles.primaryBtnMuted,
                                    ]}
                                    onPress={handleFinish}
                                    activeOpacity={0.85}
                                >
                                    <Text style={styles.primaryBtnText}>
                                        {allGranted ? '✅  Lanjutkan' : 'Lanjutkan  →'}
                                    </Text>
                                </TouchableOpacity>
                            </>
                        )}
                    </Animated.View>
                </ScrollView>
            </LinearGradient>
        </Animated.View>
    );
}

const styles = StyleSheet.create({
    wrapper: {
        position: 'absolute',
        top: 0,
        left: 0,
        width,
        height,
        zIndex: 9998, // below CustomSplash (9999), above app content
    },
    gradient: {
        flex: 1,
    },
    scroll: {
        flexGrow: 1,
        alignItems: 'center',
        paddingTop: height * 0.07,
        paddingBottom: 44,
        paddingHorizontal: 24,
    },

    // --- Mascot ---
    mascotWrap: {
        marginBottom: 20,
        shadowColor: '#6366f1',
        shadowOffset: { width: 0, height: 14 },
        shadowOpacity: 0.45,
        shadowRadius: 26,
        elevation: 20,
    },
    mascot: {
        width: width * 0.58,
        height: width * 0.58,
    },

    // --- Title ---
    titleSection: {
        alignItems: 'center',
        marginBottom: 32,
    },
    welcome: {
        fontSize: 15,
        color: 'rgba(255,255,255,0.55)',
        marginBottom: 4,
        fontWeight: '400',
        letterSpacing: 0.5,
    },
    appName: {
        fontSize: 38,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 2,
        textShadowColor: 'rgba(99,102,241,0.6)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 18,
        marginBottom: 6,
    },
    tagline: {
        fontSize: 11,
        color: 'rgba(255,255,255,0.35)',
        letterSpacing: 3.5,
        fontWeight: '600',
    },

    // --- Permissions ---
    permSection: {
        width: '100%',
        marginBottom: 28,
    },
    permSectionTitle: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.4)',
        letterSpacing: 2,
        marginBottom: 14,
        textAlign: 'center',
        textTransform: 'uppercase',
        fontWeight: '600',
    },
    permCard: {
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: 'rgba(255,255,255,0.05)',
        borderRadius: 14,
        padding: 14,
        marginBottom: 10,
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.07)',
    },
    permEmoji: {
        fontSize: 22,
        marginRight: 14,
    },
    permInfoCol: {
        flex: 1,
    },
    permLabel: {
        fontSize: 14,
        fontWeight: '700',
        color: '#FFFFFF',
        marginBottom: 2,
    },
    permDesc: {
        fontSize: 12,
        color: 'rgba(255,255,255,0.45)',
        lineHeight: 16,
    },
    permBadge: {
        width: 30,
        height: 30,
        borderRadius: 15,
        justifyContent: 'center',
        alignItems: 'center',
        marginLeft: 10,
    },
    badgePending: {
        backgroundColor: 'rgba(255,255,255,0.08)',
    },
    badgeGranted: {
        backgroundColor: 'rgba(34,197,94,0.2)',
        borderWidth: 1,
        borderColor: 'rgba(34,197,94,0.5)',
    },
    badgeDenied: {
        backgroundColor: 'rgba(239,68,68,0.2)',
        borderWidth: 1,
        borderColor: 'rgba(239,68,68,0.5)',
    },
    badgeText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
    },

    // --- Actions ---
    actions: {
        width: '100%',
        gap: 10,
    },
    primaryBtn: {
        backgroundColor: '#6366f1',
        borderRadius: 16,
        paddingVertical: 16,
        alignItems: 'center',
        shadowColor: '#6366f1',
        shadowOffset: { width: 0, height: 6 },
        shadowOpacity: 0.45,
        shadowRadius: 14,
        elevation: 8,
    },
    primaryBtnMuted: {
        backgroundColor: 'rgba(255,255,255,0.1)',
        shadowOpacity: 0,
        elevation: 0,
    },
    primaryBtnText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontWeight: '700',
        letterSpacing: 0.3,
    },
    settingsBtn: {
        backgroundColor: 'rgba(255,255,255,0.07)',
        borderRadius: 16,
        paddingVertical: 14,
        alignItems: 'center',
        borderWidth: 1,
        borderColor: 'rgba(255,255,255,0.1)',
    },
    settingsBtnText: {
        color: 'rgba(255,255,255,0.85)',
        fontSize: 14,
        fontWeight: '600',
    },
    requestingRow: {
        paddingVertical: 18,
        alignItems: 'center',
    },
    requestingText: {
        color: 'rgba(255,255,255,0.5)',
        fontSize: 15,
        fontWeight: '500',
        fontStyle: 'italic',
    },
});
