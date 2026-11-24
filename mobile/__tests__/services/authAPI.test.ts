import { describe, it, expect, vi, beforeEach } from 'vitest';

// Capture the axios instance and its interceptors so they can be exercised directly
const h = vi.hoisted(() => ({
  storage: new Map<string, string>(),
  post: vi.fn(),
  requestInterceptor: null as null | ((config: any) => Promise<any>),
  responseError: null as null | ((error: any) => Promise<any>),
}));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      post: h.post,
      get: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: {
        request: { use: (onFulfilled: any) => { h.requestInterceptor = onFulfilled; } },
        response: { use: (_ok: any, onRejected: any) => { h.responseError = onRejected; } },
      },
    }),
  },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: {
    getItem: vi.fn(async (k: string) => (h.storage.has(k) ? h.storage.get(k)! : null)),
    setItem: vi.fn(async (k: string, v: string) => { h.storage.set(k, v); }),
    removeItem: vi.fn(async (k: string) => { h.storage.delete(k); }),
  },
}));

import { authAPI } from '../../services/api';

/** What the response interceptor turns an axios error into (as the real instance would) */
const throughInterceptor = (error: any) => h.responseError!(error).catch((e: any) => e);
const httpError = (status: number, message: string) =>
  Object.assign(new Error(`Request failed with status code ${status}`), { response: { status, data: { message } }, config: { url: '/auth/login' } });

const USER = { id: 'u1', name: 'Budi', email: 'budi@example.com', role: 'employee', platform: 'mobile', permissions: [] };

beforeEach(() => {
  vi.clearAllMocks();
  h.storage.clear();
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('authAPI.login', () => {
  it('stores the token, email and user after a successful login', async () => {
    h.post.mockResolvedValueOnce({ data: { token: 'jwt-123', user: USER } });

    const result = await authAPI.login('budi@example.com', 'password123');

    expect(h.post).toHaveBeenCalledWith('/auth/login', { email: 'budi@example.com', password: 'password123' }, undefined);
    expect(result.token).toBe('jwt-123');
    expect(h.storage.get('userToken')).toBe('jwt-123');
    expect(h.storage.get('userEmail')).toBe('budi@example.com');
    expect(JSON.parse(h.storage.get('user')!)).toMatchObject({ id: 'u1', platform: 'mobile' });
  });

  it('passes a custom timeout through', async () => {
    h.post.mockResolvedValueOnce({ data: { token: 't', user: USER } });
    await authAPI.login('a@b.c', 'x', 5000);
    expect(h.post.mock.calls[0][2]).toEqual({ timeout: 5000 });
  });

  it('fails when the server returns no token', async () => {
    h.post.mockResolvedValueOnce({ data: { user: USER } });
    await expect(authAPI.login('a@b.c', 'x')).rejects.toThrow();
    expect(h.storage.has('userToken')).toBe(false);
  });

  it('shows the server message for wrong credentials (401), not a generic error', async () => {
    h.post.mockRejectedValueOnce(await throughInterceptor(httpError(401, 'Invalid credentials')));
    await expect(authAPI.login('budi@example.com', 'wrong')).rejects.toThrow('Invalid credentials');
  });

  it.each([
    [403, 'Mobile app access is restricted to employees only'],
    [403, 'Account is inactive'],
    [400, 'Email wajib diisi'],
  ])('shows the server message for %s: %s', async (status, message) => {
    h.post.mockRejectedValueOnce(await throughInterceptor(httpError(status, message)));
    await expect(authAPI.login('admin@example.com', 'password123')).rejects.toThrow(message);
  });

  it('explains a timeout and an unreachable server', async () => {
    h.post.mockRejectedValueOnce(Object.assign(new Error('timeout of 30000ms exceeded'), { code: 'ECONNABORTED' }));
    await expect(authAPI.login('a@b.c', 'x')).rejects.toThrow(/Connection timeout/);

    h.post.mockRejectedValueOnce(Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' }));
    await expect(authAPI.login('a@b.c', 'x')).rejects.toThrow(/Cannot connect to server/);

    h.post.mockRejectedValueOnce(new Error('Network Error'));
    await expect(authAPI.login('a@b.c', 'x')).rejects.toThrow(/Network Error: Cannot reach/);
  });
});

describe('axios interceptors', () => {
  it('adds the stored token to every request', async () => {
    h.storage.set('userToken', 'jwt-abc');
    const config = await h.requestInterceptor!({ headers: {} , url: '/my-tasks' });
    expect(config.headers.Authorization).toBe('Bearer jwt-abc');
  });

  it('on 401 clears only the auth credentials and keeps the user for background tracking', async () => {
    h.storage.set('userToken', 'expired');
    h.storage.set('userEmail', 'budi@example.com');
    h.storage.set('user', JSON.stringify(USER));
    h.storage.set('active_task_u1', 'tt-1');

    const error = await throughInterceptor(httpError(401, 'Token expired'));

    expect(error).toMatchObject({ message: 'Invalid token', code: 'INVALID_TOKEN', response: { status: 401 } });
    expect(h.storage.has('userToken')).toBe(false);
    expect(h.storage.has('userEmail')).toBe(false);
    expect(h.storage.has('user')).toBe(true);
    expect(h.storage.get('active_task_u1')).toBe('tt-1');
  });

  it('passes other errors through unchanged', async () => {
    const original = httpError(500, 'boom');
    expect(await throughInterceptor(original)).toBe(original);
  });
});

describe('authAPI.logout', () => {
  it('clears the stored session', async () => {
    h.storage.set('userToken', 't');
    h.storage.set('userEmail', 'e');
    h.storage.set('user', '{}');
    h.post.mockResolvedValueOnce({ data: { message: 'ok' } });

    await authAPI.logout();

    expect([...h.storage.keys()]).toEqual([]);
  });

  it('still clears the session when the server call fails', async () => {
    h.storage.set('userToken', 't');
    h.storage.set('user', '{}');
    h.post.mockRejectedValueOnce(new Error('Network Error'));

    await expect(authAPI.logout()).rejects.toThrow();
    expect(h.storage.has('userToken')).toBe(false);
    expect(h.storage.has('user')).toBe(false);
  });

  it('no longer offers self-registration (removed from the backend)', () => {
    expect((authAPI as any).register).toBeUndefined();
  });
});
