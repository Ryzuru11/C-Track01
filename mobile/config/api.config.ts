/**
 * Configuration file untuk API URL
 * Ganti nilai API_BASE_URL sesuai dengan environment
 * 
 * BACKEND: Express.js + Socket.io (backend-express)
 * PORT: 8017 (production di VPS)
 */

// ============================================
// PRODUCTION CONFIG - VPS C-Track
// ============================================
export const API_BASE_URL =
  process.env.EXPO_PUBLIC_API_BASE_URL?.trim() || 'https://ctrack.gogo.web.id/api';

// ============================================
// WEBSOCKET CONFIG - Untuk real-time tracking
// ============================================
export const WS_URL = API_BASE_URL.replace('/api', '');

// ============================================
// SOCKET CONFIG - Opsional (bisa pakai WS_URL langsung)
// ============================================
export const SOCKET_CONFIG = {
  SOCKET_URL: WS_URL,
  RECONNECTION_ATTEMPTS: 5,
  RECONNECTION_DELAY: 3000,
};

// ============================================
// MAP CONFIG - Gratis tanpa API Key
// ============================================
export const MAP_CONFIG = {
  DEFAULT_LATITUDE_DELTA: 0.01,
  DEFAULT_LONGITUDE_DELTA: 0.01,
  OSRM_BASE_URL: 'https://router.project-osrm.org/route/v1/driving',
  MAP_TILE_URL: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  NOMINATIM_BASE_URL: 'https://nominatim.openstreetmap.org/search',
};

// ============================================
// ALTERNATIVE CONFIGS (Semua pakai port 8017)
// ============================================

// 1. Android Emulator (LOCAL DEVELOPMENT)
// export const API_BASE_URL = 'http://10.0.2.2:8017/api';

// 2. iOS Simulator (LOCAL DEVELOPMENT)
// export const API_BASE_URL = 'http://localhost:8000/api';

// 3. Physical Device (LOCAL DEVELOPMENT)
// export const API_BASE_URL = 'http://192.168.x.x:8017/api';

// 4. Production VPS (CURRENT) - SUDAH AKTIF
// export const API_BASE_URL = 'http://202.169.232.241:8017/api';

export default API_BASE_URL;
