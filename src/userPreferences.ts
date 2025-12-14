import * as redisPrefs from './redis/preferences';

export const AVAILABLE_VOICES = [
    'alloy', 'ash', 'ballad', 'coral', 'echo',
    'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'
] as const;

export type Voice = typeof AVAILABLE_VOICES[number];

export interface UserPrefs {
    voice: Voice;
    speed: number;
    instructions?: string;
}

export async function getPrefs(chatId: number): Promise<UserPrefs> {
    return redisPrefs.getPrefs(chatId) as Promise<UserPrefs>;
}

export async function setVoice(chatId: number, voice: Voice): Promise<void> {
    await redisPrefs.setVoice(chatId, voice);
}

export async function setSpeed(chatId: number, speed: number): Promise<void> {
    const clamped = Math.max(0.25, Math.min(4.0, speed));
    await redisPrefs.setSpeed(chatId, clamped);
}

export async function setInstructions(chatId: number, instructions: string | undefined): Promise<void> {
    await redisPrefs.setInstructions(chatId, instructions);
}

export function isValidVoice(voice: string): voice is Voice {
    return AVAILABLE_VOICES.includes(voice as Voice);
}
