import { config } from 'dotenv';
import axios from 'axios';

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
        const deleteResponse = await axios.get(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/deleteWebhook`
        );
        console.log('Delete webhook response:', deleteResponse.data);

        // Set the new webhook
        console.log(`Setting webhook to: ${WEBHOOK_URL}`);
        const setResponse = await axios.get(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/setWebhook`,
            {
                params: {
                    url: WEBHOOK_URL,
                    allowed_updates: ['message', 'edited_message', 'channel_post', 'edited_channel_post']
                }
            }
        );
        console.log('Set webhook response:', setResponse.data);

        // Verify the webhook configuration
        const infoResponse = await axios.get(
            `https://api.telegram.org/bot${TELEGRAM_BOT_TOKEN}/getWebhookInfo`
        );
        console.log('Webhook info:', infoResponse.data);

    } catch (error) {
        if (axios.isAxiosError(error)) {
            console.error('Error:', error.response?.data || error.message);
        } else {
            console.error('Error:', error);
        }
        process.exit(1);
    }
}

setupWebhook().catch(console.error); 