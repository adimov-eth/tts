import { config } from 'dotenv';
import { TTSBot } from './bot';

config();

const { TELEGRAM_BOT_TOKEN, OPENAI_API_KEY } = process.env;

if (!TELEGRAM_BOT_TOKEN || !OPENAI_API_KEY) {
    console.error('Missing required environment variables: TELEGRAM_BOT_TOKEN, OPENAI_API_KEY');
    process.exit(1);
}

const bot = new TTSBot(TELEGRAM_BOT_TOKEN, OPENAI_API_KEY);

// Handle shutdown gracefully
process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await bot.shutdown();
    process.exit(0);
});

process.on('SIGTERM', async () => {
    console.log('Shutting down...');
    await bot.shutdown();
    process.exit(0);
});

console.log('TTS Bot is running...'); 