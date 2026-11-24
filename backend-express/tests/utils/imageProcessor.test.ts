import { describe, it, expect, vi, beforeAll } from 'vitest';
import sharp from 'sharp';
import { compressImage, compressImages, createThumbnail, getImageInfo } from '../../src/utils/imageProcessor';

const pngBase64 = async (width: number, height: number, alpha = false) =>
  (await sharp({ create: { width, height, channels: alpha ? 4 : 3, background: { r: 10, g: 120, b: 200, alpha: 0.5 } } })
    .png().toBuffer()).toString('base64');

const metadataOf = (base64: string) => sharp(Buffer.from(base64, 'base64')).metadata();

beforeAll(() => {
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('imageProcessor', () => {
  it('compresses to JPEG and shrinks wide images to 1920px keeping the aspect ratio', async () => {
    const result = await compressImage(await pngBase64(2400, 1200));
    expect(await metadataOf(result)).toMatchObject({ format: 'jpeg', width: 1920, height: 960 });
  });

  it('respects a custom format and max width', async () => {
    const result = await compressImage(`data:image/png;base64,${await pngBase64(800, 400)}`, { format: 'webp', maxWidth: 400 });
    expect(await metadataOf(result)).toMatchObject({ format: 'webp', width: 400, height: 200 });
  });

  it('compresses several images in parallel, keeping order', async () => {
    const [a, b] = await compressImages([await pngBase64(100, 50), await pngBase64(50, 100)]);
    expect((await metadataOf(a)).width).toBe(100);
    expect((await metadataOf(b)).width).toBe(50);
  });

  it('creates a square JPEG thumbnail', async () => {
    const thumb = await createThumbnail(await pngBase64(640, 480), 120);
    expect(await metadataOf(thumb)).toMatchObject({ format: 'jpeg', width: 120, height: 120 });
  });

  it('reads image information without changing it', async () => {
    const info = await getImageInfo(await pngBase64(64, 32, true));
    expect(info).toMatchObject({ width: 64, height: 32, format: 'png', hasAlpha: true });
    expect(info.size).toBeGreaterThan(0);
  });

  it.each([
    ['compressImage', () => compressImage('bm90IGFuIGltYWdl'), 'Failed to compress image'],
    ['createThumbnail', () => createThumbnail('bm90IGFuIGltYWdl'), 'Failed to create thumbnail'],
    ['getImageInfo', () => getImageInfo('bm90IGFuIGltYWdl'), 'Failed to get image information'],
  ])('%s rejects data that is not an image', async (_name, run, message) => {
    await expect(run()).rejects.toThrow(message);
  });
});
