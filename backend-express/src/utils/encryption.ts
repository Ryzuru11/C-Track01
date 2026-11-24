import crypto from 'crypto';

/**
 * Encryption utility for sensitive data like images
 * Uses AES-256-GCM for authenticated encryption
 */

// Get encryption key from environment variable or use a default (should be changed in production)
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'your-32-character-secret-key!!'; // Must be 32 characters for AES-256
const ALGORITHM = 'aes-256-gcm';

/**
 * Ensures the encryption key is exactly 32 bytes
 */
function getEncryptionKey(): Buffer {
  const key = Buffer.from(ENCRYPTION_KEY);
  if (key.length !== 32) {
    // Hash the key to get exactly 32 bytes
    return crypto.createHash('sha256').update(String(ENCRYPTION_KEY)).digest();
  }
  return key;
}

/**
 * Encrypt a string (like base64 image data)
 * @param text - The text to encrypt
 * @returns Encrypted data as base64 string with IV and auth tag
 */
export function encrypt(text: string): string {
  try {
    const iv = crypto.randomBytes(16); // Initialization vector
    const key = getEncryptionKey();
    
    const cipher = crypto.createCipheriv(ALGORITHM, key, iv);
    
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    
    const authTag = cipher.getAuthTag();
    
    // Combine IV + Auth Tag + Encrypted Data
    const result = {
      iv: iv.toString('base64'),
      authTag: authTag.toString('base64'),
      data: encrypted
    };
    
    return Buffer.from(JSON.stringify(result)).toString('base64');
  } catch (error) {
    console.error('Encryption error:', error);
    throw new Error('Failed to encrypt data');
  }
}

/**
 * Decrypt an encrypted string
 * @param encryptedData - The encrypted data (base64 string)
 * @returns Decrypted original text
 */
export function decrypt(encryptedData: string): string {
  try {
    const jsonStr = Buffer.from(encryptedData, 'base64').toString('utf8');
    const { iv, authTag, data } = JSON.parse(jsonStr);
    
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv(
      ALGORITHM,
      key,
      Buffer.from(iv, 'base64')
    );
    
    decipher.setAuthTag(Buffer.from(authTag, 'base64'));
    
    let decrypted = decipher.update(data, 'base64', 'utf8');
    decrypted += decipher.final('utf8');
    
    return decrypted;
  } catch (error) {
    console.error('Decryption error:', error);
    throw new Error('Failed to decrypt data');
  }
}

/**
 * Hash a string using SHA-256 (one-way, for passwords, etc.)
 * @param text - The text to hash
 * @returns Hashed value as hex string
 */
export function hash(text: string): string {
  return crypto.createHash('sha256').update(text).digest('hex');
}

/**
 * Verify if a text matches a hash
 * @param text - The text to verify
 * @param hashedValue - The hash to compare against
 * @returns True if they match
 */
export function verifyHash(text: string, hashedValue: string): boolean {
  return hash(text) === hashedValue;
}
