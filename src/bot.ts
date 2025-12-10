import TelegramBot from 'node-telegram-bot-api';
import { TTSCore } from './core';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export class TTSBot {
    private bot: TelegramBot;
    private core: TTSCore;

    constructor(telegramToken: string, openAIApiKey: string) {
        this.bot = new TelegramBot(telegramToken, { polling: true });
        this.core = new TTSCore(openAIApiKey);
        this.setupHandlers();
    }

    private setupHandlers(): void {
        this.bot.onText(/\/start/, (msg) => {
            const result = this.core.handleStart(msg.chat.id);
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/help/, (msg) => {
            const result = this.core.handleHelp();
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/voices/, (msg) => {
            const result = this.core.handleVoices(msg.chat.id);
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        // Word boundary prevents matching /voices
        this.bot.onText(/\/voice\b(?:\s+(.+))?/, (msg, match) => {
            const result = this.core.handleVoice(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/speed(?:\s+(.+))?/, (msg, match) => {
            const result = this.core.handleSpeed(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/tone(?:\s+(.+))?/, (msg, match) => {
            const result = this.core.handleTone(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/settings/, (msg) => {
            const result = this.core.handleSettings(msg.chat.id);
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/tts(?:\s+(.+))?$/, (msg, match) => {
            const text = match?.[1]?.trim();
            if (!text) {
                this.bot.sendMessage(msg.chat.id, 'Usage: /tts <text>');
                return;
            }
            this.processAndSend(msg.chat.id, text, false);
        });

        this.bot.onText(/\/ttsai(?:\s+(.+))?$/, (msg, match) => {
            const text = match?.[1]?.trim();
            if (!text) {
                this.bot.sendMessage(msg.chat.id, 'Usage: /ttsai <text>');
                return;
            }
            this.processAndSend(msg.chat.id, text, true);
        });

        // Regular text messages (not commands)
        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                this.processAndSend(msg.chat.id, msg.text, false);
            }
        });
    }

    private async processAndSend(chatId: number, text: string, useAI: boolean): Promise<void> {
        try {
            await this.bot.sendMessage(chatId, 'Processing...');

            const { audio } = await this.core.generateSpeech(chatId, text, useAI);

            const tempFile = path.join(os.tmpdir(), `voice-${Date.now()}.mp3`);
            await fs.writeFile(tempFile, new Uint8Array(audio));

            try {
                await this.bot.sendVoice(chatId, tempFile);
            } finally {
                await fs.unlink(tempFile).catch(() => {});
            }
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await this.bot.sendMessage(chatId, `Error: ${msg}`);
        }
    }

    async shutdown(): Promise<void> {
        this.bot.stopPolling();
    }
}
