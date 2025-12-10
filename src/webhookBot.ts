import express from 'express';
import { Bot, Context, webhookCallback, InputFile } from 'grammy';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import http from 'http';

export class WebhookBot {
    private bot: Bot;
    private core: TTSCore;
    private docs: DocumentService;
    private port: number;
    private webhookUrl: string;
    private server!: http.Server;

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
            if (text.startsWith('/')) {
                return ctx.reply('Unknown command. Use /help for available commands.');
            }
            if (!text.trim()) return; // Skip empty messages
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

        // Document uploads
        this.bot.on('message:document', (ctx) => {
            return this.processDocument(ctx);
        });

        this.bot.catch((err) => console.error('Bot error:', err));
    }

    private async processDocument(ctx: Context): Promise<void> {
        const doc = ctx.message?.document;
        if (!doc) return;

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

        let statusMsg: { chat: { id: number }; message_id: number } | undefined;

        try {
            statusMsg = await ctx.reply('Downloading document...');

            // Download file
            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;
            const response = await fetch(fileUrl);
            const buffer = Buffer.from(await response.arrayBuffer());

            await ctx.api.editMessageText(
                statusMsg.chat.id,
                statusMsg.message_id,
                'Parsing document...'
            ).catch(() => {});

            // Parse document
            const parsed = await this.docs.parseBuffer(buffer, format, doc.file_name);

            if (!parsed.text || parsed.text.length === 0) {
                throw new Error('Could not extract text from document');
            }

            const charCount = parsed.text.length;
            await ctx.api.editMessageText(
                statusMsg.chat.id,
                statusMsg.message_id,
                `Extracted ${charCount} characters. Generating audio...`
            ).catch(() => {});

            // Progress callback
            const onProgress = async (current: number, total: number, message: string) => {
                if (statusMsg && total > 1) {
                    await ctx.api.editMessageText(
                        statusMsg.chat.id,
                        statusMsg.message_id,
                        message
                    ).catch(() => {});
                }
            };

            if (!ctx.chat) throw new Error('No chat context');
            const { audio } = await this.core.generateSpeech(ctx.chat.id, parsed.text, false, onProgress);

            // Delete status message
            if (statusMsg) {
                await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
            }

            // Send audio
            await ctx.replyWithVoice(
                new InputFile(new Uint8Array(audio), 'speech.opus'),
                { caption: parsed.title ? `📄 ${parsed.title}` : undefined }
            );
        } catch (error) {
            if (statusMsg) {
                await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
            }
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await ctx.reply(`Error processing document: ${msg}`);
        }
    }

    private async processAndSend(ctx: Context, text: string, useAI: boolean) {
        let statusMsg: { chat: { id: number }; message_id: number } | undefined;

        try {
            statusMsg = await ctx.reply('Processing...');

            // Progress callback updates the status message
            const onProgress = async (current: number, total: number, message: string) => {
                if (statusMsg && total > 1) {
                    await ctx.api.editMessageText(
                        statusMsg.chat.id,
                        statusMsg.message_id,
                        message
                    ).catch(() => {}); // Ignore edit failures
                }
            };

            if (!ctx.chat) throw new Error('No chat context');
            const { audio } = await this.core.generateSpeech(ctx.chat.id, text, useAI, onProgress);

            // Delete status message before sending voice
            if (statusMsg) {
                await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
            }

            return ctx.replyWithVoice(new InputFile(new Uint8Array(audio), 'speech.opus'));
        } catch (error) {
            // Delete status message on error
            if (statusMsg) {
                await ctx.api.deleteMessage(statusMsg.chat.id, statusMsg.message_id).catch(() => {});
            }
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
