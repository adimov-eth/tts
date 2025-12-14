import { getRedis } from './client';

export const RATE_LIMIT_REQUESTS_PER_MINUTE = 10;
export const RATE_LIMIT_CHARS_PER_DAY = 20_000;

export interface RateLimitResult {
  allowed: boolean;
  reason?: 'minute_limit' | 'day_limit';
  shouldNotify?: boolean; // true if soft limit hit and not yet notified today
}

/**
 * Check if a request is within rate limits
 * - Hard limit: 10 requests per minute
 * - Soft limit: 20,000 characters per day (allows but notifies)
 */
export async function checkRateLimit(chatId: number, charCount: number): Promise<RateLimitResult> {
  const redis = getRedis();
  const now = Date.now();
  const minuteKey = Math.floor(now / 60000);
  const dateKey = new Date().toISOString().split('T')[0]; // YYYY-MM-DD

  const minuteRateLimitKey = `tts:rate:min:${chatId}:${minuteKey}`;
  const dayRateLimitKey = `tts:rate:day:${chatId}:${dateKey}`;
  const notifiedKey = `tts:rate:notified:${chatId}:${dateKey}`;

  // Check minute limit (hard limit)
  const minuteCount = await redis.get(minuteRateLimitKey);
  if (minuteCount && parseInt(minuteCount) >= RATE_LIMIT_REQUESTS_PER_MINUTE) {
    return {
      allowed: false,
      reason: 'minute_limit',
    };
  }

  // Check day limit (soft limit - allow but notify)
  const dayCount = await redis.get(dayRateLimitKey);
  const currentDayChars = dayCount ? parseInt(dayCount) : 0;
  const wouldExceedDayLimit = currentDayChars + charCount > RATE_LIMIT_CHARS_PER_DAY;

  if (wouldExceedDayLimit) {
    // Check if we've already notified today
    const hasNotified = await redis.get(notifiedKey);
    return {
      allowed: true,
      reason: 'day_limit',
      shouldNotify: !hasNotified,
    };
  }

  return { allowed: true };
}

/**
 * Increment usage counters after successful request
 */
export async function incrementUsage(chatId: number, charCount: number): Promise<void> {
  const redis = getRedis();
  const now = Date.now();
  const minuteKey = Math.floor(now / 60000);
  const dateKey = new Date().toISOString().split('T')[0];

  const minuteRateLimitKey = `tts:rate:min:${chatId}:${minuteKey}`;
  const dayRateLimitKey = `tts:rate:day:${chatId}:${dateKey}`;

  // Use pipeline for atomic operations
  const pipeline = redis.pipeline();

  // Increment minute counter with TTL
  pipeline.incr(minuteRateLimitKey);
  pipeline.expire(minuteRateLimitKey, 120); // 2 minutes TTL

  // Increment day counter with TTL
  pipeline.incrby(dayRateLimitKey, charCount);
  pipeline.expire(dayRateLimitKey, 48 * 60 * 60); // 48 hours TTL

  await pipeline.exec();
}

/**
 * Mark that the user has been notified about exceeding daily limit
 */
export async function markNotified(chatId: number): Promise<void> {
  const redis = getRedis();
  const dateKey = new Date().toISOString().split('T')[0];
  const notifiedKey = `tts:rate:notified:${chatId}:${dateKey}`;

  await redis.set(notifiedKey, '1', 'EX', 48 * 60 * 60); // 48 hours TTL
}

/**
 * Get current usage stats for a chat (for debugging/admin purposes)
 */
export async function getUsage(chatId: number): Promise<{ minuteRequests: number; dayChars: number }> {
  const redis = getRedis();
  const now = Date.now();
  const minuteKey = Math.floor(now / 60000);
  const dateKey = new Date().toISOString().split('T')[0];

  const minuteRateLimitKey = `tts:rate:min:${chatId}:${minuteKey}`;
  const dayRateLimitKey = `tts:rate:day:${chatId}:${dateKey}`;

  const [minuteCount, dayCount] = await Promise.all([
    redis.get(minuteRateLimitKey),
    redis.get(dayRateLimitKey),
  ]);

  return {
    minuteRequests: minuteCount ? parseInt(minuteCount) : 0,
    dayChars: dayCount ? parseInt(dayCount) : 0,
  };
}
