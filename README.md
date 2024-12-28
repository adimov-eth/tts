# Telegram TTS Bot

A Telegram bot that converts text to speech using OpenAI for text enhancement and ElevenLabs for high-quality voice synthesis.

## Features

- Convert text messages to speech
- Optional AI-powered text enhancement using OpenAI
- High-quality voice synthesis using ElevenLabs
- Queue management for handling multiple requests
- Simple and intuitive commands

## Prerequisites

- Node.js 16+ or Bun runtime
- Redis server (for queue management)
- Telegram Bot Token
- OpenAI API Key
- ElevenLabs API Key

## Setup

1. Clone the repository
2. Install dependencies:
   ```bash
   bun install
   ```

3. Copy `.env.example` to `.env` and fill in your API keys:
   ```bash
   cp .env.example .env
   ```

4. Edit `.env` and add your API keys:
   ```
   TELEGRAM_BOT_TOKEN=your-telegram-bot-token
   OPENAI_API_KEY=your-openai-api-key
   ELEVENLABS_API_KEY=your-elevenlabs-api-key
   ```

## Running the Bot

Development mode:
```bash
bun run src/index.ts
```

## Bot Commands

- `/start` - Initialize the bot and get welcome message
- `/help` - Show available commands
- `/tts <text>` - Convert text to speech
- `/ttsai <text>` - Convert text to speech with AI enhancement
- Or simply send any text message to convert it to speech

## Architecture

The bot is built with a modular architecture:

- `src/index.ts` - Entry point and environment setup
- `src/bot.ts` - Main bot implementation and command handlers
- `src/ttsQueue.ts` - Queue management for TTS jobs
- `src/openaiService.ts` - OpenAI integration for text enhancement
- `src/elevenService.ts` - ElevenLabs integration for voice synthesis

## License

MIT
