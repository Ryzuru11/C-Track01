import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import fs from 'fs';
import os from 'os';
import path from 'path';
import sharp from 'sharp';

// fileStorage reads UPLOAD_DIR when it is imported, so point it at a temp folder first
const UPLOAD_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ctrack-uploads-'));
let storage: typeof import('../../src/utils/fileStorage');

const pngBase64 = async (width: number, height: number) =>
  (await sharp({ create: { width, height, channels: 3, background: { r: 200, g: 40, b: 40 } } }).png().toBuffer()).toString('base64');

beforeAll(async () => {
  process.env.UPLOAD_DIR = UPLOAD_DIR;
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  storage = await import('../../src/utils/fileStorage');
});

afterAll(() => {
  delete process.env.UPLOAD_DIR;
  fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

describe('fileStorage', () => {
  it('creates the upload folders on import', () => {
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'reports'))).toBe(true);
    expect(fs.existsSync(path.join(UPLOAD_DIR, 'thumbnails'))).toBe(true);
  });

  it('saves a large photo as a compressed JPEG no wider than 1920px, plus a 300x300 thumbnail', async () => {
    const { filename, thumbnail } = await storage.saveImageToDisk(await pngBase64(3000, 2000));

    expect(filename).toMatch(/^[0-9a-f-]{36}\.jpeg$/);
    const saved = await sharp(storage.getImagePath(filename)).metadata();
    expect(saved).toMatchObject({ format: 'jpeg', width: 1920, height: 1280 });

    expect(thumbnail).toBe(`thumb_${filename}`);
    const thumb = await sharp(storage.getThumbnailPath(filename)).metadata();
    expect(thumb).toMatchObject({ width: 300, height: 300 });
  });

  it('never enlarges a small photo', async () => {
    const { filename } = await storage.saveImageToDisk(await pngBase64(640, 480));
    expect(await sharp(storage.getImagePath(filename)).metadata()).toMatchObject({ width: 640, height: 480 });
  });

  it('accepts a data URI prefix (as sent by the mobile app)', async () => {
    const { filename } = await storage.saveImageToDisk(`data:image/png;base64,${await pngBase64(50, 50)}`);
    expect(storage.imageExists(filename)).toBe(true);
  });

  it('can skip the thumbnail', async () => {
    const { thumbnail } = await storage.saveImageToDisk(await pngBase64(50, 50), { createThumbnail: false });
    expect(thumbnail).toBeUndefined();
  });

  it('burns the GPS watermark into the saved photo and thumbnail', async () => {
    const { filename, thumbnail } = await storage.saveImageToDisk(await pngBase64(640, 480), {
      watermark: {
        latitude: -6.2,
        longitude: 106.8,
        taskLatitude: -6.2,
        taskLongitude: 106.8,
        serverCapturedAt: new Date('2026-11-24T10:00:00.000Z'),
      },
    });

    const savedPhoto = await sharp(storage.getImagePath(filename)).raw().toBuffer({ resolveWithObject: true });
    const overlayPixelOffset = ((savedPhoto.info.height - 5) * savedPhoto.info.width + 5) * savedPhoto.info.channels;
    expect(savedPhoto.data[overlayPixelOffset]).toBeLessThan(100);
    expect(thumbnail).toBeDefined();
    expect(await sharp(storage.getThumbnailPath(filename)).metadata()).toMatchObject({ width: 300, height: 300 });
  });

  it.each([
    ['empty data', ''],
    ['non-base64 characters', 'not base64!!'],
    ['base64 that is not an image', Buffer.from('hello world, definitely not a picture').toString('base64')],
  ])('rejects %s without leaving a file behind', async (_label, input) => {
    const before = fs.readdirSync(path.join(UPLOAD_DIR, 'reports')).length;
    await expect(storage.saveImageToDisk(input)).rejects.toThrow('Failed to save image');
    expect(fs.readdirSync(path.join(UPLOAD_DIR, 'reports')).length).toBe(before);
  });

  it('saves several photos at once', async () => {
    const results = await storage.saveImagesToDisk([await pngBase64(20, 20), await pngBase64(30, 30)]);
    expect(results).toHaveLength(2);
    expect(new Set(results.map((r) => r.filename)).size).toBe(2);
  });

  it('deletes a photo together with its thumbnail', async () => {
    const { filename } = await storage.saveImageToDisk(await pngBase64(50, 50));
    storage.deleteImageFile(filename);
    expect(storage.imageExists(filename)).toBe(false);
    expect(fs.existsSync(storage.getThumbnailPath(filename))).toBe(false);
  });

  it('deleting a missing photo does not throw', () => {
    expect(() => storage.deleteImageFiles(['does-not-exist.jpeg'])).not.toThrow();
  });

  it('refuses path traversal when deleting', () => {
    const outside = path.join(UPLOAD_DIR, 'keep-me.txt');
    fs.writeFileSync(outside, 'important');

    storage.deleteImageFile('../keep-me.txt');
    storage.deleteImageFile(outside); // absolute path

    expect(fs.existsSync(outside)).toBe(true);
  });

  it('reports file statistics, or null for a missing file', async () => {
    const { filename } = await storage.saveImageToDisk(await pngBase64(50, 50));
    expect(storage.getImageStats(filename)?.size).toBeGreaterThan(0);
    expect(storage.getImageStats('missing.jpeg')).toBeNull();
  });
});
