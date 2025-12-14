import { randomBytes } from 'crypto';
import { getRedis } from './client';
import { createUser } from './users';

export interface InviteRecord {
    code: string;
    role: 'admin' | 'user';
    createdBy: number;
    usesLeft: number;
    createdAt: number;
}

function getInviteKey(code: string): string {
    return `tts:invite:${code}`;
}

function getInviteIndexKey(createdBy: number): string {
    return `tts:invites:by:${createdBy}`;
}

function generateCode(): string {
    return randomBytes(4).toString('hex');
}

export async function createInvite(
    createdBy: number,
    role: 'admin' | 'user',
    uses: number = 1
): Promise<string> {
    const redis = getRedis();
    const code = generateCode();
    const key = getInviteKey(code);
    const indexKey = getInviteIndexKey(createdBy);
    
    await redis.hset(key, {
        code,
        role,
        createdBy: createdBy.toString(),
        usesLeft: uses.toString(),
        createdAt: Date.now().toString(),
    });
    
    // Add to index for listing
    await redis.sadd(indexKey, code);
    
    return code;
}

export async function getInvite(code: string): Promise<InviteRecord | null> {
    const redis = getRedis();
    const key = getInviteKey(code);
    const data = await redis.hgetall(key);
    
    if (!data || !data.code) return null;
    
    return {
        code: data.code,
        role: data.role as 'admin' | 'user',
        createdBy: parseInt(data.createdBy),
        usesLeft: parseInt(data.usesLeft),
        createdAt: parseInt(data.createdAt),
    };
}

export async function redeemInvite(code: string, chatId: number): Promise<boolean> {
    const redis = getRedis();
    const invite = await getInvite(code);
    
    if (!invite || invite.usesLeft <= 0) {
        return false;
    }
    
    // Create the user with the invite's role
    await createUser(chatId, invite.role, invite.createdBy);
    
    // Decrement uses
    const newUsesLeft = invite.usesLeft - 1;
    const key = getInviteKey(code);
    
    if (newUsesLeft === 0) {
        // Delete invite and remove from index
        const indexKey = getInviteIndexKey(invite.createdBy);
        await redis.del(key);
        await redis.srem(indexKey, code);
    } else {
        // Update uses left
        await redis.hset(key, 'usesLeft', newUsesLeft.toString());
    }
    
    return true;
}

export async function listInvites(createdBy: number): Promise<InviteRecord[]> {
    const redis = getRedis();
    const indexKey = getInviteIndexKey(createdBy);
    const codes = await redis.smembers(indexKey);
    
    const invites: InviteRecord[] = [];
    
    for (const code of codes) {
        const invite = await getInvite(code);
        if (invite) {
            invites.push(invite);
        }
    }
    
    return invites;
}

export async function revokeInvite(code: string, requestedBy: number): Promise<boolean> {
    const invite = await getInvite(code);
    
    if (!invite) {
        return false;
    }
    
    // Only the creator can revoke
    if (invite.createdBy !== requestedBy) {
        return false;
    }
    
    const redis = getRedis();
    const key = getInviteKey(code);
    const indexKey = getInviteIndexKey(invite.createdBy);
    
    await redis.del(key);
    await redis.srem(indexKey, code);
    
    return true;
}
