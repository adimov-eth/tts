# TTS Bot - Project Context

## What This Is

Telegram bot converting text/documents to speech via OpenAI TTS API. Production deployment at tts.bkk.lol.

## Current Architecture (Dec 2024)

**Webhook mode with BullMQ queue:**
```
Telegram → nginx (HTTPS) → Express (:3000) → Queue job → Worker → OpenAI
                                   ↓
                          Instant ack to Telegram
```

**Key files:**
- `src/webhookIndex.ts` - Entry point
- `src/webhookBot.ts` - Grammy bot + Express, queues jobs
- `src/queue.ts` - BullMQ job types + worker processing
- `src/core.ts` - TTS business logic
- `src/openaiService.ts` - OpenAI API calls

**Why queue?**
- Telegram webhooks timeout at 60s
- Document processing takes minutes
- Queue gives: retries, rate limiting, concurrent workers (3)

## Production Setup

- **Server:** Ubuntu 24.04 at 89.125.209.100
- **Domain:** tts.bkk.lol (HTTPS via certbot)
- **User:** `tts` (dedicated, runs service)
- **App:** `/srv/tts`
- **Service:** systemd `tts.service`

**Useful commands:**
```bash
systemctl status tts      # check status
journalctl -u tts -f      # follow logs
systemctl restart tts     # restart
curl https://tts.bkk.lol/health  # health check
```

## Stack

- Runtime: Bun (`/usr/local/bin/bun`)
- Bot framework: grammy
- Queue: BullMQ + Redis
- Reverse proxy: nginx
- Process manager: systemd

## Known Limitations

- User preferences stored in-memory (lost on restart)
- No rate limiting per user
- No admin commands

## Development

```bash
# Local dev
docker run -d -p 6379:6379 redis
bun run src/webhookIndex.ts
cloudflared tunnel --url http://localhost:3000
```

## Deployment

```bash
# On server
cd /srv/tts
git pull
bun install
systemctl restart tts
```
