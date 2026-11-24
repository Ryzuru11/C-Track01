import { describe, it, expect, vi, beforeEach } from 'vitest';
import { appAlertRef, showToast, showDialog } from '../../utils/alert';

describe('Mobile Alert Utility', () => {
  beforeEach(() => {
    (appAlertRef as any).current = null;
  });

  it('should not throw error if appAlertRef.current is null when invoking showToast or showDialog', () => {
    expect(() => showToast('Test toast', 'info')).not.toThrow();
    expect(() => showDialog('Title', 'Message')).not.toThrow();
  });

  it('should invoke showToast on referenced AppAlert handler', () => {
    const mockShowToast = vi.fn();
    const mockShowDialog = vi.fn();

    (appAlertRef as any).current = {
      showToast: mockShowToast,
      showDialog: mockShowDialog,
    };

    showToast('Login berhasil', 'success');
    expect(mockShowToast).toHaveBeenCalledWith('Login berhasil', 'success');
  });

  it('should invoke showDialog on referenced AppAlert handler with buttons', () => {
    const mockShowToast = vi.fn();
    const mockShowDialog = vi.fn();

    (appAlertRef as any).current = {
      showToast: mockShowToast,
      showDialog: mockShowDialog,
    };

    const buttons = [{ text: 'OK', style: 'default' as const }];
    showDialog('Konfirmasi', 'Apakah anda yakin?', buttons);

    expect(mockShowDialog).toHaveBeenCalledWith('Konfirmasi', 'Apakah anda yakin?', buttons);
  });
});
