import express, { Request, Response } from 'express';
import { Bot, Context, webhookCallback, InputFile } from 'grammy';
import { OpenAIService } from './openaiService';
import { Message } from '@grammyjs/types';
import http from 'http';

export class WebhookBot {
    private readonly bot: Bot;
    private readonly openAIService: OpenAIService;
    private readonly port: number;
    private readonly domain: string;
    private readonly path: string;
    private server!: http.Server;
    private readonly webhookUrl: string;

    constructor(token: string, openAIApiKey: string, port: number, domain: string, path: string) {
        this.bot = new Bot(token);
        this.openAIService = new OpenAIService(openAIApiKey);
        this.port = port;
        this.domain = domain;
        this.path = path;
        this.webhookUrl = `https://${this.domain}${this.path}`;

        // Initialize bot immediately
        this.init().catch(err => {
            console.error('Failed to initialize bot:', err);
            process.exit(1);
        });
    }

    private async init() {
        // Initialize the bot
        await this.bot.init();
        console.log('Bot initialized successfully');

        // Set up handlers and server
        this.setupHandlers();
        this.setupServer();
    }

    private setupHandlers() {
        // Handle text messages (including forwarded messages)
        this.bot.on('message:text', this.handleTextMessage.bind(this));

        // Handle voice messages
        this.bot.on('message:voice', this.handleVoiceMessage.bind(this));

        // Error handler
        this.bot.catch((err: Error) => {
            console.error('Bot Error:', err);
        });
    }

    private async handleTextMessage(ctx: Context) {
        try {
            const text = ctx.message?.text;
            if (!text) return;

            await ctx.reply('Processing your message...');

            // Transform text using AI
            const transformedText = await this.openAIService.transformText(text);
            console.log('Transformed text:', transformedText);

            // Generate speech
            const audioBuffer = await this.openAIService.generateSpeech(transformedText);
            console.log('Generated audio size:', audioBuffer.length);

            // Send audio
            const audioFile = new InputFile(audioBuffer, 'speech.ogg');
            await ctx.replyWithVoice(audioFile);

        } catch (error) {
            console.error('Error processing text message:', error);
            await ctx.reply('Sorry, there was an error processing your message. Please try again later.');
        }
    }

    private async handleVoiceMessage(ctx: Context) {
        try {
            const voice = ctx.message?.voice;
            if (!voice) return;

            await ctx.reply('Processing your voice message...');

            // Get file URL
            const file = await ctx.getFile();
            const fileUrl = `https://api.telegram.org/file/bot${this.bot.token}/${file.file_path}`;

            // Transcribe audio
            const transcribedText = await this.openAIService.transcribeAudio(fileUrl);
            console.log('Transcribed text:', transcribedText);

            // Transform transcribed text using AI
            const transformedText = await this.openAIService.transformText(transcribedText);
            console.log('Transformed text:', transformedText);

            // Send transcription
            await ctx.reply(`Transcription: ${transcribedText}\n\nEnhanced: ${transformedText}`);

            // Generate speech from enhanced text
            const audioBuffer = await this.openAIService.generateSpeech(transformedText);
            console.log('Generated audio size:', audioBuffer.length);

            // Send enhanced audio
            const audioFile = new InputFile(audioBuffer, 'enhanced_speech.ogg');
            await ctx.replyWithVoice(audioFile);

        } catch (error) {
            console.error('Error processing voice message:', error);
            await ctx.reply('Sorry, there was an error processing your voice message. Please try again later.');
        }
    }

    async setWebhook() {
        try {
            // Delete existing webhook
            await this.bot.api.deleteWebhook();
            console.log('Deleted existing webhook');

            // Set new webhook
            const webhookUrl = `https://${this.domain}${this.path}`;
            await this.bot.api.setWebhook(webhookUrl);
            console.log('Set new webhook URL:', webhookUrl);

            // Verify webhook
            const info = await this.bot.api.getWebhookInfo();
            console.log('Webhook info:', info);

            if (info.url !== webhookUrl) {
                throw new Error(`Webhook URL mismatch. Expected: ${webhookUrl}, Got: ${info.url}`);
            }

            return true;
        } catch (error) {
            console.error('Error setting webhook:', error);
            throw error;
        }
    }

    private setupServer() {
        const app = express();
        const router = express.Router();
        app.use(express.json());

        // Create a Set to track processed update IDs
        const processedUpdates = new Set<number>();

        const webhookHandler: express.RequestHandler = async (req, res, next) => {
            const updateId = req.body.update_id;
            
            console.log('Webhook received:', {
                update_id: updateId,
                message_id: req.body.message?.message_id,
                text_length: req.body.message?.text?.length
            });

            // Check if we've already processed this update
            if (processedUpdates.has(updateId)) {
                console.log(`Update ${updateId} already processed, skipping`);
                res.sendStatus(200);
                return;
            }

            try {
                // Process the update using webhookCallback for proper handling
                await webhookCallback(this.bot, 'express', {
                    timeoutMilliseconds: 120000 // 2 minutes timeout
                })(req, res);
                
                // Mark update as processed
                processedUpdates.add(updateId);
                
                // Clean up old updates (keep last 1000)
                if (processedUpdates.size > 1000) {
                    const toRemove = Array.from(processedUpdates).slice(0, processedUpdates.size - 1000);
                    toRemove.forEach(id => processedUpdates.delete(id));
                }

                console.log(`Successfully processed update ${updateId}`);
            } catch (error) {
                console.error('Error processing webhook:', error);
                // Don't mark as processed if there was an error
                res.sendStatus(500);
            }
        };

        router.post('/', webhookHandler);

        // Mount the router at the webhook path
        app.use(this.path, router);

        this.server = app.listen(this.port, '0.0.0.0', () => {
            console.log(`Bot is running on port ${this.port}`);
            console.log(`Webhook URL: ${this.webhookUrl}`);
            console.log(`Port: ${this.port}`);
        });
    }
} 