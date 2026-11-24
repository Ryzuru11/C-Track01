import React, {
  useImperativeHandle,
  forwardRef,
  useState,
  useCallback,
  useRef,
} from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  Modal,
  Animated,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { IconSymbol } from './icon-symbol';
import { AppAlertRef, AlertButton, ToastType } from '@/utils/alert';

const TOAST_CONFIG: Record<
  ToastType,
  { bg: string; border: string; icon: string; text: string; iconName: string }
> = {
  success: {
    bg: '#ECFDF5',
    border: '#10B981',
    icon: '#10B981',
    text: '#065F46',
    iconName: 'checkmark.circle.fill',
  },
  error: {
    bg: '#FEF2F2',
    border: '#EF4444',
    icon: '#EF4444',
    text: '#991B1B',
    iconName: 'xmark.circle.fill',
  },
  warning: {
    bg: '#FFFBEB',
    border: '#F59E0B',
    icon: '#F59E0B',
    text: '#92400E',
    iconName: 'exclamationmark.triangle.fill',
  },
  info: {
    bg: '#EFF6FF',
    border: '#3B82F6',
    icon: '#3B82F6',
    text: '#1E40AF',
    iconName: 'info.circle.fill',
  },
};

const AppAlert = forwardRef<AppAlertRef>((_, ref) => {
  const insets = useSafeAreaInsets();

  const [toast, setToast] = useState<{
    visible: boolean;
    message: string;
    type: ToastType;
  }>({ visible: false, message: '', type: 'info' });

  const [dialog, setDialog] = useState<{
    visible: boolean;
    title: string;
    message: string;
    buttons: AlertButton[];
  }>({ visible: false, title: '', message: '', buttons: [] });

  const translateY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;
  const dismissTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const hideToast = useCallback(() => {
    Animated.parallel([
      Animated.timing(translateY, {
        toValue: -120,
        duration: 280,
        useNativeDriver: true,
      }),
      Animated.timing(opacity, {
        toValue: 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start(() => setToast((prev) => ({ ...prev, visible: false })));
  }, [translateY, opacity]);

  const showToastFn = useCallback(
    (message: string, type: ToastType = 'info') => {
      if (dismissTimer.current) clearTimeout(dismissTimer.current);

      translateY.setValue(-120);
      opacity.setValue(0);
      setToast({ visible: true, message, type });

      Animated.parallel([
        Animated.spring(translateY, {
          toValue: 0,
          damping: 16,
          stiffness: 180,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 200,
          useNativeDriver: true,
        }),
      ]).start();

      dismissTimer.current = setTimeout(hideToast, 3500);
    },
    [translateY, opacity, hideToast]
  );

  const showDialogFn = useCallback(
    (
      title: string,
      message: string,
      buttons: AlertButton[] = [{ text: 'OK' }]
    ) => {
      setDialog({ visible: true, title, message, buttons });
    },
    []
  );

  useImperativeHandle(ref, () => ({
    showToast: showToastFn,
    showDialog: showDialogFn,
  }));

  const cfg = TOAST_CONFIG[toast.type];

  return (
    <>
      {/* ── Toast ── */}
      {toast.visible && (
        <Animated.View
          style={[
            styles.toastWrapper,
            { top: insets.top + 12, transform: [{ translateY }], opacity },
          ]}
        >
          <TouchableOpacity activeOpacity={0.9} onPress={hideToast}>
            <View
              style={[
                styles.toast,
                { backgroundColor: cfg.bg, borderLeftColor: cfg.border },
              ]}
            >
              <IconSymbol
                size={20}
                name={cfg.iconName as any}
                color={cfg.icon}
              />
              <Text
                style={[styles.toastText, { color: cfg.text }]}
                numberOfLines={4}
              >
                {toast.message}
              </Text>
            </View>
          </TouchableOpacity>
        </Animated.View>
      )}

      {/* ── Dialog ── */}
      <Modal
        visible={dialog.visible}
        transparent
        animationType="fade"
        statusBarTranslucent
        onRequestClose={() =>
          setDialog((prev) => ({ ...prev, visible: false }))
        }
      >
        <View style={styles.dialogOverlay}>
          <View style={styles.dialogCard}>
            <Text style={styles.dialogTitle}>{dialog.title}</Text>
            {!!dialog.message && (
              <Text style={styles.dialogMessage}>{dialog.message}</Text>
            )}
            <View
              style={[
                styles.dialogButtons,
                dialog.buttons.length > 2 && styles.dialogButtonsCol,
              ]}
            >
              {dialog.buttons.map((btn, i) => {
                const isCancel = btn.style === 'cancel';
                const isDestructive = btn.style === 'destructive';
                const isPrimary = !isCancel && !isDestructive && i > 0;
                return (
                  <TouchableOpacity
                    key={i}
                    activeOpacity={0.75}
                    style={[
                      styles.dialogBtn,
                      dialog.buttons.length <= 2 && styles.dialogBtnFlex,
                      isCancel && styles.dialogBtnCancel,
                      isDestructive && styles.dialogBtnDestructive,
                      isPrimary && styles.dialogBtnPrimary,
                      !isCancel && !isDestructive && !isPrimary && dialog.buttons.length === 1 && styles.dialogBtnPrimary,
                    ]}
                    onPress={() => {
                      setDialog((prev) => ({ ...prev, visible: false }));
                      btn.onPress?.();
                    }}
                  >
                    <Text
                      style={[
                        styles.dialogBtnText,
                        isCancel && styles.dialogBtnTextCancel,
                        isDestructive && styles.dialogBtnTextDestructive,
                        isPrimary && styles.dialogBtnTextPrimary,
                        !isCancel && !isDestructive && !isPrimary && dialog.buttons.length === 1 && styles.dialogBtnTextPrimary,
                      ]}
                    >
                      {btn.text}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
});

AppAlert.displayName = 'AppAlert';
export default AppAlert;

const styles = StyleSheet.create({
  /* Toast */
  toastWrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    zIndex: 9999,
    elevation: 9999,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    borderRadius: 14,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.12,
    shadowRadius: 12,
    elevation: 8,
  },
  toastText: {
    flex: 1,
    fontSize: 14,
    fontWeight: '500',
    lineHeight: 20,
  },

  /* Dialog */
  dialogOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 28,
  },
  dialogCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingTop: 28,
    paddingHorizontal: 24,
    paddingBottom: 20,
    width: '100%',
    maxWidth: 360,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.15,
    shadowRadius: 24,
    elevation: 16,
  },
  dialogTitle: {
    fontSize: 18,
    fontWeight: '700',
    color: '#1d1d1f',
    letterSpacing: -0.3,
    textAlign: 'center',
    marginBottom: 10,
  },
  dialogMessage: {
    fontSize: 14,
    color: '#6B7280',
    lineHeight: 21,
    textAlign: 'center',
    marginBottom: 24,
  },
  dialogButtons: {
    flexDirection: 'row',
    gap: 10,
    marginTop: 4,
  },
  dialogButtonsCol: {
    flexDirection: 'column',
  },
  dialogBtn: {
    paddingVertical: 13,
    paddingHorizontal: 16,
    borderRadius: 12,
    alignItems: 'center',
    backgroundColor: '#F3F4F6',
  },
  dialogBtnFlex: {
    flex: 1,
  },
  dialogBtnCancel: {
    backgroundColor: '#F3F4F6',
  },
  dialogBtnDestructive: {
    backgroundColor: '#FEF2F2',
    borderWidth: 1,
    borderColor: '#FECACA',
  },
  dialogBtnPrimary: {
    backgroundColor: '#1d1d1f',
  },
  dialogBtnText: {
    fontSize: 15,
    fontWeight: '600',
    color: '#374151',
  },
  dialogBtnTextCancel: {
    color: '#6B7280',
  },
  dialogBtnTextDestructive: {
    color: '#EF4444',
  },
  dialogBtnTextPrimary: {
    color: '#FFFFFF',
  },
});
