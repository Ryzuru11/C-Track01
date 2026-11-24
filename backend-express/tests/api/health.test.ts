import { describe, it, expect } from 'vitest';
import request from 'supertest';
import app from '../../src/app';

describe('Health and Basic API Routes', () => {
  it('GET /api/health should return 200 with status ok', async () => {
    const response = await request(app).get('/api/health');
    expect(response.status).toBe(200);
    expect(response.body).toHaveProperty('status', 'ok');
    expect(response.body).toHaveProperty('time');
  });

  it('GET non-existent route should return 404 Route not found', async () => {
    const response = await request(app).get('/api/route-yang-tidak-ada-123');
    expect(response.status).toBe(404);
    expect(response.body).toHaveProperty('message', 'Route not found');
  });
});
