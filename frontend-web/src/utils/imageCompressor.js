/**
 * Image Compression & Cropping Utility
 * Handles client-side image optimization before uploading
 */

/**
 * Compress and optionally crop image to square
 * @param {string} base64String - Base64 encoded image
 * @param {Object} options - Configuration options
 * @param {number} options.maxWidth - Max width in pixels (default: 500)
 * @param {number} options.maxHeight - Max height in pixels (default: 500)
 * @param {number} options.quality - JPEG quality 0-1 (default: 0.8)
 * @param {boolean} options.cropToSquare - Crop to square for avatars (default: true)
 * @returns {Promise<string>} Compressed base64 string
 */
export const compressAndCropImage = async (
  base64String,
  options = {}
) => {
  const {
    maxWidth = 500,
    maxHeight = 500,
    quality = 0.8,
    cropToSquare = true
  } = options;

  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      try {
        // Calculate dimensions
        let targetWidth = img.width;
        let targetHeight = img.height;

        // Crop to square first if enabled (for avatars)
        if (cropToSquare) {
          const minDimension = Math.min(img.width, img.height);
          targetWidth = minDimension;
          targetHeight = minDimension;
        }

        // Scale down if exceeds max dimensions
        const scale = Math.min(1, maxWidth / targetWidth, maxHeight / targetHeight);
        targetWidth = Math.round(targetWidth * scale);
        targetHeight = Math.round(targetHeight * scale);

        // Create canvas
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;

        const ctx = canvas.getContext('2d');
        if (!ctx) {
          reject(new Error('Could not get canvas context'));
          return;
        }

        // Calculate crop position (center crop)
        let sourceX = 0;
        let sourceY = 0;
        if (cropToSquare) {
          const minDimension = Math.min(img.width, img.height);
          sourceX = (img.width - minDimension) / 2;
          sourceY = (img.height - minDimension) / 2;
          
          ctx.drawImage(
            img,
            sourceX, sourceY, minDimension, minDimension,
            0, 0, targetWidth, targetHeight
          );
        } else {
          // Scale without cropping (maintain aspect ratio)
          const offsetX = (targetWidth - img.width * scale) / 2;
          const offsetY = (targetHeight - img.height * scale) / 2;
          ctx.drawImage(img, offsetX, offsetY, img.width * scale, img.height * scale);
        }

        // Convert to base64
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        
        // Log compression stats
        const originalSizeKB = (base64String.length / 1024).toFixed(2);
        const compressedSizeKB = (compressedBase64.length / 1024).toFixed(2);
        const reduction = (100 - (compressedSizeKB / originalSizeKB * 100)).toFixed(1);

        console.log(`🖼️  Image Compression Summary:`);
        console.log(`   Original size: ${originalSizeKB}KB`);
        console.log(`   Compressed size: ${compressedSizeKB}KB`);
        console.log(`   Reduction: ${reduction}% smaller`);
        console.log(`   Dimensions: ${targetWidth}x${targetHeight}px`);
        console.log(`   Quality: ${(quality * 100).toFixed(0)}%`);
        if (cropToSquare) {
          console.log(`   ✓ Cropped to square (center crop)`);
        }

        resolve(compressedBase64);
      } catch (error) {
        reject(new Error(`Image compression failed: ${error.message}`));
      }
    };

    img.onerror = () => {
      reject(new Error('Failed to load image for compression'));
    };

    img.src = base64String;
  });
};

/**
 * Get image dimensions from base64 string
 * @param {string} base64String - Base64 encoded image
 * @returns {Promise<{width: number, height: number}>} Image dimensions
 */
export const getImageDimensions = (base64String) => {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.width, height: img.height });
    };
    img.onerror = () => {
      reject(new Error('Failed to load image'));
    };
    img.src = base64String;
  });
};
