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

const DEFAULT_PREFS: UserPrefs = {
    voice: 'alloy',
    speed: 1.0,
};

// Simple in-memory storage - could be Redis later
const userPrefs = new Map<number, UserPrefs>();

export function getPrefs(chatId: number): UserPrefs {
    return userPrefs.get(chatId) || { ...DEFAULT_PREFS };
}

export function setVoice(chatId: number, voice: Voice): void {
    const prefs = getPrefs(chatId);
    prefs.voice = voice;
    userPrefs.set(chatId, prefs);
}

export function setSpeed(chatId: number, speed: number): void {
    const clamped = Math.max(0.25, Math.min(4.0, speed));
    const prefs = getPrefs(chatId);
    prefs.speed = clamped;
    userPrefs.set(chatId, prefs);
}

export function setInstructions(chatId: number, instructions: string | undefined): void {
    const prefs = getPrefs(chatId);
    prefs.instructions = instructions;
    userPrefs.set(chatId, prefs);
}

export function isValidVoice(voice: string): voice is Voice {
    return AVAILABLE_VOICES.includes(voice as Voice);
}
