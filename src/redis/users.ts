import { getRedis } from './client';

export interface UserRecord {
    role: 'admin' | 'user';
    invitedBy: number | null;
    createdAt: number;
}

function getUserKey(chatId: number): string {
    return `tts:user:${chatId}`;
}

function getBootstrapAdmins(): number[] {
    const adminIds = process.env.ADMIN_CHAT_IDS || '';
    if (!adminIds.trim()) return [];
    
    return adminIds
        .split(',')
        .map(id => parseInt(id.trim()))
        .filter(id => !isNaN(id));
}

export async function getUser(chatId: number): Promise<UserRecord | null> {
    const redis = getRedis();
    const key = getUserKey(chatId);
    const data = await redis.hgetall(key);
    
    if (!data || !data.role) return null;
    
    return {
        role: data.role as 'admin' | 'user',
        invitedBy: data.invitedBy ? parseInt(data.invitedBy) : null,
        createdAt: parseInt(data.createdAt),
    };
}

export async function createUser(
    chatId: number,
    role: 'admin' | 'user',
    invitedBy: number | null
): Promise<void> {
    const redis = getRedis();
    const key = getUserKey(chatId);
    
    await redis.hset(key, {
        role,
        invitedBy: invitedBy?.toString() || '',
        createdAt: Date.now().toString(),
    });
}

export async function isAuthorized(chatId: number): Promise<boolean> {
    // Check if user is a bootstrap admin
    const bootstrapAdmins = getBootstrapAdmins();
    if (bootstrapAdmins.includes(chatId)) {
        return true;
    }
    
    // Check if user exists in Redis
    const user = await getUser(chatId);
    return user !== null;
}

export async function isAdmin(chatId: number): Promise<boolean> {
    // Check if user is a bootstrap admin
    const bootstrapAdmins = getBootstrapAdmins();
    if (bootstrapAdmins.includes(chatId)) {
        return true;
    }
    
    // Check if user has admin role in Redis
    const user = await getUser(chatId);
    return user?.role === 'admin';
}
