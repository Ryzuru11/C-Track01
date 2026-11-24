import { describe, it, expect, vi, beforeEach } from 'vitest';

const h = vi.hoisted(() => ({ post: vi.fn() }));

vi.mock('axios', () => ({
  default: {
    create: () => ({
      post: h.post,
      get: vi.fn(),
      put: vi.fn(),
      patch: vi.fn(),
      delete: vi.fn(),
      interceptors: { request: { use: vi.fn() }, response: { use: vi.fn() } },
    }),
  },
}));
vi.mock('@react-native-async-storage/async-storage', () => ({
  default: { getItem: vi.fn(async () => null), setItem: vi.fn(), removeItem: vi.fn() },
}));

import { locationsAPI } from '../../services/api';

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

describe('locationsAPI.recordLocation', () => {
  it('posts the record with the client UUID for idempotency', async () => {
    h.post.mockResolvedValueOnce({ data: { message: 'ok' } });

    await locationsAPI.recordLocation('tt-1', -7.79, 110.37, 8, 'Jl. Malioboro', 1700000000000, 'uuid-1', 'location');

    expect(h.post).toHaveBeenCalledWith('/locations', expect.objectContaining({
      id: 'uuid-1', takenTaskId: 'tt-1', latitude: -7.79, longitude: 110.37, recordedAt: 1700000000000, recordType: 'location',
    }));
  });

  it('sends explicit nulls for a heartbeat', async () => {
    h.post.mockResolvedValueOnce({ data: {} });
    await locationsAPI.recordLocation('tt-1', null, null, 0, undefined, 1, 'uuid-2', 'heartbeat');
    expect(h.post.mock.calls[0][1]).toMatchObject({ latitude: null, longitude: null, recordType: 'heartbeat' });
  });

  it('keeps the HTTP status on the thrown error so the upload worker can drop 4xx records', async () => {
    h.post.mockRejectedValueOnce(Object.assign(new Error('Request failed with status code 400'), {
      response: { status: 400, data: { message: 'Invalid latitude/longitude' } },
    }));

    await expect(locationsAPI.recordLocation('tt-1', null, null)).rejects.toMatchObject({
      message: 'Invalid latitude/longitude',
      response: { status: 400 },
    });
  });

  it('a network error has no response (treated as transient by the worker)', async () => {
    h.post.mockRejectedValueOnce(Object.assign(new Error('Network Error'), { code: 'ERR_NETWORK' }));

    const error: any = await locationsAPI.recordLocation('tt-1', -7.79, 110.37).catch((e) => e);
    expect(error.message).toBe('Network Error');
    expect(error.response).toBeUndefined();
    expect(error.code).toBe('ERR_NETWORK');
  });
});
