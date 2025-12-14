# User Management and Invite System

## Overview

This document describes the user management and invite code system for the TTS bot. The system uses Redis for storage and implements role-based access control with invite codes.

## Architecture

### Files Created

- **`src/redis/client.ts`**: Redis client singleton
- **`src/redis/users.ts`**: User management functions
- **`src/redis/invites.ts`**: Invite code management
- **`src/redis/index.ts`**: Module exports

### Redis Keys

**User records:**
```
Key: tts:user:{chatId}
Type: Hash
Fields:
  - role: "admin" | "user"
  - invitedBy: chatId of inviter (or empty for bootstrap admins)
  - createdAt: timestamp
```

**Invite records:**
```
Key: tts:invite:{code}
Type: Hash
Fields:
  - code: 8-character hex string
  - role: "admin" | "user"
  - createdBy: chatId
  - usesLeft: number
  - createdAt: timestamp
```

**Invite index (for listing):**
```
Key: tts:invites:by:{createdBy}
Type: Set
Members: invite codes created by this user
```

## API Reference

### User Management (`src/redis/users.ts`)

#### `getUser(chatId: number): Promise<UserRecord | null>`
Retrieves user record from Redis.

#### `createUser(chatId: number, role: 'admin' | 'user', invitedBy: number | null): Promise<void>`
Creates a new user record. `invitedBy` should be null for bootstrap admins.

#### `isAuthorized(chatId: number): Promise<boolean>`
Returns true if:
- User's chatId is in ADMIN_CHAT_IDS env var, OR
- User exists in Redis

#### `isAdmin(chatId: number): Promise<boolean>`
Returns true if:
- User's chatId is in ADMIN_CHAT_IDS env var, OR
- User's role is 'admin' in Redis

### Invite Management (`src/redis/invites.ts`)

#### `createInvite(createdBy: number, role: 'admin' | 'user', uses?: number): Promise<string>`
Creates an invite code with specified number of uses (defaults to 1).
Returns the generated 8-character hex code.

#### `getInvite(code: string): Promise<InviteRecord | null>`
Retrieves invite details.

#### `redeemInvite(code: string, chatId: number): Promise<boolean>`
Redeems an invite code:
- Creates user with invite's role
- Decrements usesLeft
- Deletes invite if usesLeft reaches 0
- Returns false if invite doesn't exist or has no uses left

#### `listInvites(createdBy: number): Promise<InviteRecord[]>`
Lists all active invites created by the specified user.

#### `revokeInvite(code: string, requestedBy: number): Promise<boolean>`
Revokes an invite code. Only the creator can revoke their own invites.

## Configuration

Add to `.env`:
```bash
ADMIN_CHAT_IDS=123456789,987654321
```

This comma-separated list defines bootstrap admins who:
- Are always authorized
- Are always considered admins
- Can create invites
- Don't need to be in Redis

## Usage Example

```typescript
import { 
    isAuthorized, 
    isAdmin, 
    createInvite, 
    redeemInvite 
} from './src/redis';

// Check if user can access the bot
if (!await isAuthorized(chatId)) {
    await bot.sendMessage(chatId, 'You need an invite code. Use /redeem <code>');
    return;
}

// Admin-only: create invite
if (await isAdmin(chatId)) {
    const code = await createInvite(chatId, 'user', 5); // 5 uses
    await bot.sendMessage(chatId, `Invite code: ${code}`);
}

// Redeem invite
const success = await redeemInvite(code, chatId);
if (success) {
    await bot.sendMessage(chatId, 'Welcome! You now have access.');
}
```

## Testing

Run the test script:
```bash
# Make sure Redis is running
docker run -d -p 6379:6379 redis

# Run test
bun test-redis.ts
```

## Implementation Notes

1. **Bootstrap Admins**: Users listed in ADMIN_CHAT_IDS are always authorized and always admins, even if they don't have a Redis record. This prevents lockout scenarios.

2. **Invite Codes**: Generated using `crypto.randomBytes(4).toString('hex')` for 8-character hex strings (e.g., "a3f2c9d1").

3. **Invite Index**: Uses Redis sets to efficiently list invites by creator. This is maintained alongside the invite hashes.

4. **Atomic Operations**: The `redeemInvite` function is not atomic. For production use, consider using Redis transactions (MULTI/EXEC) or Lua scripts to prevent race conditions.

5. **Cleanup**: Invites are automatically deleted when usesLeft reaches 0. The index is also cleaned up at the same time.

## Future Enhancements

- Add invite expiration timestamps
- Add user statistics (total users invited, etc.)
- Add audit log for invite redemptions
- Add ability to list all users (for admins)
- Add ability to revoke user access
- Add rate limiting on invite creation
