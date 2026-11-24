import React, { useEffect } from 'react';
import { StyleSheet } from 'react-native';
import Animated, {
  useSharedValue,
  useAnimatedStyle,
  useAnimatedProps,
  withTiming,
  withDelay,
  runOnJS,
  Easing,
} from 'react-native-reanimated';
import Svg, { Circle, Path } from 'react-native-svg';

interface Props {
  visible: boolean;
  onFinish: () => void;
}

const CHECK_LENGTH = 80;

// Create animated components outside component
const AnimatedPath = Animated.createAnimatedComponent(Path);

export default function SuccessCheckOverlay({
  visible,
  onFinish,
}: Props) {
  const scale = useSharedValue(0.9);
  const opacity = useSharedValue(0);
  const progress = useSharedValue(0);
  const translateY = useSharedValue(15);
  const checkScale = useSharedValue(0.5);
  const textOpacity = useSharedValue(0);
  const textTranslateY = useSharedValue(10);

  useEffect(() => {
    if (visible) {
      // Background and container fade in smoothly
      opacity.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });

      // Gentle float up
      translateY.value = withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) });

      // Soft scale in
      scale.value = withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) });

      // Check icon scale in softly
      checkScale.value = withDelay(
        200,
        withTiming(1, { duration: 600, easing: Easing.out(Easing.cubic) })
      );

      // Draw checkmark smoothly and slowly
      progress.value = withDelay(
        300,
        withTiming(1, {
          duration: 800,
          easing: Easing.inOut(Easing.ease),
        })
      );

      // Text fades in softly
      textOpacity.value = withDelay(
        500,
        withTiming(1, { duration: 600 })
      );
      textTranslateY.value = withDelay(
        500,
        withTiming(0, { duration: 600, easing: Easing.out(Easing.cubic) })
      );

      const timeout = setTimeout(() => {
        // Exit animation - gentle fade out
        scale.value = withTiming(0.95, { duration: 500, easing: Easing.inOut(Easing.ease) });
        opacity.value = withTiming(0, { duration: 500, easing: Easing.inOut(Easing.ease) }, (finished) => {
          if (finished) {
            runOnJS(onFinish)();
          }
        });
      }, 2500); // Give user enough time to appreciate the calm animation

      return () => clearTimeout(timeout);
    } else {
      // Reset values for next time
      scale.value = 0.9;
      opacity.value = 0;
      progress.value = 0;
      translateY.value = 15;
      checkScale.value = 0.5;
      textOpacity.value = 0;
      textTranslateY.value = 10;
    }
  }, [visible, onFinish]);

  const containerStyle = useAnimatedStyle(() => ({
    opacity: opacity.value,
  }));

  const circleStyle = useAnimatedStyle(() => ({
    transform: [
      { translateY: translateY.value },
      { scale: scale.value },
    ],
  }));

  const checkIconStyle = useAnimatedStyle(() => ({
    transform: [{ scale: checkScale.value }],
  }));

  const textStyle = useAnimatedStyle(() => ({
    opacity: textOpacity.value,
    transform: [{ translateY: textTranslateY.value }],
  }));

  // Use useAnimatedProps for SVG props
  const checkProps = useAnimatedProps(() => ({
    strokeDashoffset: CHECK_LENGTH * (1 - progress.value),
  }));

  return (
    <Animated.View style={[styles.overlay, containerStyle]} pointerEvents="none">
      <Animated.View style={[styles.box, circleStyle]}>
        <Animated.View style={checkIconStyle}>
          <Svg width={120} height={120}>
            {/* Background Circle - Very subtle ring */}
            <Circle
              cx="60"
              cy="60"
              r="55"
              fill="#ffffff"
              opacity="0.1"
            />

            {/* Main Circle - Clean White */}
            <Circle
              cx="60"
              cy="60"
              r="50"
              fill="#FFFFFF"
            />

            {/* Elegant Checkmark */}
            <AnimatedPath
              d="M40 60 L55 75 L80 45"
              stroke="#10B981"
              strokeWidth="4"
              fill="none"
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeDasharray={CHECK_LENGTH}
              animatedProps={checkProps}
            />
          </Svg>
        </Animated.View>

        {/* Success Text */}
        <Animated.Text style={[styles.successText, textStyle]}>
          Success
        </Animated.Text>
      </Animated.View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  overlay: {
    ...StyleSheet.absoluteFill,
    backgroundColor: 'rgba(0, 0, 0, 0.4)', // Calm dark backdrop
    justifyContent: 'center',
    alignItems: 'center',
    zIndex: 999,
  },
  box: {
    justifyContent: 'center',
    alignItems: 'center',
    // Soft, diffused shadow for elegance
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.1,
    shadowRadius: 20,
    elevation: 5,
  },
  successText: {
    marginTop: 24,
    fontSize: 16,
    fontWeight: '500',
    color: '#FFFFFF',
    letterSpacing: 2,
    textTransform: 'uppercase',
  },
});