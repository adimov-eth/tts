import { config } from 'dotenv';
import { TTSBot } from './bot';

// Load environment variables
config();

const {
    TELEGRAM_BOT_TOKEN,
    OPENAI_API_KEY,
    ELEVENLABS_API_KEY
} = process.env;

// Validate environment variables
if (!TELEGRAM_BOT_TOKEN || !OPENAI_API_KEY || !ELEVENLABS_API_KEY) {
    console.error('Missing required environment variables. Please check your .env file.');
    process.exit(1);
}

// Create and start the bot
const bot = new TTSBot(
    TELEGRAM_BOT_TOKEN,
    ELEVENLABS_API_KEY,
    OPENAI_API_KEY
);

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