import TelegramBot from 'node-telegram-bot-api';
import { TTSCore } from './core';
import { DocumentService } from './documentService';

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
            if (msg.text && !msg.text.startsWith('/') && msg.text.trim()) {
                this.processAndSend(msg.chat.id, msg.text, false);
            }
        });

        // Voice messages
        this.bot.on('voice', async (msg) => {
            if (msg.voice) {
                await this.processVoiceMessage(msg.chat.id, msg.voice);
            }
        });

        // Document uploads
        this.bot.on('document', (msg) => {
            if (msg.document) {
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
