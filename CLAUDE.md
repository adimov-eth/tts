# TTS Bot - Project Context

## What This Is

Telegram bot converting text → speech via OpenAI TTS API. Simple utility, used as a test case for the foundation agentic architecture.

## Session 035 Cleanup (Dec 2024)

- Removed dead ElevenLabs code (was imported but never wired up)
- Fixed constructor signatures to not require unused API keys
- Made domain configurable via env (was hardcoded to tts.bkk.lol)
- Fixed Buffer → Uint8Array type issues for Bun compatibility
- Generated proper .env.example

## Architecture Decision

Two parallel implementations exist:
- **Polling mode** (`index.ts` → `bot.ts`): Uses node-telegram-bot-api + BullMQ queue
- **Webhook mode** (`webhookIndex.ts` → `webhookBot.ts`): Uses grammy, no queue

This is intentional - polling for dev simplicity, webhook for production.

## Known Issues / Future Work

- Two different Telegram bot libraries (could consolidate to grammy)
- No voice selection (hardcoded to 'alloy')
- No rate limiting / user quotas
- No tests

## Running Locally

```bash
# Needs Redis for polling mode
docker run -d -p 6379:6379 redis

# Copy env and add your keys
cp .env.example .env

# Run
bun run src/index.ts
```

## For Webhook Testing

```bash
# Terminal 1
bun run src/webhookIndex.ts

# Terminal 2
cloudflared tunnel --url http://localhost:3000
# Take the URL, update DOMAIN in .env
```
