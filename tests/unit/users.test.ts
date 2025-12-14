import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import RedisMock from 'ioredis-mock';

// Mock the Redis client before importing the module under test
vi.mock('../../src/redis/client', () => {
  const mockRedis = new RedisMock();
  return {
    getRedis: () => mockRedis,
    closeRedis: async () => {},
  };
});

// Import after mocking
import { getUser, createUser, isAuthorized, isAdmin } from '../../src/redis/users';
import { getRedis } from '../../src/redis/client';

describe('Users', () => {
  let redis: RedisMock;
  const originalAdminChatIds = process.env.ADMIN_CHAT_IDS;

  beforeEach(async () => {
    redis = getRedis() as unknown as RedisMock;
    // Clear all data before each test
    await redis.flushall();
    // Reset environment variable to undefined state
    delete process.env.ADMIN_CHAT_IDS;
  });

  afterEach(() => {
    // Restore original environment state
    if (originalAdminChatIds !== undefined) {
      process.env.ADMIN_CHAT_IDS = originalAdminChatIds;
    } else {
      delete process.env.ADMIN_CHAT_IDS;
    }
  });

  describe('getUser()', () => {
    it('returns null for non-existent users', async () => {
      const result = await getUser(12345);
      expect(result).toBeNull();
    });

    it('returns correct user data for existing users', async () => {
      const chatId = 12345;
      const now = Date.now();

      await redis.hset(`tts:user:${chatId}`, {
        role: 'admin',
        invitedBy: '67890',
        createdAt: now.toString(),
      });

      const result = await getUser(chatId);

      expect(result).toEqual({
        role: 'admin',
        invitedBy: 67890,
        createdAt: now,
      });
    });

    it('handles user with null invitedBy', async () => {
      const chatId = 99999;
      const now = Date.now();

      await redis.hset(`tts:user:${chatId}`, {
        role: 'user',
        invitedBy: '',
        createdAt: now.toString(),
      });

      const result = await getUser(chatId);

      expect(result).toEqual({
        role: 'user',
        invitedBy: null,
        createdAt: now,
      });
    });
  });

  describe('createUser()', () => {
    it('creates a user with correct role and metadata', async () => {
      const chatId = 12345;
      const invitedBy = 67890;

      await createUser(chatId, 'user', invitedBy);

      const data = await redis.hgetall(`tts:user:${chatId}`);

      expect(data.role).toBe('user');
      expect(data.invitedBy).toBe('67890');
      expect(parseInt(data.createdAt)).toBeGreaterThan(0);
      expect(parseInt(data.createdAt)).toBeLessThanOrEqual(Date.now());
    });

    it('creates an admin user', async () => {
      const chatId = 11111;

      await createUser(chatId, 'admin', null);

      const data = await redis.hgetall(`tts:user:${chatId}`);

      expect(data.role).toBe('admin');
      expect(data.invitedBy).toBe('');
      expect(parseInt(data.createdAt)).toBeGreaterThan(0);
    });
  });

  describe('isAuthorized()', () => {
    it('returns true for bootstrap admins from ADMIN_CHAT_IDS env', async () => {
      process.env.ADMIN_CHAT_IDS = '12345, 67890, 99999';

      expect(await isAuthorized(12345)).toBe(true);
      expect(await isAuthorized(67890)).toBe(true);
      expect(await isAuthorized(99999)).toBe(true);
    });

    it('returns true for existing users in Redis', async () => {
      const chatId = 12345;
      await createUser(chatId, 'user', null);

      expect(await isAuthorized(chatId)).toBe(true);
    });

    it('returns false for non-existent users (when not in ADMIN_CHAT_IDS)', async () => {
      process.env.ADMIN_CHAT_IDS = '11111';

      expect(await isAuthorized(12345)).toBe(false);
    });

    it('handles empty ADMIN_CHAT_IDS', async () => {
      process.env.ADMIN_CHAT_IDS = '';

      expect(await isAuthorized(12345)).toBe(false);
    });

    it('handles whitespace in ADMIN_CHAT_IDS', async () => {
      process.env.ADMIN_CHAT_IDS = '  12345  ,  67890  ';

      expect(await isAuthorized(12345)).toBe(true);
      expect(await isAuthorized(67890)).toBe(true);
    });

    it('filters out invalid IDs in ADMIN_CHAT_IDS', async () => {
      process.env.ADMIN_CHAT_IDS = '12345, invalid, 67890, , abc';

      expect(await isAuthorized(12345)).toBe(true);
      expect(await isAuthorized(67890)).toBe(true);
    });
  });

  describe('isAdmin()', () => {
    it('returns true for bootstrap admins from ADMIN_CHAT_IDS env', async () => {
      process.env.ADMIN_CHAT_IDS = '12345, 67890';

      expect(await isAdmin(12345)).toBe(true);
      expect(await isAdmin(67890)).toBe(true);
    });

    it('returns true for users with admin role', async () => {
      const chatId = 12345;
      await createUser(chatId, 'admin', null);

      expect(await isAdmin(chatId)).toBe(true);
    });

    it('returns false for users with user role', async () => {
      const chatId = 12345;
      await createUser(chatId, 'user', null);

      expect(await isAdmin(chatId)).toBe(false);
    });

    it('returns false for non-existent users', async () => {
      process.env.ADMIN_CHAT_IDS = '11111';

      expect(await isAdmin(12345)).toBe(false);
    });

    it('prioritizes ADMIN_CHAT_IDS over Redis role', async () => {
      const chatId = 12345;
      // Create user with 'user' role
      await createUser(chatId, 'user', null);

      // Should still be admin because of ADMIN_CHAT_IDS
      process.env.ADMIN_CHAT_IDS = '12345';
      expect(await isAdmin(chatId)).toBe(true);
    });
  });
});
