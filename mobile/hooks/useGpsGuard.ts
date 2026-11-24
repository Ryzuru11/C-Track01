import { useEffect, useCallback } from 'react';
import * as Location from 'expo-location';
import { AppState, AppStateStatus } from 'react-native';

/**
 * Continuously ensures GPS/Location Services is enabled.
 * - Prompts the native OS dialog on mount
 * - Re-prompts every time the app returns to foreground
 * Does NOT navigate away — it only shows the system dialog.
 */
export function useGpsGuard() {
  const checkAndPrompt = useCallback(async () => {
    const hasServices = await Location.hasServicesEnabledAsync();
    if (!hasServices) {
      try {
        await Location.enableNetworkProviderAsync();
      } catch {
        // User dismissed — will re-prompt next foreground
      }
    }
  }, []);

  useEffect(() => {
    checkAndPrompt();

    const sub = AppState.addEventListener('change', (state: AppStateStatus) => {
      if (state === 'active') {
        checkAndPrompt();
      }
    });

    return () => sub.remove();
  }, [checkAndPrompt]);
}
