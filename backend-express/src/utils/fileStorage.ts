import fs from 'fs';
import path from 'path';
import { v4 as uuidv4 } from 'uuid';
import sharp from 'sharp';
import { PhotoWatermarkData, buildPhotoWatermarkSvg } from './photoWatermark';

/**
 * File storage utility for saving images to disk
 */

// Upload directory configuration
const UPLOAD_DIR = process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads');
const REPORTS_DIR = path.join(UPLOAD_DIR, 'reports');
const THUMBNAILS_DIR = path.join(UPLOAD_DIR, 'thumbnails');

/**
 * Ensure upload directories exist with proper permissions
 */
export function ensureUploadDirs() {
  [UPLOAD_DIR, REPORTS_DIR, THUMBNAILS_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true, mode: 0o755 });
      console.log(`📁 Created directory: ${dir}`);
    }
    
    // Verify directory is writable
    try {
      fs.accessSync(dir, fs.constants.W_OK);
    } catch (error) {
      console.error(`❌ Directory ${dir} is not writable!`);
      throw new Error(`Upload directory ${dir} is not writable. Check permissions.`);
    }
  });
}

/**
 * Save base64 image to disk and return filename
 * @param base64Image - Base64 string (with or without data URI prefix)
 * @param options - Compression options
 * @returns Filename of saved image
 */
export async function saveImageToDisk(
  base64Image: string,
  options: {
    maxWidth?: number;
    quality?: number;
    format?: 'jpeg' | 'png' | 'webp';
    createThumbnail?: boolean;
    watermark?: PhotoWatermarkData;
  } = {}
): Promise<{ filename: string; thumbnail?: string }> {
  try {
    ensureUploadDirs();

    const opts = {
      maxWidth: options.maxWidth || 1920,
      quality: options.quality || 75,
      format: options.format || 'jpeg',
      createThumbnail: options.createThumbnail !== false,
      watermark: options.watermark,
    };

    // Remove data URI prefix if present
    const base64Data = base64Image.includes(',') 
      ? base64Image.split(',')[1] 
      : base64Image;

    // Validate base64 string
    if (!base64Data || base64Data.length === 0) {
      throw new Error('Empty or invalid base64 image data');
    }

    // Validate base64 format (basic check)
    if (!/^[A-Za-z0-9+/=]+$/.test(base64Data)) {
      throw new Error('Invalid base64 format');
    }

    // Convert base64 to buffer
    let imageBuffer: Buffer;
    try {
      imageBuffer = Buffer.from(base64Data, 'base64');
      if (imageBuffer.length === 0) {
        throw new Error('Buffer is empty after base64 decode');
      }
    } catch (bufferError) {
      console.error('❌ Failed to decode base64:', bufferError);
      throw new Error('Failed to decode base64 image data');
    }
    
    // Get image metadata (validates it's actually an image)
    let metadata;
    try {
      if (opts.watermark) {
        imageBuffer = await sharp(imageBuffer).rotate().toBuffer();
      }
      metadata = await sharp(imageBuffer).metadata();
      if (!metadata.width || !metadata.height || !metadata.format) {
        throw new Error('Invalid image: missing dimensions or format');
      }
      console.log(`📸 Processing image: ${metadata.width}x${metadata.height}, ${metadata.format}, ${imageBuffer.length} bytes`);
    } catch (metadataError) {
      console.error('❌ Failed to read image metadata:', metadataError);
      throw new Error('Invalid image data or corrupted file');
    }

    // Generate unique filename
    const filename = `${uuidv4()}.${opts.format}`;
    const filepath = path.join(REPORTS_DIR, filename);

    // Process and save main image with Sharp
    let sharpInstance = sharp(imageBuffer);

    if (opts.watermark) {
      sharpInstance = sharpInstance.composite([
        {
          input: buildPhotoWatermarkSvg(metadata.width!, opts.watermark),
          gravity: 'south',
        },
      ]);
    }

    // Resize if needed
    if (metadata.width && metadata.width > opts.maxWidth) {
      sharpInstance = sharpInstance.resize(opts.maxWidth, undefined, {
        fit: 'inside',
        withoutEnlargement: true,
      });
    }

    // Apply compression based on format
    switch (opts.format) {
      case 'jpeg':
        sharpInstance = sharpInstance.jpeg({
          quality: opts.quality,
          progressive: true,
          mozjpeg: true,
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

    // Save to disk (Sharp automatically handles binary mode correctly)
    await sharpInstance.toFile(filepath);
    
    // Validate file was written correctly
    if (!fs.existsSync(filepath)) {
      throw new Error(`File ${filename} was not created`);
    }
    
    const stats = fs.statSync(filepath);
    if (stats.size === 0) {
      throw new Error(`File ${filename} is empty (0 bytes)`);
    }
    
    // Verify file is valid image by reading it with Sharp
    try {
      const savedMetadata = await sharp(filepath).metadata();
      if (!savedMetadata.format || !savedMetadata.width || !savedMetadata.height) {
        throw new Error(`File ${filename} is corrupted or invalid`);
      }
      console.log(`✅ Validated: ${filename} is valid ${savedMetadata.format} (${savedMetadata.width}x${savedMetadata.height})`);
    } catch (validationError) {
      // File is corrupted, delete it
      fs.unlinkSync(filepath);
      throw new Error(`Saved file ${filename} failed validation, deleted corrupted file`);
    }
    
    const compressionRatio = ((1 - stats.size / imageBuffer.length) * 100).toFixed(1);
    console.log(`💾 Saved: ${filename} (${stats.size} bytes, ${compressionRatio}% reduction)`);

    // Create thumbnail if requested
    let thumbnailFilename: string | undefined;
    if (opts.createThumbnail) {
      thumbnailFilename = `thumb_${filename}`;
      const thumbnailPath = path.join(THUMBNAILS_DIR, thumbnailFilename);
      
      await sharp(filepath)
        .resize(300, 300, {
          fit: 'cover',
          position: 'center',
        })
        .jpeg({ quality: 80 })
        .toFile(thumbnailPath);
      
      // Validate thumbnail too
      if (!fs.existsSync(thumbnailPath) || fs.statSync(thumbnailPath).size === 0) {
        console.warn(`⚠️  Thumbnail ${thumbnailFilename} creation failed`);
        thumbnailFilename = undefined;
      } else {
        console.log(`🖼️  Created thumbnail: ${thumbnailFilename}`);
      }
    }

    return {
      filename,
      thumbnail: thumbnailFilename,
    };
  } catch (error) {
    console.error('❌ Error saving image to disk:', error);
    throw new Error('Failed to save image');
  }
}

/**
 * Save multiple images to disk
 * @param base64Images - Array of base64 strings
 * @param options - Compression options
 * @returns Array of filenames
 */
export async function saveImagesToDisk(
  base64Images: string[],
  options = {}
): Promise<Array<{ filename: string; thumbnail?: string }>> {
  try {
    console.log(`📸 Saving ${base64Images.length} images to disk...`);
    const startTime = Date.now();

    const results = await Promise.all(
      base64Images.map(img => saveImageToDisk(img, options))
    );

    const duration = Date.now() - startTime;
    console.log(`✅ Saved ${base64Images.length} images in ${duration}ms`);

    return results;
  } catch (error) {
    console.error('❌ Error saving images:', error);
    throw new Error('Failed to save images');
  }
}

/**
 * Delete image file from disk
 * @param filename - Name of file to delete
 */
export function deleteImageFile(filename: string): void {
  try {
    // Only plain file names inside the upload folder (never "../" or absolute paths)
    if (!filename || filename !== path.basename(filename) || filename === '.' || filename === '..') {
      console.warn(`⚠️  Refusing to delete suspicious image name: ${filename}`);
      return;
    }

    const filepath = path.join(REPORTS_DIR, filename);
    if (fs.existsSync(filepath)) {
      fs.unlinkSync(filepath);
      console.log(`🗑️  Deleted: ${filename}`);
    }

    // Delete thumbnail if exists
    const thumbnailPath = path.join(THUMBNAILS_DIR, `thumb_${filename}`);
    if (fs.existsSync(thumbnailPath)) {
      fs.unlinkSync(thumbnailPath);
      console.log(`🗑️  Deleted thumbnail: thumb_${filename}`);
    }
  } catch (error) {
    console.error(`❌ Error deleting image ${filename}:`, error);
  }
}

/**
 * Delete multiple image files
 * @param filenames - Array of filenames to delete
 */
export function deleteImageFiles(filenames: string[]): void {
  filenames.forEach(filename => deleteImageFile(filename));
}

/**
 * Get full path to image file
 * @param filename - Image filename
 * @returns Full path to file
 */
export function getImagePath(filename: string): string {
  return path.join(REPORTS_DIR, filename);
}

/**
 * Get full path to thumbnail
 * @param filename - Image filename
 * @returns Full path to thumbnail
 */
export function getThumbnailPath(filename: string): string {
  return path.join(THUMBNAILS_DIR, `thumb_${filename}`);
}

/**
 * Check if image file exists
 * @param filename - Image filename
 * @returns True if file exists
 */
export function imageExists(filename: string): boolean {
  return fs.existsSync(getImagePath(filename));
}

/**
 * Get image statistics
 * @param filename - Image filename
 * @returns File size and created date
 */
export function getImageStats(filename: string) {
  try {
    const filepath = getImagePath(filename);
    const stats = fs.statSync(filepath);
    return {
      size: stats.size,
      created: stats.birthtime,
      modified: stats.mtime,
    };
  } catch (error) {
    return null;
  }
}

// Initialize upload directories on module load
ensureUploadDirs();
