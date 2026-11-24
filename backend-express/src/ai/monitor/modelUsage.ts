import {
  ALL_AI_MODELS,
  AI_MODEL_LIMITS,
  AIModelName,
} from '../config/modelLimits';
import { getRedisClient } from '../../config/redis';

type UsageCounters = {
  requestsMinute: number;
  requestsDay: number;
  tokensMinute: number;
  tokensDay: number;
};

type ModelLimitStatus = UsageCounters & {
  model: AIModelName;
  limits: {
    rpm: number;
    rpd: number;
    tpm: number;
  };
  remainingRequestsMinute: number;
  remainingRequestsDay: number;
  remainingTokensMinute: number;
  requestUsagePercent: number;
  tokenUsagePercent: number;
  allowed: boolean;
  blockedBy?: 'rpm' | 'rpd' | 'tpm';
};

const DAY_SECONDS = 60 * 60 * 24 * 2;
const MINUTE_SECONDS = 60 * 60 * 2;

const inMemoryUsage = new Map<
  string,
  { requests: number; tokens: number; expiresAt: number }
>();

const utcDayKey = () => new Date().toISOString().slice(0, 10).replace(/-/g, '');
const utcMinuteKey = () => new Date().toISOString().slice(0, 16).replace(/[-:T]/g, '');

const redisDayHashKey = (model: AIModelName) =>
  `ai:usage:${model}:day:${utcDayKey()}`;
const redisMinuteHashKey = (model: AIModelName) =>
  `ai:usage:${model}:min:${utcMinuteKey()}`;

const memoryKey = (model: AIModelName, period: 'day' | 'minute') =>
  `mem:${period}:${model}:${period === 'day' ? utcDayKey() : utcMinuteKey()}`;

const getMemoryCounters = (model: AIModelName, period: 'day' | 'minute') => {
  const key = memoryKey(model, period);
  const data = inMemoryUsage.get(key);
  if (!data || data.expiresAt < Date.now()) {
    if (data) inMemoryUsage.delete(key);
    return { requests: 0, tokens: 0 };
  }

  return { requests: data.requests, tokens: data.tokens };
};

const setMemoryCounters = (
  model: AIModelName,
  period: 'day' | 'minute',
  requestsIncrement: number,
  tokensIncrement: number
) => {
  const key = memoryKey(model, period);
  const existing = getMemoryCounters(model, period);

  const ttlMs = (period === 'day' ? DAY_SECONDS : MINUTE_SECONDS) * 1000;

  inMemoryUsage.set(key, {
    requests: existing.requests + requestsIncrement,
    tokens: existing.tokens + tokensIncrement,
    expiresAt: Date.now() + ttlMs,
  });
};

const getUsageCounters = async (model: AIModelName): Promise<UsageCounters> => {
  const redis = getRedisClient();

  if (redis) {
    const [day, minute] = await Promise.all([
      redis.hgetall(redisDayHashKey(model)),
      redis.hgetall(redisMinuteHashKey(model)),
    ]);

    return {
      requestsMinute: Number(minute.requests || 0),
      requestsDay: Number(day.requests || 0),
      tokensMinute: Number(minute.tokens || 0),
      tokensDay: Number(day.tokens || 0),
    };
  }

  const day = getMemoryCounters(model, 'day');
  const minute = getMemoryCounters(model, 'minute');

  return {
    requestsMinute: minute.requests,
    requestsDay: day.requests,
    tokensMinute: minute.tokens,
    tokensDay: day.tokens,
  };
};

export const trackModelUsage = async (
  model: AIModelName,
  tokensUsed: number
) => {
  const redis = getRedisClient();

  if (redis) {
    const dayKey = redisDayHashKey(model);
    const minuteKey = redisMinuteHashKey(model);

    const pipeline = redis.pipeline();
    pipeline.hincrby(dayKey, 'requests', 1);
    pipeline.hincrby(dayKey, 'tokens', Math.max(0, Math.floor(tokensUsed)));
    pipeline.expire(dayKey, DAY_SECONDS);

    pipeline.hincrby(minuteKey, 'requests', 1);
    pipeline.hincrby(minuteKey, 'tokens', Math.max(0, Math.floor(tokensUsed)));
    pipeline.expire(minuteKey, MINUTE_SECONDS);

    await pipeline.exec();
    return;
  }

  setMemoryCounters(model, 'day', 1, tokensUsed);
  setMemoryCounters(model, 'minute', 1, tokensUsed);
};

export const getModelLimitStatus = async (
  model: AIModelName,
  expectedTokens: number = 0
): Promise<ModelLimitStatus> => {
  const counters = await getUsageCounters(model);
  const limits = AI_MODEL_LIMITS[model];

  const remainingRequestsMinute = Math.max(0, limits.rpm - counters.requestsMinute);
  const remainingRequestsDay = Math.max(0, limits.rpd - counters.requestsDay);
  const remainingTokensMinute = Math.max(
    0,
    limits.tpm - counters.tokensMinute - expectedTokens
  );

  let blockedBy: ModelLimitStatus['blockedBy'];
  if (counters.requestsMinute >= limits.rpm) blockedBy = 'rpm';
  else if (counters.requestsDay >= limits.rpd) blockedBy = 'rpd';
  else if (counters.tokensMinute + expectedTokens > limits.tpm) blockedBy = 'tpm';

  const allowed = !blockedBy;

  return {
    model,
    ...counters,
    limits,
    remainingRequestsMinute,
    remainingRequestsDay,
    remainingTokensMinute,
    requestUsagePercent: Number(((counters.requestsDay / limits.rpd) * 100).toFixed(2)),
    tokenUsagePercent: Number(((counters.tokensDay / Math.max(limits.tpm, 1)) * 100).toFixed(2)),
    allowed,
    blockedBy,
  };
};

export const getAllModelUsageStats = async () => {
  const rows = await Promise.all(
    ALL_AI_MODELS.map(async (model) => getModelLimitStatus(model, 0))
  );

  return {
    models: rows,
    generatedAt: new Date().toISOString(),
  };
};
