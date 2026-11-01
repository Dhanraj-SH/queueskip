import { Redis } from 'ioredis';
import { env } from './env.js';

export const criticalRedis = new Redis(env.REDIS_CRITICAL_URL, {
    lazyConnect: true,
    retryStrategy: () => null,
});

export const cacheRedis = new Redis(env.REDIS_CACHE_URL, {
    lazyConnect: true,
    retryStrategy: () => null,
});

export const connectRedis = async (): Promise<void> => {
    await Promise.all([criticalRedis.connect(), cacheRedis.connect()]);

    console.log('Redis connections established successfully');
};
