import { describe, it, expect, vi, beforeAll } from 'vitest';
import jwt from 'jsonwebtoken';
import { encrypt, decrypt, hash, verifyHash } from '../../src/utils/encryption';
import { hashPassword, comparePassword, generateToken } from '../../src/utils/auth';

beforeAll(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('encryption (AES-256-GCM)', () => {
  it('round-trips text, including long base64 image data and unicode', () => {
    const image = 'data:image/jpeg;base64,' + 'A'.repeat(50_000);
    expect(decrypt(encrypt(image))).toBe(image);
    expect(decrypt(encrypt('Laporan selesai ✅ – Jl. Malioboro'))).toBe('Laporan selesai ✅ – Jl. Malioboro');
  });

  it('uses a fresh IV, so the same text never encrypts to the same value', () => {
    expect(encrypt('same text')).not.toBe(encrypt('same text'));
  });

  it('detects tampering (authenticated encryption)', () => {
    const payload = JSON.parse(Buffer.from(encrypt('rahasia'), 'base64').toString('utf8'));
    const flipped = Buffer.from(payload.data, 'base64');
    flipped[0] ^= 0xff;
    const tampered = Buffer.from(JSON.stringify({ ...payload, data: flipped.toString('base64') })).toString('base64');

    expect(() => decrypt(tampered)).toThrow('Failed to decrypt data');
  });

  it('rejects garbage input', () => {
    expect(() => decrypt('bm90IGVuY3J5cHRlZA==')).toThrow('Failed to decrypt data');
  });

  it('hash is deterministic SHA-256 and verifyHash matches only the original', () => {
    expect(hash('abc')).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    expect(verifyHash('abc', hash('abc'))).toBe(true);
    expect(verifyHash('abd', hash('abc'))).toBe(false);
  });
});

describe('auth utils', () => {
  it('hashes passwords with bcrypt (salted) and verifies them', async () => {
    const first = await hashPassword('password123');
    const second = await hashPassword('password123');

    expect(first).toMatch(/^\$2[aby]\$10\$/);
    expect(first).not.toBe(second); // salted
    expect(await comparePassword('password123', first)).toBe(true);
    expect(await comparePassword('wrong', first)).toBe(false);
  });

  it('issues a JWT with the payload and an expiry', () => {
    const token = generateToken({ userId: 'u1', email: 'u1@example.com' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET || 'fallback-secret-key') as any;

    expect(decoded).toMatchObject({ userId: 'u1', email: 'u1@example.com' });
    expect(decoded.exp - decoded.iat).toBe(7 * 24 * 60 * 60); // default 7d
  });
});
