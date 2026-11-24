import crypto from 'crypto';
import { getRedisClient } from '../config/redis';

type CachedPayload = {
  answer: string;
  analyticsContext: Record<string, unknown>;
  source: 'ai' | 'rule-based';
  generatedAt: string;
};

const SIX_HOURS_SECONDS = 6 * 60 * 60;

const memoryCache = new Map<string, { expiresAt: number; value: CachedPayload }>();

export const createAiCacheKey = (question: string, userId: string, scope: Record<string, unknown>) => {
  const payload = JSON.stringify({
    question: question.trim().toLowerCase(),
    userId,
    scope,
  });

  const hash = crypto.createHash('sha256').update(payload).digest('hex');
  return `ai:question_hash:${hash}`;
};

export const getCachedAiAnswer = async (key: string): Promise<CachedPayload | null> => {
  const redis = getRedisClient();

  if (redis) {
    const raw = await redis.get(key);
    if (!raw) return null;

    try {
      return JSON.parse(raw) as CachedPayload;
    } catch {
      return null;
    }
  }

  const local = memoryCache.get(key);
  if (!local || local.expiresAt < Date.now()) {
    if (local) memoryCache.delete(key);
    return null;
  }

  return local.value;
};

export const setCachedAiAnswer = async (key: string, value: CachedPayload) => {
  const redis = getRedisClient();

  if (redis) {
    await redis.set(key, JSON.stringify(value), 'EX', SIX_HOURS_SECONDS);
    return;
  }

  memoryCache.set(key, {
    expiresAt: Date.now() + SIX_HOURS_SECONDS * 1000,
    value,
  });
};
