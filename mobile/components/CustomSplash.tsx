import React, { useEffect, useRef } from 'react';
import {
    Animated,
    Dimensions,
    Easing,
    Image,
    StyleSheet,
    Text,
    View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';

const { width, height } = Dimensions.get('window');

interface CustomSplashProps {
    onFinish: () => void;
}

export default function CustomSplash({ onFinish }: CustomSplashProps) {
    // --- core entrance ---
    const logoScale = useRef(new Animated.Value(0.25)).current;
    const logoOpacity = useRef(new Animated.Value(0)).current;
    const logoRotate = useRef(new Animated.Value(-0.08)).current;

    // --- glow / ambient ---
    const glowScale = useRef(new Animated.Value(0.5)).current;
    const glowOpacity = useRef(new Animated.Value(0)).current;
    const glow2Scale = useRef(new Animated.Value(0.7)).current;
    const glow2Opacity = useRef(new Animated.Value(0)).current;

    // --- spinner ring ---
    const ringOpacity = useRef(new Animated.Value(0)).current;
    const ringRotation = useRef(new Animated.Value(0)).current;

    // --- text ---
    const textOpacity = useRef(new Animated.Value(0)).current;
    const textSlide = useRef(new Animated.Value(32)).current;
    const taglineOp = useRef(new Animated.Value(0)).current;

    // --- loading dots ---
    const dot1Opacity = useRef(new Animated.Value(0.2)).current;
    const dot2Opacity = useRef(new Animated.Value(0.2)).current;
    const dot3Opacity = useRef(new Animated.Value(0.2)).current;

    // --- logo breath (after entrance) ---
    const logoBreath = useRef(new Animated.Value(1)).current;

    // --- container fade-out ---
    const containerOp = useRef(new Animated.Value(1)).current;

    useEffect(() => {
        // Phase 1: glow + logo spring + ring appear
        Animated.parallel([
            Animated.spring(logoScale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 60,
                friction: 7,
            }),
            Animated.timing(logoOpacity, {
                toValue: 1,
                duration: 400,
                easing: Easing.out(Easing.quad),
                useNativeDriver: true,
            }),
            Animated.spring(logoRotate, {
                toValue: 0,
                useNativeDriver: true,
                tension: 50,
                friction: 8,
            }),
            Animated.spring(glowScale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 35,
                friction: 9,
            }),
            Animated.timing(glowOpacity, {
                toValue: 0.5,
                duration: 700,
                useNativeDriver: true,
            }),
            Animated.timing(glow2Opacity, {
                toValue: 0.22,
                duration: 900,
                useNativeDriver: true,
            }),
            Animated.spring(glow2Scale, {
                toValue: 1,
                useNativeDriver: true,
                tension: 28,
                friction: 10,
            }),
            Animated.timing(ringOpacity, {
                toValue: 1,
                duration: 600,
                delay: 150,
                useNativeDriver: true,
            }),
        ]).start(() => {
            // Phase 2: text + tagline slide up
            Animated.parallel([
                Animated.timing(textOpacity, {
                    toValue: 1,
                    duration: 350,
                    easing: Easing.out(Easing.quad),
                    useNativeDriver: true,
                }),
                Animated.timing(textSlide, {
                    toValue: 0,
                    duration: 350,
                    easing: Easing.out(Easing.back(1.2)),
                    useNativeDriver: true,
                }),
                Animated.timing(taglineOp, {
                    toValue: 1,
                    duration: 500,
                    delay: 200,
                    useNativeDriver: true,
                }),
            ]).start(() => {
                // Phase 3: ring spins + logo breathes + dots pulse
                Animated.loop(
                    Animated.timing(ringRotation, {
                        toValue: 1,
                        duration: 2400,
                        easing: Easing.linear,
                        useNativeDriver: true,
                    })
                ).start();

                Animated.loop(
                    Animated.sequence([
                        Animated.timing(logoBreath, {
                            toValue: 1.06,
                            duration: 950,
                            easing: Easing.inOut(Easing.sin),
                            useNativeDriver: true,
                        }),
                        Animated.timing(logoBreath, {
                            toValue: 1,
                            duration: 950,
                            easing: Easing.inOut(Easing.sin),
                            useNativeDriver: true,
                        }),
                    ])
                ).start();

                const pulseDot = (anim: Animated.Value, delay: number) =>
                    Animated.loop(
                        Animated.sequence([
                            Animated.delay(delay),
                            Animated.timing(anim, { toValue: 1, duration: 300, useNativeDriver: true }),
                            Animated.timing(anim, { toValue: 0.2, duration: 300, useNativeDriver: true }),
                        ])
                    );
                pulseDot(dot1Opacity, 0).start();
                pulseDot(dot2Opacity, 200).start();
                pulseDot(dot3Opacity, 400).start();

                // Phase 4: hold then fade out
                setTimeout(() => {
                    Animated.timing(containerOp, {
                        toValue: 0,
                        duration: 500,
                        easing: Easing.in(Easing.quad),
                        useNativeDriver: true,
                    }).start(() => onFinish());
                }, 1600);
            });
        });
    }, []);

    const spin = ringRotation.interpolate({
        inputRange: [0, 1],
        outputRange: ['0deg', '360deg'],
    });

    const logoSpin = logoRotate.interpolate({
        inputRange: [-0.08, 0],
        outputRange: ['-30deg', '0deg'],
    });

    return (
        <Animated.View style={[styles.wrapper, { opacity: containerOp }]}>
            <LinearGradient
                colors={['#000000', '#141414', '#2C2C2C']}
                start={{ x: 0.15, y: 0 }}
                end={{ x: 0.85, y: 1 }}
                style={styles.gradient}
            >
                {/* Outer soft glow */}
                <Animated.View
                    style={[
                        styles.glowOuter,
                        { opacity: glow2Opacity, transform: [{ scale: glow2Scale }] },
                    ]}
                />

                {/* Inner glow */}
                <Animated.View
                    style={[
                        styles.glowInner,
                        { opacity: glowOpacity, transform: [{ scale: glowScale }] },
                    ]}
                />

                {/* Spinning arc ring */}
                <Animated.View
                    style={[
                        styles.ring,
                        { opacity: ringOpacity, transform: [{ rotate: spin }] },
                    ]}
                />

                {/* Logo */}
                <Animated.View
                    style={[
                        styles.logoWrap,
                        {
                            opacity: logoOpacity,
                            transform: [
                                { scale: Animated.multiply(logoScale, logoBreath) },
                                { rotate: logoSpin },
                            ],
                        },
                    ]}
                >
                    <Image
                        source={require('../assets/images/C-Track.png')}
                        style={styles.logoImage}
                        resizeMode="contain"
                    />
                </Animated.View>

                {/* App name + tagline */}
                <Animated.View
                    style={[
                        styles.textWrap,
                        { opacity: textOpacity, transform: [{ translateY: textSlide }] },
                    ]}
                >
                    <Text style={styles.appName}>C-Track</Text>
                    <Animated.Text style={[styles.tagline, { opacity: taglineOp }]}>
                        Task Tracking System
                    </Animated.Text>
                </Animated.View>

                {/* Loading dots */}
                <View style={styles.dotsRow}>
                    <Animated.View style={[styles.dot, { opacity: dot1Opacity }]} />
                    <Animated.View style={[styles.dot, { opacity: dot2Opacity }]} />
                    <Animated.View style={[styles.dot, { opacity: dot3Opacity }]} />
                </View>

                {/* Bottom label */}
                <Text style={styles.bottomLabel}>LifeMedia © 2025</Text>
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
        zIndex: 9999,
    },
    gradient: {
        flex: 1,
        alignItems: 'center',
        justifyContent: 'center',
    },
    glowOuter: {
        position: 'absolute',
        width: 320,
        height: 320,
        borderRadius: 160,
        backgroundColor: 'rgba(255, 255, 255, 0.07)',
    },
    glowInner: {
        position: 'absolute',
        width: 200,
        height: 200,
        borderRadius: 100,
        backgroundColor: 'rgba(255, 255, 255, 0.12)',
    },
    ring: {
        position: 'absolute',
        width: 188,
        height: 188,
        borderRadius: 94,
        borderWidth: 2,
        borderColor: 'transparent',
        borderTopColor: 'rgba(255, 255, 255, 0.75)',
        borderRightColor: 'rgba(255, 255, 255, 0.35)',
        borderBottomColor: 'rgba(255, 255, 255, 0.08)',
        borderLeftColor: 'rgba(255, 255, 255, 0.08)',
    },
    logoWrap: {
        width: 130,
        height: 130,
        shadowColor: '#FFFFFF',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.18,
        shadowRadius: 28,
        elevation: 22,
        marginBottom: 36,
    },
    logoImage: {
        width: 130,
        height: 130,
        borderRadius: 28,
    },
    textWrap: {
        alignItems: 'center',
        marginBottom: 72,
    },
    appName: {
        fontSize: 34,
        fontWeight: '800',
        color: '#FFFFFF',
        letterSpacing: 1.5,
        marginBottom: 10,
        textShadowColor: 'rgba(255, 255, 255, 0.25)',
        textShadowOffset: { width: 0, height: 4 },
        textShadowRadius: 12,
    },
    tagline: {
        fontSize: 12,
        color: 'rgba(255, 255, 255, 0.65)',
        letterSpacing: 2.5,
        textTransform: 'uppercase',
        fontWeight: '500',
    },
    dotsRow: {
        flexDirection: 'row',
        gap: 10,
        position: 'absolute',
        bottom: 90,
    },
    dot: {
        width: 7,
        height: 7,
        borderRadius: 3.5,
        backgroundColor: '#FFFFFF',
    },
    bottomLabel: {
        position: 'absolute',
        bottom: 48,
        fontSize: 11,
        color: 'rgba(255,255,255,0.3)',
        letterSpacing: 1,
    },
});
