import TelegramBot from 'node-telegram-bot-api';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import {
    isAuthorized,
    isAdmin,
    createUser,
    getInvite,
    redeemInvite,
    createInvite,
    listInvites,
    revokeInvite
} from './redis';
import {
    checkRateLimit,
    incrementUsage,
    markNotified,
    RATE_LIMIT_REQUESTS_PER_MINUTE,
    RATE_LIMIT_CHARS_PER_DAY
} from './redis/ratelimit';

export class TTSBot {
    private bot: TelegramBot;
    private core: TTSCore;
    private docs: DocumentService;

    constructor(telegramToken: string, openAIApiKey: string) {
        this.bot = new TelegramBot(telegramToken, { polling: true });
        this.core = new TTSCore(openAIApiKey);
        this.docs = new DocumentService();
        this.setupCommands();
        this.setupHandlers();
    }

    private async setupCommands(): Promise<void> {
        await this.bot.setMyCommands([
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
    }

    private async checkAuth(chatId: number): Promise<boolean> {
        if (await isAuthorized(chatId)) return true;
        this.bot.sendMessage(chatId, 'You need an invite code to use this bot. Send /start <code>');
        return false;
    }

    private async checkRateLimitAndIncrement(chatId: number, text: string): Promise<boolean> {
        const result = await checkRateLimit(chatId, text.length);

        if (!result.allowed && result.reason === 'minute_limit') {
            this.bot.sendMessage(chatId, `Rate limit exceeded. Maximum ${RATE_LIMIT_REQUESTS_PER_MINUTE} requests per minute. Please wait.`);
            return false;
        }

        if (result.shouldNotify) {
            this.bot.sendMessage(chatId, `Notice: You have used over ${RATE_LIMIT_CHARS_PER_DAY.toLocaleString()} characters today. Usage continues but consider pacing yourself.`);
            await markNotified(chatId);
        }

        await incrementUsage(chatId, text.length);
        return true;
    }

    private setupHandlers(): void {
        // /start handles invite code redemption (no auth check)
        this.bot.onText(/\/start(?:\s+(.+))?/, async (msg, match) => {
            const chatId = msg.chat.id;
            const code = match?.[1]?.trim();

            // Already authorized - show welcome
            if (await isAuthorized(chatId)) {
                const result = await this.core.handleStart(chatId);
                return this.bot.sendMessage(chatId, result.message);
            }

            // Try to redeem invite code
            if (code) {
                const invite = await getInvite(code);
                if (invite && await redeemInvite(code, chatId)) {
                    await createUser(chatId, invite.role, invite.createdBy);
                    await this.bot.sendMessage(chatId, `Welcome! You've been registered as ${invite.role}.`);
                    const result = await this.core.handleStart(chatId);
                    return this.bot.sendMessage(chatId, result.message);
                }
            }

            // Not authorized and no valid code
            return this.bot.sendMessage(chatId, 'You need an invite code to use this bot. Send /start <code>');
        });

        this.bot.onText(/\/help/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = this.core.handleHelp();
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/voices/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = await this.core.handleVoices(msg.chat.id);
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        // Word boundary prevents matching /voices
        this.bot.onText(/\/voice\b(?:\s+(.+))?/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = await this.core.handleVoice(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/speed(?:\s+(.+))?/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = await this.core.handleSpeed(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/tone(?:\s+(.+))?/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = await this.core.handleTone(msg.chat.id, match?.[1]?.trim());
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        this.bot.onText(/\/settings/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const result = await this.core.handleSettings(msg.chat.id);
            this.bot.sendMessage(msg.chat.id, result.message);
        });

        // Admin commands
        this.bot.onText(/\/invite/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            if (!await isAdmin(msg.chat.id)) {
                return this.bot.sendMessage(msg.chat.id, 'This command is for admins only.');
            }
            const code = await createInvite(msg.chat.id, 'user');
            return this.bot.sendMessage(msg.chat.id, `User invite code: ${code}\nShare this to invite someone.`);
        });

        this.bot.onText(/\/admincode/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            if (!await isAdmin(msg.chat.id)) {
                return this.bot.sendMessage(msg.chat.id, 'This command is for admins only.');
            }
            const code = await createInvite(msg.chat.id, 'admin');
            return this.bot.sendMessage(msg.chat.id, `Admin invite code: ${code}\nShare carefully - this grants admin access.`);
        });

        this.bot.onText(/\/codes/, async (msg) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            if (!await isAdmin(msg.chat.id)) {
                return this.bot.sendMessage(msg.chat.id, 'This command is for admins only.');
            }
            const invites = await listInvites(msg.chat.id);
            if (invites.length === 0) {
                return this.bot.sendMessage(msg.chat.id, 'No active invite codes.');
            }
            const lines = invites.map(i => `${i.code} (${i.role}, ${i.usesLeft} uses left)`);
            return this.bot.sendMessage(msg.chat.id, `Your invite codes:\n${lines.join('\n')}`);
        });

        this.bot.onText(/\/revoke(?:\s+(.+))?/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            if (!await isAdmin(msg.chat.id)) {
                return this.bot.sendMessage(msg.chat.id, 'This command is for admins only.');
            }
            const code = match?.[1]?.trim();
            if (!code) return this.bot.sendMessage(msg.chat.id, 'Usage: /revoke <code>');
            const success = await revokeInvite(code, msg.chat.id);
            return this.bot.sendMessage(msg.chat.id, success ? `Revoked: ${code}` : 'Code not found or not yours.');
        });

        // TTS commands with auth + rate limiting
        this.bot.onText(/\/tts(?:\s+(.+))?$/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const text = match?.[1]?.trim();
            if (!text) {
                this.bot.sendMessage(msg.chat.id, 'Usage: /tts <text>');
                return;
            }
            if (!await this.checkRateLimitAndIncrement(msg.chat.id, text)) return;
            this.processAndSend(msg.chat.id, text, false);
        });

        this.bot.onText(/\/ttsai(?:\s+(.+))?$/, async (msg, match) => {
            if (!await this.checkAuth(msg.chat.id)) return;
            const text = match?.[1]?.trim();
            if (!text) {
                this.bot.sendMessage(msg.chat.id, 'Usage: /ttsai <text>');
                return;
            }
            if (!await this.checkRateLimitAndIncrement(msg.chat.id, text)) return;
            this.processAndSend(msg.chat.id, text, true);
        });

        // Regular text messages with auth + rate limiting
        this.bot.on('message', async (msg) => {
            // Skip if it's a document, voice, or other non-text message
            if (msg.document || msg.voice || msg.photo || msg.video || msg.audio) {
                return;
            }
            if (msg.text && !msg.text.startsWith('/') && msg.text.trim()) {
                if (!await this.checkAuth(msg.chat.id)) return;
                if (!await this.checkRateLimitAndIncrement(msg.chat.id, msg.text)) return;
                this.processAndSend(msg.chat.id, msg.text, false);
            }
        });

        // Voice messages with auth + rate limiting
        this.bot.on('voice', async (msg) => {
            if (msg.voice) {
                if (!await this.checkAuth(msg.chat.id)) return;
                // Rate limit with estimated transcription size
                if (!await this.checkRateLimitAndIncrement(msg.chat.id, '')) return;
                await this.processVoiceMessage(msg.chat.id, msg.voice);
            }
        });

        // Document uploads with auth + rate limiting
        this.bot.on('document', async (msg) => {
            if (msg.document) {
                if (!await this.checkAuth(msg.chat.id)) return;
                // Rate limit with estimated document size
                if (!await this.checkRateLimitAndIncrement(msg.chat.id, '')) return;
                this.processDocument(msg.chat.id, msg.document);
            }
        });
    }

    private async processDocument(
        chatId: number,
        doc: TelegramBot.Document
    ): Promise<void> {
        const format = this.docs.detectFormat(doc.file_name || '', doc.mime_type);

        if (!format) {
            const supported = this.docs.getSupportedFormats().join(', ');
            await this.bot.sendMessage(
                chatId,
                `Unsupported format. Please send: ${supported}`
            );
            return;
        }

        // Check file size (Telegram limit is 20MB for bots)
        if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
            await this.bot.sendMessage(chatId, 'File too large. Maximum 20MB.');
            return;
        }

        let statusMsgId: number | undefined;

        try {
            const statusMsg = await this.bot.sendMessage(chatId, 'Downloading document...');
            statusMsgId = statusMsg.message_id;

            // Download file
            const fileLink = await this.bot.getFileLink(doc.file_id);
            const response = await fetch(fileLink);
            const buffer = Buffer.from(await response.arrayBuffer());

            await this.bot.editMessageText('Parsing document...', {
                chat_id: chatId,
                message_id: statusMsgId,
            }).catch(() => {});

            // Parse document
            const parsed = await this.docs.parseBuffer(buffer, format, doc.file_name);

            if (!parsed.text || parsed.text.length === 0) {
                throw new Error('Could not extract text from document');
            }

            const charCount = parsed.text.length;
            await this.bot.editMessageText(
                `Extracted ${charCount} characters. Generating audio...`,
                { chat_id: chatId, message_id: statusMsgId }
            ).catch(() => {});

            // Progress callback
            const onProgress = async (current: number, total: number, message: string) => {
                if (statusMsgId && total > 1) {
                    await this.bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: statusMsgId,
                    }).catch(() => {});
                }
            };

            const { audio } = await this.core.generateSpeech(chatId, parsed.text, false, onProgress);

            // Delete status message
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
            }

            // Send audio directly from buffer
            await this.bot.sendVoice(chatId, audio, {
                caption: parsed.title ? `📄 ${parsed.title}` : undefined,
            });
        } catch (error) {
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
            }
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await this.bot.sendMessage(chatId, `Error processing document: ${msg}`);
        }
    }

    private async processVoiceMessage(
        chatId: number,
        voice: TelegramBot.Voice
    ): Promise<void> {
        let statusMsgId: number | undefined;

        try {
            const statusMsg = await this.bot.sendMessage(chatId, 'Transcribing...');
            statusMsgId = statusMsg.message_id;

            // Download voice file
            const fileLink = await this.bot.getFileLink(voice.file_id);

            // Transcribe the audio
            const transcribed = await this.core.transcribeAudio(fileLink);

            // Delete status message
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
                statusMsgId = undefined;
            }

            // Send transcription
            await this.bot.sendMessage(chatId, `Transcription: ${transcribed}`);

            // Convert transcription to speech
            await this.processAndSend(chatId, transcribed, true);
        } catch (error) {
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
            }
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await this.bot.sendMessage(chatId, `Error: ${msg}`);
        }
    }

    private async processAndSend(chatId: number, text: string, useAI: boolean): Promise<void> {
        let statusMsgId: number | undefined;

        try {
            const statusMsg = await this.bot.sendMessage(chatId, 'Processing...');
            statusMsgId = statusMsg.message_id;

            // Progress callback updates the status message
            const onProgress = async (current: number, total: number, message: string) => {
                if (statusMsgId && total > 1) {
                    await this.bot.editMessageText(message, {
                        chat_id: chatId,
                        message_id: statusMsgId,
                    }).catch(() => {}); // Ignore edit failures
                }
            };

            const { audio } = await this.core.generateSpeech(chatId, text, useAI, onProgress);

            // Delete status message before sending voice
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
            }

            await this.bot.sendVoice(chatId, audio);
        } catch (error) {
            // Delete status message on error
            if (statusMsgId) {
                await this.bot.deleteMessage(chatId, statusMsgId).catch(() => {});
            }
            const msg = error instanceof Error ? error.message : 'Unknown error';
            await this.bot.sendMessage(chatId, `Error: ${msg}`);
        }
    }

    async shutdown(): Promise<void> {
        this.bot.stopPolling();
    }
}
