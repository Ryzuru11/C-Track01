import crypto from 'crypto';
import { getRedisClient } from '../config/redis';

type CachedAiEntry = {
  answer: string;
  source: 'ai' | 'rule-based';
  modelUsed?: string;
  generatedAt: string;
};

const SIX_HOURS_SECONDS = 6 * 60 * 60;
const memoryCache = new Map<string, { value: CachedAiEntry; expiresAt: number }>();

export const buildAiCacheKey = (message: string, scope?: Record<string, unknown>) => {
  const hash = crypto
    .createHash('sha256')
    .update(
      JSON.stringify({
        message: message.trim().toLowerCase(),
        scope: scope || {},
      })
    )
    .digest('hex');

  return `ai_cache:${hash}`;
};

export const getAiCache = async (key: string): Promise<CachedAiEntry | null> => {
  const redis = getRedisClient();

  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;
    try {
      return JSON.parse(raw) as CachedAiEntry;
    } catch {
      return null;
    }
  }

  const hit = memoryCache.get(key);
  if (!hit || hit.expiresAt < Date.now()) {
    if (hit) memoryCache.delete(key);
    return null;
  }

  return hit.value;
};

export const setAiCache = async (key: string, entry: CachedAiEntry) => {
  const redis = getRedisClient();

  if (redis) {
    await redis.set(key, JSON.stringify(entry), 'EX', SIX_HOURS_SECONDS);
    return;
  }

  memoryCache.set(key, {
    value: entry,
    expiresAt: Date.now() + SIX_HOURS_SECONDS * 1000,
  });
};
