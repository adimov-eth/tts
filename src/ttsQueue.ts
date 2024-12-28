import { Queue, Worker, Job } from 'bullmq';
import { OpenAIService } from './openaiService';
import TelegramBot from 'node-telegram-bot-api';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

interface TTSJobData {
    chatId: number;
    text: string;
    useAI: boolean;
}

export class TTSQueueManager {
    private queue: Queue;
    private worker: Worker;
    private openAI: OpenAIService;
    private bot: TelegramBot;

    constructor(
        openAIApiKey: string,
        bot: TelegramBot,
        redisConfig = { host: 'localhost', port: 6379 }
    ) {
        console.log('Initializing TTSQueueManager');
        this.openAI = new OpenAIService(openAIApiKey);
        this.bot = bot;

        this.queue = new Queue('tts-queue', {
            connection: redisConfig
        });

        this.worker = new Worker('tts-queue', this.processJob.bind(this), {
            connection: redisConfig
        });

        this.worker.on('completed', (job) => {
            if (job) {
                console.log(`Job ${job.id} completed successfully`);
            }
        });

        this.worker.on('failed', (job, error) => {
            if (job) {
                console.error(`Job ${job.id} failed:`, error);
                const jobData = job.data as TTSJobData;
                this.bot.sendMessage(
                    jobData.chatId,
                    `❌ Error: ${error.message || 'Unknown error occurred'}`
                ).catch(console.error);
            }
        });

        console.log('TTSQueueManager initialized');
    }

    private async processJob(job: Job<TTSJobData>): Promise<void> {
        const { chatId, text, useAI } = job.data;
        console.log('Processing job:', {
            jobId: job.id,
            chatId,
            textLength: text.length,
            useAI
        });

        try {
            // Send processing message
            await this.bot.sendMessage(chatId, '🎵 Processing your text to speech request...');

            // Transform text with OpenAI if requested
            let processedText = text;
            if (useAI) {
                console.log('Using OpenAI to enhance text');
                processedText = await this.openAI.transformText(text);
                console.log('Text enhanced:', {
                    original: text,
                    enhanced: processedText
                });
            }

            // Generate speech using OpenAI TTS
            console.log('Generating speech from text:', processedText.substring(0, 100) + '...');
            const audioBuffer = await this.openAI.generateSpeech(processedText);
            console.log('Speech generated, buffer size:', audioBuffer.length);

            // Create temporary file
            const tempFile = path.join(os.tmpdir(), `voice-${Date.now()}.mp3`);
            await fs.writeFile(tempFile, audioBuffer);

            try {
                // Send the audio
                console.log('Sending audio to chat:', chatId);
                await this.bot.sendVoice(chatId, tempFile);
                console.log('Audio sent successfully');
            } finally {
                // Clean up temp file
                await fs.unlink(tempFile).catch(console.error);
            }

        } catch (error) {
            console.error('Error processing TTS job:', {
                jobId: job.id,
                error: error instanceof Error ? error.message : String(error),
                stack: error instanceof Error ? error.stack : undefined
            });
            
            let errorMessage = '❌ Sorry, there was an error processing your request.';
            if (error instanceof Error) {
                if (error.message.includes('OpenAI')) {
                    errorMessage = '❌ Error with text-to-speech service. Please try again later.';
                }
            }
            
            await this.bot.sendMessage(chatId, errorMessage);
            throw error;
        }
    }

    async addToQueue(chatId: number, text: string, useAI: boolean = false): Promise<Job<TTSJobData>> {
        console.log('Adding to queue:', {
            chatId,
            textLength: text.length,
            useAI
        });

        // Validate text length
        if (text.length > 4096) {
            throw new Error('Text is too long. Please keep it under 4096 characters.');
        }

        return await this.queue.add('tts-task', {
            chatId,
            text,
            useAI
        });
    }

    async shutdown(): Promise<void> {
        console.log('Shutting down TTSQueueManager');
        await this.queue.close();
        await this.worker.close();
        console.log('TTSQueueManager shut down successfully');
    }
} 