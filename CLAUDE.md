# TTS Bot - Project Context

## What This Is

Telegram bot converting text/documents to speech via OpenAI TTS API. Production deployment at tts.bkk.lol.

## Architecture (Dec 2024)

**Webhook mode with BullMQ queue:**
```
Telegram → nginx (HTTPS) → Auth/RateLimit → Express (:3000) → Queue → Worker → OpenAI
                                                  ↓
                                         Instant ack to Telegram
```

**Key directories:**
- `src/` - Main application code
- `src/redis/` - Redis modules (preferences, users, invites, rate limiting)
- `src/middleware/` - Grammy middleware (auth, rate limit)
- `tests/` - Vitest unit tests

**Key files:**
- `webhookBot.ts` - Grammy bot + Express, queues jobs
- `queue.ts` - BullMQ job types + worker
- `core.ts` - TTS business logic
- `bot.ts` - Polling mode alternative (same features)

## Auth & Rate Limiting

**Invite system:**
- Users need invite code to use bot
- Bootstrap admins via `ADMIN_CHAT_IDS` env var
- Admins create invite codes for users or other admins
- Commands: `/invite`, `/admincode`, `/codes`, `/revoke`

**Rate limits:**
- Hard: 10 requests/minute (blocks)
- Soft: 20,000 characters/day (notifies once, allows)

**Redis keys:**
```
tts:user:{chatId}     - user record (role, invitedBy, createdAt)
tts:invite:{code}     - invite code (role, createdBy, usesLeft)
tts:prefs:{chatId}    - preferences (voice, speed, instructions)
tts:rate:min:{id}:{m} - minute counter
tts:rate:day:{id}:{d} - daily char counter
```

## Production Setup

- **Server:** Ubuntu 24.04 at 89.125.209.100
- **Domain:** tts.bkk.lol (HTTPS via certbot)
- **User:** `tts` (dedicated, runs service)
- **App:** `/srv/tts`
- **Service:** systemd `tts.service`

**Useful commands:**
```bash
systemctl status tts           # check status
journalctl -u tts -f           # follow logs
systemctl restart tts          # restart
curl https://tts.bkk.lol/health  # health check
```

## Stack

- Runtime: Bun
- Bot: grammy (webhook) / node-telegram-bot-api (polling)
- Queue: BullMQ + Redis
- Storage: Redis (preferences, auth, rate limits)
- Tests: Vitest + ioredis-mock
- CI: GitHub Actions

## Development

```bash
docker run -d -p 6379:6379 redis
cp .env.example .env  # add ADMIN_CHAT_IDS=your_telegram_id
bun run src/webhookIndex.ts
cloudflared tunnel --url http://localhost:3000
```

## Testing

```bash
bun test           # run all tests
bun run tsc --noEmit  # type check
```

## Deployment

```bash
cd /srv/tts
git pull
bun install
systemctl restart tts
```
