import express from 'express';
import { Bot, Context, webhookCallback, InputFile } from 'grammy';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import { createQueue, createWorker, JobData } from './queue';
import { Queue, Worker } from 'bullmq';
import http from 'http';
import { authMiddleware, adminOnly } from './middleware/auth';
import { rateLimitMiddleware } from './middleware/ratelimit';
import { createInvite, listInvites, revokeInvite, isAdmin, isAuthorized, getInvite, redeemInvite, createUser } from './redis';

export class WebhookBot {
    private bot: Bot;
    private core: TTSCore;
    private docs: DocumentService;
    private port: number;
    private webhookUrl: string;
    private server!: http.Server;
    private queue!: Queue<JobData>;
    private worker!: Worker<JobData>;
    private botUsername!: string;

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
        this.botUsername = this.bot.botInfo.username;
        await this.bot.api.setMyCommands([
            { command: 'start', description: 'Start the bot (use with invite code)' },
            { command: 'help', description: 'Show help' },
            { command: 'tts', description: 'Convert text to speech' },
            { command: 'ttsai', description: 'Convert with AI enhancement' },
            { command: 'voices', description: 'List available voices' },
            { command: 'voice', description: 'Set voice' },
            { command: 'speed', description: 'Set speed (0.25-4.0)' },
            { command: 'tone', description: 'Set tone instruction' },
            { command: 'settings', description: 'Show current settings' },
            { command: 'invite', description: '(Admin) Create user invite' },
            { command: 'admincode', description: '(Admin) Create admin invite' },
            { command: 'codes', description: '(Admin) List your invite codes' },
            { command: 'revoke', description: '(Admin) Revoke an invite code' },
        ]);

        // Initialize queue and worker
        this.queue = createQueue();
        this.worker = createWorker(this.bot, this.core, this.docs, this.queue);

        console.log('Bot initialized with queue');
        this.setupHandlers();
        this.setupServer();
    }

    private inviteLink(code: string): string {
        return `https://t.me/${this.botUsername}?start=${code}`;
    }

    private setupHandlers() {
        // /start command handles auth specially (invite code redemption)
        this.bot.command('start', async (ctx) => {
            const chatId = ctx.chat.id;
            const code = ctx.match?.toString().trim();

            // Already authorized - show welcome
            if (await isAuthorized(chatId)) {
                const result = await this.core.handleStart(chatId);
                return ctx.reply(result.message);
            }

            // Try to redeem invite code
            if (code) {
                const invite = await getInvite(code);
                if (invite && await redeemInvite(code, chatId)) {
                    await ctx.reply(`Welcome! You've been registered as ${invite.role}.`);
                    const result = await this.core.handleStart(chatId);
                    return ctx.reply(result.message);
                }
            }

            // Not authorized and no valid code
            return ctx.reply('You need an invite code to use this bot. Send /start <code>');
        });

        // Handle plain text invite codes from unauthorized users (before auth middleware)
        this.bot.on('message:text', async (ctx, next) => {
            const chatId = ctx.chat.id;
            const text = ctx.message.text.trim();

            // Skip if authorized or if it's a command
            if (text.startsWith('/') || await isAuthorized(chatId)) {
                return next();
            }

            // Check if text looks like an invite code (8 hex chars)
            if (/^[a-f0-9]{8}$/i.test(text)) {
                const invite = await getInvite(text);
                if (invite && await redeemInvite(text, chatId)) {
                    await createUser(chatId, invite.role, invite.createdBy);
                    await ctx.reply(`Welcome! You've been registered as ${invite.role}.`);
                    const result = await this.core.handleStart(chatId);
                    return ctx.reply(result.message);
                }
            }

            return next();
        });

        // Apply auth middleware to all other handlers
        this.bot.use(authMiddleware());

        this.bot.command('help', async (ctx) => {
            const result = this.core.handleHelp();
            return ctx.reply(result.message);
        });

        this.bot.command('voices', async (ctx) => {
            const result = await this.core.handleVoices(ctx.chat.id);
            return ctx.reply(result.message);
        });

        this.bot.command('voice', async (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = await this.core.handleVoice(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('speed', async (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = await this.core.handleSpeed(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('tone', async (ctx) => {
            const arg = ctx.match?.toString().trim();
            const result = await this.core.handleTone(ctx.chat.id, arg || undefined);
            return ctx.reply(result.message);
        });

        this.bot.command('settings', async (ctx) => {
            const result = await this.core.handleSettings(ctx.chat.id);
            return ctx.reply(result.message);
        });

        // Admin commands
        this.bot.command('invite', async (ctx) => {
            if (!await isAdmin(ctx.chat.id)) {
                return ctx.reply('This command is for admins only.');
            }
            const code = await createInvite(ctx.chat.id, 'user');
            return ctx.reply(
                `User invite code: \`${code}\`\n\nShare link: ${this.inviteLink(code)}`,
                { parse_mode: 'Markdown' }
            );
        });

        this.bot.command('admincode', async (ctx) => {
            if (!await isAdmin(ctx.chat.id)) {
                return ctx.reply('This command is for admins only.');
            }
            const code = await createInvite(ctx.chat.id, 'admin');
            return ctx.reply(
                `Admin invite code: \`${code}\`\n\nShare link: ${this.inviteLink(code)}\n\n⚠️ This grants admin access!`,
                { parse_mode: 'Markdown' }
            );
        });

        this.bot.command('codes', async (ctx) => {
            if (!await isAdmin(ctx.chat.id)) {
                return ctx.reply('This command is for admins only.');
            }
            const invites = await listInvites(ctx.chat.id);
            if (invites.length === 0) {
                return ctx.reply('No active invite codes.');
            }
            const lines = invites.map(i => `\`${i.code}\` (${i.role}, ${i.usesLeft} uses left)`);
            return ctx.reply(`Your invite codes:\n${lines.join('\n')}`, { parse_mode: 'Markdown' });
        });

        this.bot.command('revoke', async (ctx) => {
            if (!await isAdmin(ctx.chat.id)) {
                return ctx.reply('This command is for admins only.');
            }
            const code = ctx.match?.toString().trim();
            if (!code) return ctx.reply('Usage: /revoke <code>');
            const success = await revokeInvite(code, ctx.chat.id);
            return ctx.reply(success ? `Revoked: ${code}` : 'Code not found or not yours.');
        });

        // TTS commands - queue for async processing (with rate limiting)
        this.bot.command('tts', rateLimitMiddleware(), async (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /tts <text>');
            return this.queueTTS(ctx, text, false);
        });

        this.bot.command('ttsai', rateLimitMiddleware(), async (ctx) => {
            const text = ctx.match?.toString().trim();
            if (!text) return ctx.reply('Usage: /ttsai <text>');
            return this.queueTTS(ctx, text, true);
        });

        // Text messages (not commands) - queue for processing (with rate limiting)
        this.bot.on('message:text', rateLimitMiddleware(), async (ctx) => {
            const text = ctx.message.text;
            if (text.startsWith('/')) {
                return ctx.reply('Unknown command. Use /help for available commands.');
            }
            if (!text.trim()) return;
            return this.queueTTS(ctx, text, false);
        });

        // Voice messages - queue for processing (with rate limiting)
        this.bot.on('message:voice', rateLimitMiddleware(), async (ctx) => {
            return this.queueVoice(ctx);
        });

        // Document uploads - queue for processing (with rate limiting)
        this.bot.on('message:document', rateLimitMiddleware(), async (ctx) => {
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
