import { OpenAIService, ProgressCallback } from './openaiService';
import {
    getPrefs, setVoice, setSpeed, setInstructions,
    isValidVoice, AVAILABLE_VOICES, UserPrefs, Voice
} from './userPreferences';

export { getPrefs, setVoice, setSpeed, setInstructions, isValidVoice, AVAILABLE_VOICES };
export type { UserPrefs, Voice, ProgressCallback };

export interface TTSResult {
    audio: Buffer;
    prefs: UserPrefs;
}

export interface CommandResult {
    message: string;
}

export class TTSCore {
    private openAI: OpenAIService;

    constructor(openAIApiKey: string) {
        this.openAI = new OpenAIService(openAIApiKey);
    }

    // Generate speech with user's preferences
    // Long text is automatically chunked and concatenated
    async generateSpeech(
        chatId: number,
        text: string,
        useAI: boolean = false,
        onProgress?: ProgressCallback
    ): Promise<TTSResult> {
        const prefs = getPrefs(chatId);

        let processedText = text;
        if (useAI) {
            processedText = await this.openAI.transformText(text);
        }

        const audio = await this.openAI.generateSpeech(
            processedText,
            prefs.voice,
            { speed: prefs.speed, instructions: prefs.instructions },
            onProgress
        );

        return { audio, prefs };
    }

    // Transcribe voice message
    async transcribeAudio(audioUrl: string): Promise<string> {
        return this.openAI.transcribeAudio(audioUrl);
    }

    // Command handlers - return message to send
    handleStart(chatId: number): CommandResult {
        const prefs = getPrefs(chatId);
        return {
            message:
                'Welcome to the TTS Bot!\n\n' +
                'Send me text or documents and I\'ll convert them to speech.\n\n' +
                'Commands:\n' +
                '/tts <text> - Convert text to speech\n' +
                '/ttsai <text> - Convert with AI enhancement\n' +
                '/voices - List available voices\n' +
                '/voice <name> - Set voice\n' +
                '/speed <0.25-4.0> - Set speed\n' +
                '/tone <instruction> - Set tone/accent\n' +
                '/settings - Show current settings\n' +
                '/help - Show this help message\n\n' +
                'Supported files: PDF, DOCX, TXT, MD\n\n' +
                `Current: ${prefs.voice}, speed ${prefs.speed}x`
        };
    }

    handleHelp(): CommandResult {
        return {
            message:
                'TTS Bot Help\n\n' +
                'Commands:\n' +
                '/tts <text> - Convert text to speech\n' +
                '/ttsai <text> - Convert with AI enhancement\n' +
                '/voices - List available voices\n' +
                '/voice <name> - Set voice (e.g. /voice nova)\n' +
                '/speed <0.25-4.0> - Set speed (e.g. /speed 1.5)\n' +
                '/tone <instruction> - Set tone (e.g. /tone Speak cheerfully)\n' +
                '/tone off - Clear tone instruction\n' +
                '/settings - Show current settings\n' +
                '/help - Show this help message\n\n' +
                'Send any text message to convert it to speech.\n' +
                'Send documents (PDF, DOCX, TXT, MD) to convert to audio.\n' +
                'Long texts are automatically chunked and concatenated.'
        };
    }

    handleVoices(chatId: number): CommandResult {
        const prefs = getPrefs(chatId);
        const voiceList = AVAILABLE_VOICES.map(v =>
            v === prefs.voice ? `* ${v} (current)` : `  ${v}`
        ).join('\n');
        return {
            message: 'Available voices:\n\n' + voiceList + '\n\nUse /voice <name> to change'
        };
    }

    handleVoice(chatId: number, voice?: string): CommandResult {
        if (!voice) {
            const prefs = getPrefs(chatId);
            return { message: `Current voice: ${prefs.voice}\nUse /voice <name> to change` };
        }

        const v = voice.toLowerCase();
        if (!isValidVoice(v)) {
            return { message: `Unknown voice: ${voice}\nUse /voices to see available options` };
        }

        setVoice(chatId, v);
        return { message: `Voice set to: ${v}` };
    }

    handleSpeed(chatId: number, speedStr?: string): CommandResult {
        if (!speedStr) {
            const prefs = getPrefs(chatId);
            return { message: `Current speed: ${prefs.speed}x\nUse /speed <0.25-4.0> to change` };
        }

        const speed = parseFloat(speedStr);
        if (isNaN(speed) || speed < 0.25 || speed > 4.0) {
            return { message: 'Speed must be between 0.25 and 4.0' };
        }

        setSpeed(chatId, speed);
        return { message: `Speed set to: ${speed}x` };
    }

    handleTone(chatId: number, instruction?: string): CommandResult {
        if (!instruction) {
            const prefs = getPrefs(chatId);
            const current = prefs.instructions || 'none';
            return {
                message:
                    `Current tone: ${current}\n\n` +
                    'Use /tone <instruction> to set (e.g. /tone Speak cheerfully)\n' +
                    'Use /tone off to clear'
            };
        }

        if (instruction.toLowerCase() === 'off') {
            setInstructions(chatId, undefined);
            return { message: 'Tone instruction cleared' };
        }

        setInstructions(chatId, instruction);
        return { message: `Tone set to: ${instruction}` };
    }

    handleSettings(chatId: number): CommandResult {
        const prefs = getPrefs(chatId);
        return {
            message:
                'Your settings:\n\n' +
                `Voice: ${prefs.voice}\n` +
                `Speed: ${prefs.speed}x\n` +
                `Tone: ${prefs.instructions || 'none'}`
        };
    }
}
