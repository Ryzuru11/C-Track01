const IORedis = require('ioredis');

type RedisClient = any;

let redisClient: RedisClient | null = null;

export const getRedisClient = (): RedisClient | null => {
  if (redisClient) return redisClient;

  const redisUrl = process.env.REDIS_URL;
  if (!redisUrl) return null;

  redisClient = new IORedis(redisUrl, {
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });

  redisClient.on('error', (error: unknown) => {
    const normalizedError = error as { message?: string };
    console.error('[Redis] Client error:', normalizedError?.message || error);
  });

  return redisClient;
};

export const getBullMqConnection = () => {
  const redis = getRedisClient();
  if (!redis) return null;

  return redis.duplicate({
    maxRetriesPerRequest: null,
    enableReadyCheck: true,
    lazyConnect: true,
  });
};
