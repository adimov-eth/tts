import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import { Bot, InputFile } from 'grammy';

// Job types
export type JobType = 'tts' | 'ttsai' | 'document' | 'voice';

export interface TTSJobData {
    type: 'tts' | 'ttsai';
    chatId: number;
    text: string;
    statusMsgId?: number;
}

export interface DocumentJobData {
    type: 'document';
    chatId: number;
    fileId: string;
    fileName?: string;
    mimeType?: string;
    statusMsgId?: number;
}

export interface VoiceJobData {
    type: 'voice';
    chatId: number;
    fileId: string;
    statusMsgId?: number;
}

export type JobData = TTSJobData | DocumentJobData | VoiceJobData;

const QUEUE_NAME = 'tts-jobs';

// Redis connection config
const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
};

// Create queue
export function createQueue(): Queue<JobData> {
    const connection = new Redis(redisConfig);
    return new Queue<JobData>(QUEUE_NAME, { connection });
}

// Create worker
export function createWorker(
    bot: Bot,
    core: TTSCore,
    docs: DocumentService
): Worker<JobData> {
    const connection = new Redis(redisConfig);

    const worker = new Worker<JobData>(
        QUEUE_NAME,
        async (job: Job<JobData>) => {
            const { data } = job;

            try {
                switch (data.type) {
                    case 'tts':
                    case 'ttsai':
                        await processTTS(bot, core, data);
                        break;
                    case 'document':
                        await processDocument(bot, core, docs, data);
                        break;
                    case 'voice':
                        await processVoice(bot, core, data);
                        break;
                }
            } catch (error) {
                const msg = error instanceof Error ? error.message : 'Unknown error';
                await bot.api.sendMessage(data.chatId, `Error: ${msg}`).catch(() => {});
                throw error; // Re-throw for BullMQ retry logic
            }
        },
        {
            connection,
            concurrency: 3, // Process up to 3 jobs concurrently
        }
    );

    worker.on('failed', (job, err) => {
        console.error(`Job ${job?.id} failed:`, err.message);
    });

    worker.on('completed', (job) => {
        console.log(`Job ${job.id} completed`);
    });

    return worker;
}

async function processTTS(bot: Bot, core: TTSCore, data: TTSJobData): Promise<void> {
    const { chatId, text, statusMsgId } = data;
    const useAI = data.type === 'ttsai';

    try {
        // Progress callback
        const onProgress = async (current: number, total: number, message: string) => {
            if (statusMsgId && total > 1) {
                await bot.api.editMessageText(chatId, statusMsgId, message).catch(() => {});
            }
        };

        const { audio } = await core.generateSpeech(chatId, text, useAI, onProgress);

        // Delete status message
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }

        // Send audio
        await bot.api.sendVoice(chatId, new InputFile(new Uint8Array(audio), 'speech.opus'));
    } catch (error) {
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }
        throw error;
    }
}

async function processDocument(
    bot: Bot,
    core: TTSCore,
    docs: DocumentService,
    data: DocumentJobData
): Promise<void> {
    const { chatId, fileId, fileName, statusMsgId } = data;

    try {
        // Update status
        if (statusMsgId) {
            await bot.api.editMessageText(chatId, statusMsgId, 'Downloading document...').catch(() => {});
        }

        // Download file
        const file = await bot.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;
        const response = await fetch(fileUrl);
        const buffer = Buffer.from(await response.arrayBuffer());

        if (statusMsgId) {
            await bot.api.editMessageText(chatId, statusMsgId, 'Parsing document...').catch(() => {});
        }

        // Detect format and parse
        const format = docs.detectFormat(fileName || '', data.mimeType);
        if (!format) {
            throw new Error('Unsupported document format');
        }

        const parsed = await docs.parseBuffer(buffer, format, fileName);

        if (!parsed.text || parsed.text.length === 0) {
            throw new Error('Could not extract text from document');
        }

        const charCount = parsed.text.length;
        if (statusMsgId) {
            await bot.api.editMessageText(
                chatId,
                statusMsgId,
                `Extracted ${charCount} characters. Generating audio...`
            ).catch(() => {});
        }

        // Progress callback
        const onProgress = async (current: number, total: number, message: string) => {
            if (statusMsgId && total > 1) {
                await bot.api.editMessageText(chatId, statusMsgId, message).catch(() => {});
            }
        };

        const { audio } = await core.generateSpeech(chatId, parsed.text, false, onProgress);

        // Delete status message
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }

        // Send audio
        await bot.api.sendVoice(
            chatId,
            new InputFile(new Uint8Array(audio), 'speech.opus'),
            { caption: parsed.title ? `📄 ${parsed.title}` : undefined }
        );
    } catch (error) {
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }
        throw error;
    }
}

async function processVoice(bot: Bot, core: TTSCore, data: VoiceJobData): Promise<void> {
    const { chatId, fileId, statusMsgId } = data;

    try {
        // Download voice file
        const file = await bot.api.getFile(fileId);
        const fileUrl = `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`;

        // Transcribe
        const transcribed = await core.transcribeAudio(fileUrl);

        // Delete status message
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }

        // Send transcription
        await bot.api.sendMessage(chatId, `Transcription: ${transcribed}`);

        // Queue TTS job for the transcription
        const queue = createQueue();
        const statusMsg = await bot.api.sendMessage(chatId, 'Converting to speech...');

        await queue.add('tts-from-voice', {
            type: 'ttsai',
            chatId,
            text: transcribed,
            statusMsgId: statusMsg.message_id,
        });

        await queue.close();
    } catch (error) {
        if (statusMsgId) {
            await bot.api.deleteMessage(chatId, statusMsgId).catch(() => {});
        }
        throw error;
    }
}
