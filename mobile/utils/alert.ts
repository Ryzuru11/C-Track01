import { createRef } from 'react';

export type ToastType = 'success' | 'error' | 'warning' | 'info';

export interface AlertButton {
  text: string;
  style?: 'default' | 'cancel' | 'destructive';
  onPress?: () => void;
}

export interface AppAlertRef {
  showToast: (message: string, type?: ToastType) => void;
  showDialog: (title: string, message: string, buttons?: AlertButton[]) => void;
}

export const appAlertRef = createRef<AppAlertRef>();

export const showToast = (message: string, type: ToastType = 'info') => {
  appAlertRef.current?.showToast(message, type);
};

export const showDialog = (
  title: string,
  message: string,
  buttons?: AlertButton[]
) => {
  appAlertRef.current?.showDialog(title, message, buttons);
};
