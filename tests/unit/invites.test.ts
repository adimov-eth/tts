import { describe, it, expect, beforeEach, vi } from 'vitest';
import RedisMock from 'ioredis-mock';

// Mock the Redis client
vi.mock('../../src/redis/client', () => {
  const mockRedis = new RedisMock();
  return {
    getRedis: () => mockRedis,
  };
});

// Mock the createUser function from users.ts
vi.mock('../../src/redis/users', () => ({
  createUser: vi.fn(),
}));

import {
  createInvite,
  getInvite,
  redeemInvite,
  listInvites,
  revokeInvite,
} from '../../src/redis/invites';
import { createUser } from '../../src/redis/users';
import { getRedis } from '../../src/redis/client';

describe('Invites', () => {
  const mockRedis = getRedis();

  beforeEach(async () => {
    // Clear all Redis data before each test
    await mockRedis.flushall();
    // Clear all mocks
    vi.clearAllMocks();
  });

  describe('createInvite()', () => {
    it('generates a valid 8-char hex code', async () => {
      const code = await createInvite(12345, 'user', 1);

      expect(code).toBeDefined();
      expect(code).toHaveLength(8);
      expect(code).toMatch(/^[0-9a-f]{8}$/);
    });

    it('stores invite with correct metadata (role, createdBy, usesLeft, createdAt)', async () => {
      const createdBy = 12345;
      const role = 'admin';
      const uses = 5;
      const beforeTimestamp = Date.now();

      const code = await createInvite(createdBy, role, uses);
      const invite = await getInvite(code);

      expect(invite).toBeDefined();
      expect(invite?.code).toBe(code);
      expect(invite?.role).toBe(role);
      expect(invite?.createdBy).toBe(createdBy);
      expect(invite?.usesLeft).toBe(uses);
      expect(invite?.createdAt).toBeGreaterThanOrEqual(beforeTimestamp);
      expect(invite?.createdAt).toBeLessThanOrEqual(Date.now());
    });
  });

  describe('getInvite()', () => {
    it('returns null for non-existent codes', async () => {
      const invite = await getInvite('nonexistent');
      expect(invite).toBeNull();
    });

    it('returns correct invite data for existing codes', async () => {
      const createdBy = 67890;
      const role = 'user';
      const uses = 3;

      const code = await createInvite(createdBy, role, uses);
      const invite = await getInvite(code);

      expect(invite).toBeDefined();
      expect(invite?.code).toBe(code);
      expect(invite?.role).toBe(role);
      expect(invite?.createdBy).toBe(createdBy);
      expect(invite?.usesLeft).toBe(uses);
    });
  });

  describe('redeemInvite()', () => {
    it('returns false for non-existent invites', async () => {
      const result = await redeemInvite('badcode', 99999);
      expect(result).toBe(false);
      expect(createUser).not.toHaveBeenCalled();
    });

    it('returns false for exhausted invites (usesLeft = 0)', async () => {
      const createdBy = 11111;
      const chatId = 22222;

      // Create invite with 0 uses
      const code = await createInvite(createdBy, 'user', 0);

      const result = await redeemInvite(code, chatId);
      expect(result).toBe(false);
      expect(createUser).not.toHaveBeenCalled();
    });

    it('creates user and decrements usesLeft', async () => {
      const createdBy = 11111;
      const chatId = 22222;
      const role = 'admin';
      const uses = 3;

      const code = await createInvite(createdBy, role, uses);
      const result = await redeemInvite(code, chatId);

      expect(result).toBe(true);
      expect(createUser).toHaveBeenCalledWith(chatId, role, createdBy);

      // Check that usesLeft was decremented
      const invite = await getInvite(code);
      expect(invite?.usesLeft).toBe(uses - 1);
    });

    it('deletes invite when last use is consumed', async () => {
      const createdBy = 11111;
      const chatId = 22222;
      const role = 'user';

      // Create invite with only 1 use
      const code = await createInvite(createdBy, role, 1);
      const result = await redeemInvite(code, chatId);

      expect(result).toBe(true);
      expect(createUser).toHaveBeenCalledWith(chatId, role, createdBy);

      // Invite should be deleted
      const invite = await getInvite(code);
      expect(invite).toBeNull();

      // Code should be removed from the index
      const invites = await listInvites(createdBy);
      expect(invites).toHaveLength(0);
    });
  });

  describe('listInvites()', () => {
    it('returns all invites created by a user', async () => {
      const createdBy = 33333;
      const otherUser = 44444;

      // Create multiple invites for the user
      const code1 = await createInvite(createdBy, 'user', 1);
      const code2 = await createInvite(createdBy, 'admin', 5);
      const code3 = await createInvite(createdBy, 'user', 2);

      // Create invite for different user (should not be included)
      await createInvite(otherUser, 'user', 1);

      const invites = await listInvites(createdBy);

      expect(invites).toHaveLength(3);

      const codes = invites.map(inv => inv.code);
      expect(codes).toContain(code1);
      expect(codes).toContain(code2);
      expect(codes).toContain(code3);

      // Verify all invites belong to the creator
      invites.forEach(inv => {
        expect(inv.createdBy).toBe(createdBy);
      });
    });
  });

  describe('revokeInvite()', () => {
    it('returns false for non-existent invites', async () => {
      const result = await revokeInvite('nonexistent', 12345);
      expect(result).toBe(false);
    });

    it('returns false when requestedBy != createdBy', async () => {
      const createdBy = 55555;
      const otherUser = 66666;

      const code = await createInvite(createdBy, 'user', 1);

      // Try to revoke with different user
      const result = await revokeInvite(code, otherUser);
      expect(result).toBe(false);

      // Invite should still exist
      const invite = await getInvite(code);
      expect(invite).toBeDefined();
    });

    it('successfully deletes invite when authorized', async () => {
      const createdBy = 77777;

      const code = await createInvite(createdBy, 'user', 5);

      // Revoke with correct user
      const result = await revokeInvite(code, createdBy);
      expect(result).toBe(true);

      // Invite should be deleted
      const invite = await getInvite(code);
      expect(invite).toBeNull();

      // Code should be removed from the index
      const invites = await listInvites(createdBy);
      expect(invites).toHaveLength(0);
    });
  });
});
