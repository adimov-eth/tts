import TelegramBot from 'node-telegram-bot-api';
import { TTSQueueManager } from './ttsQueue';

export class TTSBot {
    private bot: TelegramBot;
    private queueManager: TTSQueueManager;

    constructor(
        telegramToken: string,
        elevenLabsApiKey: string,
        openAIApiKey: string,
        redisConfig = { host: 'localhost', port: 6379 }
    ) {
        this.bot = new TelegramBot(telegramToken, { polling: true });
        this.queueManager = new TTSQueueManager(
            // elevenLabsApiKey,
            openAIApiKey,
            this.bot,
            redisConfig
        );

        this.setupCommandHandlers();
    }

    private setupCommandHandlers(): void {
        // Start command
        this.bot.onText(/\/start/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId, 
                '👋 Welcome to the TTS Bot!\n\n' +
                'Send me any text and I\'ll convert it to speech.\n\n' +
                'Commands:\n' +
                '/tts <text> - Convert text to speech\n' +
                '/ttsai <text> - Convert text to speech with AI enhancement\n' +
                '/help - Show this help message'
            );
        });

        // Help command
        this.bot.onText(/\/help/, (msg) => {
            const chatId = msg.chat.id;
            this.bot.sendMessage(chatId,
                '🤖 TTS Bot Help\n\n' +
                'Commands:\n' +
                '/tts <text> - Convert text to speech\n' +
                '/ttsai <text> - Convert text to speech with AI enhancement\n' +
                '/help - Show this help message\n\n' +
                'Or simply send any text message to convert it to speech!'
            );
        });

        // TTS command
        this.bot.onText(/\/tts (.+)/, (msg, match) => {
            if (!match) return;
            const chatId = msg.chat.id;
            const text = match[1];
            this.queueManager.addToQueue(chatId, text, false);
        });

        // TTS with AI enhancement command
        this.bot.onText(/\/ttsai (.+)/, (msg, match) => {
            if (!match) return;
            const chatId = msg.chat.id;
            const text = match[1];
            this.queueManager.addToQueue(chatId, text, true);
        });

        // Handle regular messages
        this.bot.on('message', (msg) => {
            if (msg.text && !msg.text.startsWith('/')) {
                const chatId = msg.chat.id;
                this.queueManager.addToQueue(chatId, msg.text, false);
            }
        });
    }

    async shutdown(): Promise<void> {
        this.bot.stopPolling();
        await this.queueManager.shutdown();
    }
} 