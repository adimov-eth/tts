import { describe, it, expect, beforeEach, vi } from 'vitest';
import { getMockRedis, resetMockRedis } from '../mocks/redis';

// Mock the Redis client module to return our mock Redis
vi.mock('../../src/redis/client', () => ({
  getRedis: () => getMockRedis(),
}));

import {
  checkRateLimit,
  incrementUsage,
  markNotified,
  getUsage,
  RATE_LIMIT_REQUESTS_PER_MINUTE,
  RATE_LIMIT_CHARS_PER_DAY,
} from '../../src/redis/ratelimit';

describe('RateLimit', () => {
  const testChatId = 12345;

  beforeEach(() => {
    resetMockRedis();
    vi.clearAllMocks();
  });

  describe('checkRateLimit()', () => {
    it('allows requests under limits', async () => {
      const result = await checkRateLimit(testChatId, 100);

      expect(result).toEqual({
        allowed: true,
      });
    });

    it('blocks requests at minute limit (10 req/min)', async () => {
      // Simulate 10 requests already made
      for (let i = 0; i < RATE_LIMIT_REQUESTS_PER_MINUTE; i++) {
        await incrementUsage(testChatId, 100);
      }

      const result = await checkRateLimit(testChatId, 100);

      expect(result).toEqual({
        allowed: false,
        reason: 'minute_limit',
      });
    });

    it('allows but notifies at day limit (20k chars/day) - first time', async () => {
      // Set day counter to just under limit
      const redis = getMockRedis();
      const now = Date.now();
      const dateKey = new Date().toISOString().split('T')[0];
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;

      await redis.set(dayRateLimitKey, String(RATE_LIMIT_CHARS_PER_DAY - 500));

      // Request that would exceed limit
      const result = await checkRateLimit(testChatId, 1000);

      expect(result).toEqual({
        allowed: true,
        reason: 'day_limit',
        shouldNotify: true,
      });
    });

    it('allows but does not notify at day limit if already notified', async () => {
      // Set day counter to exceed limit
      const redis = getMockRedis();
      const dateKey = new Date().toISOString().split('T')[0];
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;
      const notifiedKey = `tts:rate:notified:${testChatId}:${dateKey}`;

      await redis.set(dayRateLimitKey, String(RATE_LIMIT_CHARS_PER_DAY - 500));
      await redis.set(notifiedKey, '1');

      // Request that would exceed limit
      const result = await checkRateLimit(testChatId, 1000);

      expect(result).toEqual({
        allowed: true,
        reason: 'day_limit',
        shouldNotify: false,
      });
    });

    it('allows request exactly at day limit without notification', async () => {
      const redis = getMockRedis();
      const dateKey = new Date().toISOString().split('T')[0];
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;

      await redis.set(dayRateLimitKey, String(RATE_LIMIT_CHARS_PER_DAY - 1000));

      // Request that exactly hits limit
      const result = await checkRateLimit(testChatId, 1000);

      expect(result).toEqual({
        allowed: true,
      });
    });
  });

  describe('incrementUsage()', () => {
    it('correctly increments minute counter', async () => {
      await incrementUsage(testChatId, 100);

      const usage = await getUsage(testChatId);
      expect(usage.minuteRequests).toBe(1);
    });

    it('correctly increments day counter by char count', async () => {
      await incrementUsage(testChatId, 500);

      const usage = await getUsage(testChatId);
      expect(usage.dayChars).toBe(500);
    });

    it('increments both counters on each call', async () => {
      await incrementUsage(testChatId, 300);
      await incrementUsage(testChatId, 700);
      await incrementUsage(testChatId, 500);

      const usage = await getUsage(testChatId);
      expect(usage.minuteRequests).toBe(3);
      expect(usage.dayChars).toBe(1500);
    });

    it('sets correct TTL on counters', async () => {
      const redis = getMockRedis();
      await incrementUsage(testChatId, 100);

      const now = Date.now();
      const minuteKey = Math.floor(now / 60000);
      const dateKey = new Date().toISOString().split('T')[0];
      const minuteRateLimitKey = `tts:rate:min:${testChatId}:${minuteKey}`;
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;

      const minuteTTL = await redis.ttl(minuteRateLimitKey);
      const dayTTL = await redis.ttl(dayRateLimitKey);

      // TTL should be set and positive
      expect(minuteTTL).toBeGreaterThan(0);
      expect(minuteTTL).toBeLessThanOrEqual(120); // 2 minutes

      expect(dayTTL).toBeGreaterThan(0);
      expect(dayTTL).toBeLessThanOrEqual(48 * 60 * 60); // 48 hours
    });
  });

  describe('markNotified()', () => {
    it('sets notification flag with correct TTL', async () => {
      const redis = getMockRedis();
      await markNotified(testChatId);

      const dateKey = new Date().toISOString().split('T')[0];
      const notifiedKey = `tts:rate:notified:${testChatId}:${dateKey}`;

      const value = await redis.get(notifiedKey);
      const ttl = await redis.ttl(notifiedKey);

      expect(value).toBe('1');
      expect(ttl).toBeGreaterThan(0);
      expect(ttl).toBeLessThanOrEqual(48 * 60 * 60); // 48 hours
    });

    it('prevents duplicate notifications after being marked', async () => {
      const redis = getMockRedis();
      const dateKey = new Date().toISOString().split('T')[0];
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;

      // Set up scenario where day limit would be exceeded
      await redis.set(dayRateLimitKey, String(RATE_LIMIT_CHARS_PER_DAY));

      // First check should notify
      const result1 = await checkRateLimit(testChatId, 100);
      expect(result1.shouldNotify).toBe(true);

      // Mark as notified
      await markNotified(testChatId);

      // Second check should not notify
      const result2 = await checkRateLimit(testChatId, 100);
      expect(result2.shouldNotify).toBe(false);
    });
  });

  describe('getUsage()', () => {
    it('returns zero usage when no requests have been made', async () => {
      const usage = await getUsage(testChatId);

      expect(usage).toEqual({
        minuteRequests: 0,
        dayChars: 0,
      });
    });

    it('returns correct current usage stats after increments', async () => {
      await incrementUsage(testChatId, 500);
      await incrementUsage(testChatId, 300);

      const usage = await getUsage(testChatId);

      expect(usage.minuteRequests).toBe(2);
      expect(usage.dayChars).toBe(800);
    });

    it('isolates usage between different chat IDs', async () => {
      const chatId1 = 111;
      const chatId2 = 222;

      await incrementUsage(chatId1, 500);
      await incrementUsage(chatId2, 300);

      const usage1 = await getUsage(chatId1);
      const usage2 = await getUsage(chatId2);

      expect(usage1.dayChars).toBe(500);
      expect(usage2.dayChars).toBe(300);
    });
  });

  describe('Integration scenarios', () => {
    it('full workflow: increment, check, notify, check again', async () => {
      // Start with 9 requests already made
      for (let i = 0; i < 9; i++) {
        await incrementUsage(testChatId, 1000);
      }

      // 10th request should still be allowed
      let result = await checkRateLimit(testChatId, 1000);
      expect(result.allowed).toBe(true);
      await incrementUsage(testChatId, 1000);

      // 11th request should be blocked due to minute limit
      result = await checkRateLimit(testChatId, 1000);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('minute_limit');
    });

    it('day limit notification workflow', async () => {
      // Make requests totaling 19,000 chars
      await incrementUsage(testChatId, 19000);

      // Should be allowed, no notification
      let result = await checkRateLimit(testChatId, 500);
      expect(result.allowed).toBe(true);
      expect(result.shouldNotify).toBeUndefined();

      // Request that would exceed 20k should allow but notify
      result = await checkRateLimit(testChatId, 2000);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('day_limit');
      expect(result.shouldNotify).toBe(true);

      // Mark as notified
      await markNotified(testChatId);

      // Increment usage to actually be over limit
      await incrementUsage(testChatId, 2000);

      // Next check for request that still exceeds should allow but not notify again
      result = await checkRateLimit(testChatId, 1000);
      expect(result.allowed).toBe(true);
      expect(result.reason).toBe('day_limit');
      expect(result.shouldNotify).toBe(false);
    });

    it('minute limit takes precedence over day limit', async () => {
      const redis = getMockRedis();
      const dateKey = new Date().toISOString().split('T')[0];
      const dayRateLimitKey = `tts:rate:day:${testChatId}:${dateKey}`;

      // Set day counter to exceed limit
      await redis.set(dayRateLimitKey, String(RATE_LIMIT_CHARS_PER_DAY));

      // Make 10 requests to hit minute limit
      for (let i = 0; i < RATE_LIMIT_REQUESTS_PER_MINUTE; i++) {
        await incrementUsage(testChatId, 100);
      }

      // Should be blocked for minute limit, not day limit
      const result = await checkRateLimit(testChatId, 100);
      expect(result.allowed).toBe(false);
      expect(result.reason).toBe('minute_limit');
    });
  });
});
