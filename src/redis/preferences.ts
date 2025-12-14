import { getRedis } from './client';

export interface UserPrefs {
    voice: string;
    speed: number;
    instructions?: string;
}

const DEFAULT_PREFS: UserPrefs = {
    voice: 'alloy',
    speed: 1.0,
};

function prefKey(chatId: number): string {
    return `tts:prefs:${chatId}`;
}

export async function getPrefs(chatId: number): Promise<UserPrefs> {
    const redis = getRedis();
    const key = prefKey(chatId);

    const data = await redis.hgetall(key);

    if (!data || Object.keys(data).length === 0) {
        return { ...DEFAULT_PREFS };
    }

    return {
        voice: data.voice || DEFAULT_PREFS.voice,
        speed: data.speed ? parseFloat(data.speed) : DEFAULT_PREFS.speed,
        instructions: data.instructions || undefined,
    };
}

export async function setVoice(chatId: number, voice: string): Promise<void> {
    const redis = getRedis();
    const key = prefKey(chatId);
    await redis.hset(key, 'voice', voice);
}

export async function setSpeed(chatId: number, speed: number): Promise<void> {
    const redis = getRedis();
    const key = prefKey(chatId);
    await redis.hset(key, 'speed', speed.toString());
}

export async function setInstructions(chatId: number, instructions: string | undefined): Promise<void> {
    const redis = getRedis();
    const key = prefKey(chatId);

    if (instructions === undefined) {
        await redis.hdel(key, 'instructions');
    } else {
        await redis.hset(key, 'instructions', instructions);
    }
}
