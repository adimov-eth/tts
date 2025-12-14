import { WebhookBot } from './webhookBot';
import dotenv from 'dotenv';

dotenv.config();

let bot: WebhookBot | undefined;

async function startBot() {
    try {
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const openAIApiKey = process.env.OPENAI_API_KEY;
        const port = process.env.PORT ? parseInt(process.env.PORT) : 3000;
        const domain = process.env.DOMAIN || 'tts.bkk.lol';
        const path = process.env.WEBHOOK_PATH || '/webhook';

        if (!token || !openAIApiKey) {
            throw new Error('Missing required environment variables');
        }

        // Create and initialize the bot
        bot = new WebhookBot(token, openAIApiKey, port, domain, path);

        // Set up webhook
        await bot.setWebhook();

        console.log('Bot is running with queue!');
        console.log(`Webhook URL: https://${domain}${path}`);
        console.log(`Port: ${port}`);

    } catch (error) {
        console.error('Failed to start bot:', error);
        process.exit(1);
    }
}

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await bot?.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await bot?.shutdown();
    process.exit(0);
});

startBot(); 