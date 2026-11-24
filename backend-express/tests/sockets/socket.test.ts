import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { httpServer } from '../../src/app';
import { AddressInfo } from 'net';

describe('Socket.IO Real-time Integration', () => {
  let serverPort: number;
  let adminClient: ClientSocket;
  let employeeClient: ClientSocket;

  beforeAll(async () => {
    await new Promise<void>((resolve) => {
      httpServer.listen(0, () => {
        const addr = httpServer.address() as AddressInfo;
        serverPort = addr.port;
        resolve();
      });
    });
  });

  afterAll(async () => {
    if (adminClient && adminClient.connected) {
      adminClient.disconnect();
    }
    if (employeeClient && employeeClient.connected) {
      employeeClient.disconnect();
    }
    await new Promise<void>((resolve) => {
      httpServer.close(() => resolve());
    });
  });

  it('should allow admin user to connect and receive connected event', async () => {
    await new Promise<void>((resolve, reject) => {
      adminClient = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        query: { userId: 'admin-user' },
      });

      adminClient.on('connected', (data) => {
        try {
          expect(data).toHaveProperty('message', 'Connected to tracking server');
          expect(data.role).toBe('admin');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      adminClient.on('connect_error', (err) => reject(err));
    });
  });

  it('should allow employee user to connect with employee role', async () => {
    await new Promise<void>((resolve, reject) => {
      employeeClient = Client(`http://localhost:${serverPort}`, {
        transports: ['websocket'],
        query: { userId: 'emp-101' },
      });

      employeeClient.on('connected', (data) => {
        try {
          expect(data).toHaveProperty('message', 'Connected to tracking server');
          expect(data.role).toBe('employee');
          resolve();
        } catch (err) {
          reject(err);
        }
      });

      employeeClient.on('connect_error', (err) => reject(err));
    });
  });

  it('should reject employee trying to subscribe to another user location', async () => {
    await new Promise<void>((resolve, reject) => {
      employeeClient.emit('location:subscribe', { userId: 'target-user' });

      employeeClient.on('error', (err) => {
        try {
          expect(err.message).toMatch(/Unauthorized: Admin access required/i);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
    });
  });

  // Dev-mode connections (no token) pick their own userId, so they must never get into a chat room
  it('should refuse chat:join for an unauthenticated (no token) connection', async () => {
    await new Promise<void>((resolve, reject) => {
      employeeClient.once('chat:error', (err) => {
        try {
          expect(err.message).toMatch(/tidak memiliki akses/i);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      employeeClient.emit('chat:join', { takenTaskId: 'tt-1' });
    });
  });

  it('should refuse chat:send from a socket that has not joined the chat room', async () => {
    await new Promise<void>((resolve, reject) => {
      employeeClient.once('chat:error', (err) => {
        try {
          expect(err.message).toMatch(/tidak memiliki akses/i);
          resolve();
        } catch (e) {
          reject(e);
        }
      });
      employeeClient.emit('chat:send', { takenTaskId: 'tt-1', message: 'halo' });
    });
  });
});
