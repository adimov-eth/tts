import express from 'express';
import { Bot, Context, webhookCallback, InputFile } from 'grammy';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import { createQueue, createWorker, JobData } from './queue';
import { Queue, Worker } from 'bullmq';
import http from 'http';

export class WebhookBot {
    private bot: Bot;
    private core: TTSCore;
    private docs: DocumentService;
    private port: number;
    private webhookUrl: string;
    private server!: http.Server;
    private queue!: Queue<JobData>;
    private worker!: Worker<JobData>;

    constructor(token: string, openAIApiKey: string, port: number, domain: string, path: string) {
        this.bot = new Bot(token);
        this.core = new TTSCore(openAIApiKey);
        this.docs = new DocumentService();
        this.port = port;
        this.webhookUrl = `https://${domain}${path}`;

        this.init().catch(err => {
            console.error('Failed to initialize bot:', err);
            process.exit(1);
        });
    }

    private async init() {
        await this.bot.init();
        await this.bot.api.setMyCommands([
            { command: 'start', description: 'Start the bot' },
            { command: 'help', description: 'Show help' },
            { command: 'tts', description: 'Convert text to speech' },
            { command: 'ttsai', description: 'Convert with AI enhancement' },
            { command: 'voices', description: 'List available voices' },
            { command: 'voice', description: 'Set voice' },
            { command: 'speed', description: 'Set speed (0.25-4.0)' },
            { command: 'tone', description: 'Set tone instruction' },
            { command: 'settings', description: 'Show current settings' },
        ]);

        // Initialize queue and worker
        this.queue = createQueue();
        this.worker = createWorker(this.bot, this.core, this.docs);

        console.log('Bot initialized with queue');
        this.setupHandlers();
        this.setupServer();
    }

    private setupHandlers() {
        // Commands that don't need queueing (instant responses)
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

        // TTS commands - queue for async processing
        this.bot.command('tts', async (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /tts <text>');
            return this.queueTTS(ctx, text, false);
        });

        this.bot.command('ttsai', async (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /ttsai <text>');
            return this.queueTTS(ctx, text, true);
        });

        // Text messages (not commands) - queue for processing
        this.bot.on('message:text', async (ctx) => {
            const text = ctx.message.text;
            if (text.startsWith('/')) {
                return ctx.reply('Unknown command. Use /help for available commands.');
            }
            if (!text.trim()) return;
            return this.queueTTS(ctx, text, false);
        });

        // Voice messages - queue for processing
        this.bot.on('message:voice', async (ctx) => {
            return this.queueVoice(ctx);
        });

        // Document uploads - queue for processing
        this.bot.on('message:document', async (ctx) => {
            return this.queueDocument(ctx);
        });

        this.bot.catch((err) => console.error('Bot error:', err));
    }

    private async queueTTS(ctx: Context, text: string, useAI: boolean): Promise<void> {
        if (!ctx.chat) return;

        // Send immediate acknowledgment
        const statusMsg = await ctx.reply('Queued for processing...');

        // Add to queue
        await this.queue.add(`tts-${Date.now()}`, {
            type: useAI ? 'ttsai' : 'tts',
            chatId: ctx.chat.id,
            text,
            statusMsgId: statusMsg.message_id,
        });
    }

    private async queueDocument(ctx: Context): Promise<void> {
        const doc = ctx.message?.document;
        if (!doc || !ctx.chat) return;

        const format = this.docs.detectFormat(doc.file_name || '', doc.mime_type);

        if (!format) {
            const supported = this.docs.getSupportedFormats().join(', ');
            await ctx.reply(`Unsupported format. Please send: ${supported}`);
            return;
        }

        if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
            await ctx.reply('File too large. Maximum 20MB.');
            return;
        }

        // Send immediate acknowledgment
        const statusMsg = await ctx.reply('Document queued for processing...');

        // Add to queue
        await this.queue.add(`doc-${Date.now()}`, {
            type: 'document',
            chatId: ctx.chat.id,
            fileId: doc.file_id,
            fileName: doc.file_name,
            mimeType: doc.mime_type,
            statusMsgId: statusMsg.message_id,
        });
    }

    private async queueVoice(ctx: Context): Promise<void> {
        const voice = ctx.message?.voice;
        if (!voice || !ctx.chat) return;

        // Send immediate acknowledgment
        const statusMsg = await ctx.reply('Voice message queued for transcription...');

        // Add to queue
        await this.queue.add(`voice-${Date.now()}`, {
            type: 'voice',
            chatId: ctx.chat.id,
            fileId: voice.file_id,
            statusMsgId: statusMsg.message_id,
        });
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

        // Health check endpoint
        app.get('/health', (req, res) => {
            res.json({ status: 'ok', queue: 'connected' });
        });

        app.post('*', async (req, res) => {
            const updateId = req.body.update_id;
            if (processedUpdates.has(updateId)) {
                res.sendStatus(200);
                return;
            }

            try {
                // Respond quickly to Telegram
                await webhookCallback(this.bot, 'express', { timeoutMilliseconds: 30000 })(req, res);
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

    async shutdown(): Promise<void> {
        console.log('Shutting down...');
        await this.worker?.close();
        await this.queue?.close();
        this.server?.close();
    }
}
