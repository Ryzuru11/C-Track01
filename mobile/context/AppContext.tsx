import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { AppState } from 'react-native';
import { getSocket } from '@/services/socketService';
import { getPersistedTrackingState } from '@/services/locationTrackingRefactored';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────

export interface AppUser {
  id: string;
  name: string;
  email: string;
  avatar: string | null;
  role: string;
}

export type SocketStatus = 'connected' | 'disconnected' | 'reconnecting';

interface AppContextValue {
  // User
  user: AppUser | null;
  refreshUser: () => Promise<void>;

  // Socket
  socketStatus: SocketStatus;

  // Active tracking
  activeTrackingTaskId: string | null;
  setActiveTrackingTaskId: (id: string | null) => void;
}

// ─────────────────────────────────────────────
// Context
// ─────────────────────────────────────────────

const AppContext = createContext<AppContextValue>({
  user: null,
  refreshUser: async () => {},
  socketStatus: 'disconnected',
  activeTrackingTaskId: null,
  setActiveTrackingTaskId: () => {},
});

export function useAppContext() {
  return useContext(AppContext);
}

// ─────────────────────────────────────────────
// Provider
// ─────────────────────────────────────────────

export function AppProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [socketStatus, setSocketStatus] = useState<SocketStatus>('disconnected');
  const [activeTrackingTaskId, setActiveTrackingTaskId] = useState<string | null>(null);

  // ── Load user from AsyncStorage ───────────────────────────────────────
  const refreshUser = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem('user');
      if (!raw) { setUser(null); return; }
      const parsed = JSON.parse(raw);
      setUser({
        id: parsed.id ?? '',
        name: parsed.name ?? 'User',
        email: parsed.email ?? '',
        avatar: parsed.avatar ?? null,
        role: parsed.role ?? 'user',
      });
    } catch {
      setUser(null);
    }
  }, []);

  // ── Load persisted tracking state ─────────────────────────────────────
  const refreshTrackingState = useCallback(async () => {
    const state = await getPersistedTrackingState();
    setActiveTrackingTaskId(state?.takenTaskId ?? null);
  }, []);

  // Load everything on mount
  useEffect(() => {
    refreshUser();
    refreshTrackingState();
  }, []);

  // Re-read user when app comes to foreground (catches profile updates in background)
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') {
        refreshUser();
        refreshTrackingState();
      }
    });
    return () => sub.remove();
  }, [refreshUser, refreshTrackingState]);

  // ── Socket status listener ─────────────────────────────────────────────
  // Poll until socket is initialized (async), then attach event listeners.
  useEffect(() => {
    let pollInterval: ReturnType<typeof setInterval> | null = null;

    const attachListeners = () => {
      const socket = getSocket();
      if (!socket) return false;

      setSocketStatus(socket.connected ? 'connected' : 'disconnected');

      socket.on('connect', () => setSocketStatus('connected'));
      socket.on('disconnect', () => setSocketStatus('disconnected'));
      socket.on('reconnect_attempt', () => setSocketStatus('reconnecting'));
      socket.on('reconnect', () => setSocketStatus('connected'));
      socket.on('reconnect_failed', () => setSocketStatus('disconnected'));

      return true;
    };

    if (!attachListeners()) {
      pollInterval = setInterval(() => {
        if (attachListeners() && pollInterval) {
          clearInterval(pollInterval);
          pollInterval = null;
        }
      }, 500);
    }

    return () => {
      if (pollInterval) clearInterval(pollInterval);
    };
  }, []);

  return (
    <AppContext.Provider
      value={{
        user,
        refreshUser,
        socketStatus,
        activeTrackingTaskId,
        setActiveTrackingTaskId,
      }}
    >
      {children}
    </AppContext.Provider>
  );
}
