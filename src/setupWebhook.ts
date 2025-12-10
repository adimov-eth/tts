import { config } from 'dotenv';

// Load environment variables
config();

const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN!;
const DOMAIN = process.env.DOMAIN || 'localhost';
const WEBHOOK_PATH = process.env.WEBHOOK_PATH || '/webhook';
const WEBHOOK_URL = `https://${DOMAIN}${WEBHOOK_PATH}`;

async function setupWebhook() {
    try {
        // First, delete any existing webhook
        console.log('Deleting existing webhook...');
        const deleteResponse = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`
        );
        const deleteData = await deleteResponse.json();
        console.log('Delete webhook response:', deleteData);

        // Set the new webhook
        console.log(`Setting webhook to: ${WEBHOOK_URL}`);
        const params = new URLSearchParams({
            url: WEBHOOK_URL,
            allowed_updates: JSON.stringify(['message', 'edited_message', 'channel_post', 'edited_channel_post'])
        });
        const setResponse = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook?${params}`
        );
        const setData = await setResponse.json();
        console.log('Set webhook response:', setData);

        // Verify the webhook configuration
        const infoResponse = await fetch(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
        );
        const infoData = await infoResponse.json();
        console.log('Webhook info:', infoData);

    } catch (error) {
        const msg = error instanceof Error ? error.message : 'Unknown error';
        console.error('Error:', msg);
        process.exit(1);
    }
}

setupWebhook().catch(console.error);
