import sharp from 'sharp';

/**
 * Image processing utility using Sharp
 * Compresses and optimizes images for storage
 */

export interface ImageCompressionOptions {
  maxWidth?: number;
  maxHeight?: number;
  quality?: number;
  format?: 'jpeg' | 'png' | 'webp';
}

const DEFAULT_OPTIONS: ImageCompressionOptions = {
  maxWidth: 1920,
  maxHeight: 1920,
  quality: 75,
  format: 'jpeg',
};

/**
 * Compress and optimize a base64 image using Sharp
 * @param base64Image - Base64 string (with or without data URI prefix)
 * @param options - Compression options
 * @returns Compressed base64 string
 */
export async function compressImage(
  base64Image: string,
  options: ImageCompressionOptions = {}
): Promise<string> {
  try {
    // Merge with default options
    const opts = { ...DEFAULT_OPTIONS, ...options };

    // Remove data URI prefix if present (data:image/jpeg;base64,)
    const base64Data = base64Image.includes(',') 
      ? base64Image.split(',')[1] 
      : base64Image;

    // Convert base64 to buffer
    const imageBuffer = Buffer.from(base64Data, 'base64');

    // Get image metadata
    const metadata = await sharp(imageBuffer).metadata();
    console.log(`📸 Original image: ${metadata.width}x${metadata.height}, ${metadata.format}, ${imageBuffer.length} bytes`);

    // Process image with Sharp
    let sharpInstance = sharp(imageBuffer);

    // Resize if needed (maintains aspect ratio)
    if (metadata.width && metadata.width > opts.maxWidth!) {
      sharpInstance = sharpInstance.resize(opts.maxWidth, opts.maxHeight, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Apply format-specific compression
    switch (opts.format) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({
          quality: opts.quality,
          progressive: true,
          mozjpeg: true, // Better compression
        });
        break;
      case 'webp':
        sharpInstance = sharpInstance.webp({
          quality: opts.quality,
        });
        break;
      case 'png':
        sharpInstance = sharpInstance.png({
          quality: opts.quality,
          compressionLevel: 9,
        });
        break;
    }

    // Convert back to buffer
    const compressedBuffer = await sharpInstance.toBuffer();
    
    // Convert to base64
    const compressedBase64 = compressedBuffer.toString('base64');

    const compressionRatio = ((1 - compressedBuffer.length / imageBuffer.length) * 100).toFixed(1);
    console.log(`✅ Compressed to: ${compressedBuffer.length} bytes (${compressionRatio}% reduction)`);

    return compressedBase64;
  } catch (error) {
    console.error('❌ Error compressing image:', error);
    throw new Error('Failed to compress image');
  }
}

/**
 * Process multiple images in parallel
 * @param base64Images - Array of base64 strings
 * @param options - Compression options
 * @returns Array of compressed base64 strings
 */
export async function compressImages(
  base64Images: string[],
  options: ImageCompressionOptions = {}
): Promise<string[]> {
  try {
    console.log(`📸 Processing ${base64Images.length} images...`);
    const startTime = Date.now();

    const compressed = await Promise.all(
      base64Images.map(img => compressImage(img, options))
    );

    const duration = Date.now() - startTime;
    console.log(`✅ Processed ${base64Images.length} images in ${duration}ms`);

    return compressed;
  } catch (error) {
    console.error('❌ Error compressing images:', error);
    throw new Error('Failed to compress images');
  }
}

/**
 * Get image information without processing
 * @param base64Image - Base64 string
 * @returns Image metadata
 */
export async function getImageInfo(base64Image: string) {
  try {
    const base64Data = base64Image.includes(',') 
      ? base64Image.split(',')[1] 
      : base64Image;

    const imageBuffer = Buffer.from(base64Data, 'base64');
    const metadata = await sharp(imageBuffer).metadata();

    return {
      width: metadata.width,
      height: metadata.height,
      format: metadata.format,
      size: imageBuffer.length,
      hasAlpha: metadata.hasAlpha,
    };
  } catch (error) {
    console.error('❌ Error getting image info:', error);
    throw new Error('Failed to get image information');
  }
}

/**
 * Create thumbnail from image
 * @param base64Image - Base64 string
 * @param size - Thumbnail size (default 200x200)
 * @returns Thumbnail as base64
 */
export async function createThumbnail(
  base64Image: string,
  size: number = 200
): Promise<string> {
  try {
    const base64Data = base64Image.includes(',') 
      ? base64Image.split(',')[1] 
      : base64Image;

    const imageBuffer = Buffer.from(base64Data, 'base64');

    const thumbnailBuffer = await sharp(imageBuffer)
      .resize(size, size, {
        fit: 'cover',
        position: 'center',
      })
      .jpeg({ quality: 80 })
      .toBuffer();

    return thumbnailBuffer.toString('base64');
  } catch (error) {
    console.error('❌ Error creating thumbnail:', error);
    throw new Error('Failed to create thumbnail');
  }
}
