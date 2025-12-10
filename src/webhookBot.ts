import express from 'express';
import { Bot, Context, webhookCallback, InputFile } from 'grammy';
import { TTSCore } from './core';
import http from 'http';

export class WebhookBot {
    private bot: Bot;
    private core: TTSCore;
    private port: number;
    private webhookUrl: string;
    private server!: http.Server;

    constructor(token: string, openAIApiKey: string, port: number, domain: string, path: string) {
        this.bot = new Bot(token);
        this.core = new TTSCore(openAIApiKey);
        this.port = port;
        this.webhookUrl = `https://${domain}${path}`;

        this.init().catch(err => {
            console.error('Failed to initialize bot:', err);
            process.exit(1);
        });
    }

    private async init() {
        await this.bot.init();
        console.log('Bot initialized');
        this.setupHandlers();
        this.setupServer();
    }

    private setupHandlers() {
        // Commands
        this.bot.command('start', (ctx) => {
            const result = this.core.handleStart(ctx.chat.id);
            return ctx.reply(result.message);
        });

        this.bot.command('help', (ctx) => {
            const result = this.core.handleHelp();
            return ctx.reply(result.message);
        });

        this.bot.command('voices', (ctx) => {
            const result = this.core.handleVoices(ctx.chat.id);
            return ctx.reply(result.message);
        });

        this.bot.command('voice', (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = this.core.handleVoice(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('speed', (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = this.core.handleSpeed(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('tone', (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = this.core.handleTone(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('settings', (ctx) => {
            const result = this.core.handleSettings(ctx.chat.id);
            return ctx.reply(result.message);
        });

        this.bot.command('tts', (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /tts <text>');
            return this.processAndSend(ctx, text, false);
        });

        this.bot.command('ttsai', (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /ttsai <text>');
            return this.processAndSend(ctx, text, true);
        });

        // Text messages (not commands)
        this.bot.on('message:text', (ctx) => {
            const text = ctx.message.text;
            if (text.startsWith('/')) return; // Skip unhandled commands
            return this.processAndSend(ctx, text, false);
        });

        // Voice messages
        this.bot.on('message:voice', async (ctx) => {
            try {
                await ctx.reply('Transcribing...');
                const file = await ctx.getFile();
                const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;

                const transcribed = await this.core.transcribeAudio(fileUrl);
                await ctx.reply(`Transcription: ${transcribed}`);

                return this.processAndSend(ctx, transcribed, true);
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                return ctx.reply(`Error: ${msg}`);
            }
        });

        this.bot.catch((err) => console.error('Bot error:', err));
    }

    private async processAndSend(ctx: Context, text: string, useAI: boolean) {
        try {
            await ctx.reply('Processing...');
            const { audio } = await this.core.generateSpeech(ctx.chat!.id, text, useAI);
            return ctx.replyWithVoice(new InputFile(new Uint8Array(audio), 'speech.mp3'));
        } catch (error) {
            const msg = error instanceof Error ? error.message : 'Unknown error';
            return ctx.reply(`Error: ${msg}`);
        }
    }

    async setWebhook() {
        await this.bot.api.deleteWebhook();
        await this.bot.api.setWebhook(this.webhookUrl);
        const info = await this.bot.api.getWebhookInfo();
        console.log('Webhook set:', info.url);
        return info.url === this.webhookUrl;
    }

    private setupServer() {
        const app = express();
        app.use(express.json());

        const processedUpdates = new Set<number>();

        app.post('*', async (req, res) => {
            const updateId = req.body.update_id;
            if (processedUpdates.has(updateId)) {
                res.sendStatus(200);
                return;
            }

            try {
                await webhookCallback(this.bot, 'express', { timeoutMilliseconds: 120000 })(req, res);
                processedUpdates.add(updateId);

                // Cleanup old entries
                if (processedUpdates.size > 1000) {
                    const toRemove = Array.from(processedUpdates).slice(0, 500);
                    toRemove.forEach(id => processedUpdates.delete(id));
                }
            } catch (error) {
                console.error('Webhook error:', error);
                res.sendStatus(500);
            }
        });

        this.server = app.listen(this.port, '0.0.0.0', () => {
            console.log(`Listening on port ${this.port}`);
            console.log(`Webhook URL: ${this.webhookUrl}`);
        });
    }
}
