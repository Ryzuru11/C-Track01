import { getRedisClient } from '../config/redis';

type UsageSnapshot = {
  date: string;
  requests_today: number;
  tokens_used: number;
  quota_limit: number;
  quota_remaining: number;
  model_used: Record<string, number>;
};

type TrackUsageInput = {
  modelUsed: string;
  tokensUsed: number;
};

const DAY_SECONDS = 60 * 60 * 24 * 2;

const utcDayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const usageKey = () => `ai:tracker:day:${utcDayKey()}`;
const modelUsageKey = () => `ai:tracker:model:${utcDayKey()}`;

const inMemory = {
  day: '',
  requests: 0,
  tokens: 0,
  modelUsed: {} as Record<string, number>,
};

const resetMemoryIfNeeded = () => {
  const day = utcDayKey();
  if (inMemory.day === day) return;

  inMemory.day = day;
  inMemory.requests = 0;
  inMemory.tokens = 0;
  inMemory.modelUsed = {};
};

const resolveDailyLimit = () => {
  const parsed = Number(process.env.AI_DAILY_REQUEST_LIMIT || '350');
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 350;
};

export const getRequestsToday = async (): Promise<number> => {
  const redis = getRedisClient();

  if (redis) {
    const requests = await redis.hget(usageKey(), 'requests');
    return Number(requests || 0);
  }

  resetMemoryIfNeeded();
  return inMemory.requests;
};

export const trackAIUsage = async (input: TrackUsageInput) => {
  const tokens = Math.max(0, Math.floor(input.tokensUsed || 0));
  const redis = getRedisClient();

  if (redis) {
    const pipeline = redis.pipeline();
    pipeline.hincrby(usageKey(), 'requests', 1);
    pipeline.hincrby(usageKey(), 'tokens', tokens);
    pipeline.expire(usageKey(), DAY_SECONDS);

    pipeline.hincrby(modelUsageKey(), input.modelUsed, 1);
    pipeline.expire(modelUsageKey(), DAY_SECONDS);

    await pipeline.exec();
    return;
  }

  resetMemoryIfNeeded();
  inMemory.requests += 1;
  inMemory.tokens += tokens;
  inMemory.modelUsed[input.modelUsed] = (inMemory.modelUsed[input.modelUsed] || 0) + 1;
};

export const getAIUsageSnapshot = async (): Promise<UsageSnapshot> => {
  const limit = resolveDailyLimit();
  const redis = getRedisClient();

  if (redis) {
    const [usage, model] = await Promise.all([
      redis.hgetall(usageKey()),
      redis.hgetall(modelUsageKey()),
    ]);

    const requests = Number(usage.requests || 0);
    const tokens = Number(usage.tokens || 0);
    const modelUsed: Record<string, number> = {};
    for (const [key, value] of Object.entries(model || {})) {
      modelUsed[key] = Number(value || 0);
    }

    return {
      date: utcDayKey(),
      requests_today: requests,
      tokens_used: tokens,
      quota_limit: limit,
      quota_remaining: Math.max(0, limit - requests),
      model_used: modelUsed,
    };
  }

  resetMemoryIfNeeded();
  return {
    date: utcDayKey(),
    requests_today: inMemory.requests,
    tokens_used: inMemory.tokens,
    quota_limit: limit,
    quota_remaining: Math.max(0, limit - inMemory.requests),
    model_used: { ...inMemory.modelUsed },
  };
};
