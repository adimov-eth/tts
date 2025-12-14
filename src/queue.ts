import { Queue, Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import { TTSCore } from './core';
import { DocumentService } from './documentService';
import { Bot, InputFile } from 'grammy';

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

const redisConfig = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    maxRetriesPerRequest: null,
};

export function createQueue(): Queue<JobData> {
    return new Queue<JobData>(QUEUE_NAME, { connection: new Redis(redisConfig) });
}

export function createWorker(
    bot: Bot,
    core: TTSCore,
    docs: DocumentService,
    queue: Queue<JobData>
): Worker<JobData> {
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
                        await processVoice(bot, core, queue, data);
                        break;
                }
            } catch (error) {
                await deleteStatus(bot, data.chatId, data.statusMsgId);
                const msg = error instanceof Error ? error.message : 'Unknown error';
                await bot.api.sendMessage(data.chatId, `Error: ${msg}`).catch(() => {});
                throw error;
            }
        },
        { connection: new Redis(redisConfig), concurrency: 3 }
    );

    worker.on('failed', (job, err) => console.error(`Job ${job?.id} failed:`, err.message));
    worker.on('completed', (job) => console.log(`Job ${job.id} completed`));

    return worker;
}

async function deleteStatus(bot: Bot, chatId: number, msgId?: number): Promise<void> {
    if (msgId) await bot.api.deleteMessage(chatId, msgId).catch(() => {});
}

async function updateStatus(bot: Bot, chatId: number, msgId: number | undefined, text: string): Promise<void> {
    if (msgId) await bot.api.editMessageText(chatId, msgId, text).catch(() => {});
}

async function processTTS(bot: Bot, core: TTSCore, data: TTSJobData): Promise<void> {
    const { chatId, text, statusMsgId } = data;

    const onProgress = async (_: number, total: number, message: string) => {
        if (total > 1) await updateStatus(bot, chatId, statusMsgId, message);
    };

    const { audio } = await core.generateSpeech(chatId, text, data.type === 'ttsai', onProgress);
    await deleteStatus(bot, chatId, statusMsgId);
    await bot.api.sendVoice(chatId, new InputFile(new Uint8Array(audio), 'speech.opus'));
}

async function processDocument(
    bot: Bot,
    core: TTSCore,
    docs: DocumentService,
    data: DocumentJobData
): Promise<void> {
    const { chatId, fileId, fileName, statusMsgId } = data;

    await updateStatus(bot, chatId, statusMsgId, 'Downloading document...');

    const file = await bot.api.getFile(fileId);
    const response = await fetch(`https://api.telegram.org/file/bot${bot.token}/${file.file_path}`);
    const buffer = Buffer.from(await response.arrayBuffer());

    await updateStatus(bot, chatId, statusMsgId, 'Parsing document...');

    const format = docs.detectFormat(fileName || '', data.mimeType);
    if (!format) throw new Error('Unsupported document format');

    const parsed = await docs.parseBuffer(buffer, format, fileName);
    if (!parsed.text?.length) throw new Error('Could not extract text from document');

    await updateStatus(bot, chatId, statusMsgId, `Extracted ${parsed.text.length} characters. Generating audio...`);

    const onProgress = async (_: number, total: number, message: string) => {
        if (total > 1) await updateStatus(bot, chatId, statusMsgId, message);
    };

    const { audio } = await core.generateSpeech(chatId, parsed.text, false, onProgress);
    await deleteStatus(bot, chatId, statusMsgId);
    await bot.api.sendVoice(
        chatId,
        new InputFile(new Uint8Array(audio), 'speech.opus'),
        { caption: parsed.title ? `📄 ${parsed.title}` : undefined }
    );
}

async function processVoice(
    bot: Bot,
    core: TTSCore,
    queue: Queue<JobData>,
    data: VoiceJobData
): Promise<void> {
    const { chatId, fileId, statusMsgId } = data;

    const file = await bot.api.getFile(fileId);
    const transcribed = await core.transcribeAudio(
        `https://api.telegram.org/file/bot${bot.token}/${file.file_path}`
    );

    await deleteStatus(bot, chatId, statusMsgId);
    await bot.api.sendMessage(chatId, `Transcription: ${transcribed}`);

    const statusMsg = await bot.api.sendMessage(chatId, 'Converting to speech...');
    await queue.add(`tts-from-voice-${Date.now()}`, {
        type: 'ttsai',
        chatId,
        text: transcribed,
        statusMsgId: statusMsg.message_id,
    });
}
