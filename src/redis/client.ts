import { Redis } from 'ioredis';

let redisClient: Redis | null = null;

export function getRedis(): Redis {
    if (!redisClient) {
        redisClient = new Redis({
            host: process.env.REDIS_HOST || 'localhost',
            port: parseInt(process.env.REDIS_PORT || '6379'),
            maxRetriesPerRequest: null,
        });
    }
    return redisClient;
}

export async function closeRedis(): Promise<void> {
    if (redisClient) {
        const client = redisClient;
        redisClient = null;
        await client.quit();
    }
}
