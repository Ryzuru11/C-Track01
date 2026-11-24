import { describe, it, expect } from 'vitest';
import { API_BASE_URL, WS_URL, SOCKET_CONFIG, MAP_CONFIG } from '../../config/api.config';

describe('Mobile API Config', () => {
  it('should have a defined API_BASE_URL', () => {
    expect(API_BASE_URL).toBeDefined();
    expect(typeof API_BASE_URL).toBe('string');
  });

  it('should derive WS_URL correctly from API_BASE_URL', () => {
    expect(WS_URL).toBe(API_BASE_URL.replace('/api', ''));
  });

  it('should have valid socket configuration parameters', () => {
    expect(SOCKET_CONFIG.SOCKET_URL).toBe(WS_URL);
    expect(SOCKET_CONFIG.RECONNECTION_ATTEMPTS).toBeGreaterThan(0);
    expect(SOCKET_CONFIG.RECONNECTION_DELAY).toBeGreaterThan(0);
  });

  it('should provide default map configurations without missing coordinates delta', () => {
    expect(MAP_CONFIG.DEFAULT_LATITUDE_DELTA).toBeGreaterThan(0);
    expect(MAP_CONFIG.DEFAULT_LONGITUDE_DELTA).toBeGreaterThan(0);
    expect(MAP_CONFIG.OSRM_BASE_URL).toContain('http');
  });
});
