import { describe, it, expect, vi } from 'vitest';
import { authenticate } from '../../src/middleware/auth';
import { AppError } from '../../src/middleware/errorHandler';
import jwt from 'jsonwebtoken';

describe('Auth Middleware', () => {
  it('should call next with 401 AppError if authorization header is missing', async () => {
    const req: any = { headers: {} };
    const res: any = {};
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('No token provided');
  });

  it('should call next with 401 AppError if token is invalid', async () => {
    const req: any = { headers: { authorization: 'Bearer token-ngawur-123' } };
    const res: any = {};
    const next = vi.fn();

    await authenticate(req, res, next);

    expect(next).toHaveBeenCalledTimes(1);
    const error = next.mock.calls[0][0];
    expect(error).toBeInstanceOf(AppError);
    expect(error.statusCode).toBe(401);
    expect(error.message).toBe('Invalid token');
  });
});
