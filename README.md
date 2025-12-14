# Telegram TTS Bot

A Telegram bot that converts text and documents to speech using OpenAI's TTS API.

## Features

- **Text to Speech** - Send any text, get audio back
- **Document Support** - PDF, DOCX, TXT, MD files converted to audio
- **Voice Transcription** - Send voice messages, get transcription + audio response
- **AI Enhancement** - Optional GPT-4 text preprocessing for better speech
- **Customizable** - Voice selection, speed control, tone instructions
- **Long Text Chunking** - Automatically handles texts > 4096 chars
- **Invite System** - Admin/user roles with invite codes
- **Rate Limiting** - 10 req/min hard limit, 20k chars/day soft limit
- **Persistent Settings** - Preferences stored in Redis

## Architecture

```
Telegram → Webhook (HTTPS) → Express → BullMQ Queue → Worker → OpenAI TTS
                                ↓
                        Instant acknowledgment
                        (no timeout issues)
```

**Why queue-based?**
- Telegram webhooks timeout after 60s
- Document processing can take minutes
- Queue provides retries, rate limiting, crash recovery
- Concurrent processing (3 workers by default)

## Quick Start

### Local Development

```bash
# Install dependencies
bun install

# Start Redis
docker run -d -p 6379:6379 redis

# Copy env and add your keys
cp .env.example .env

# Run webhook mode (recommended)
bun run src/webhookIndex.ts

# For local testing, expose with tunnel
cloudflared tunnel --url http://localhost:3000
# Update DOMAIN in .env with the tunnel URL
```

### Production Deployment

See deployment checklist below.

## Bot Commands

| Command | Description |
|---------|-------------|
| `/start <code>` | Register with invite code |
| `/help` | Show commands |
| `/tts <text>` | Convert text to speech |
| `/ttsai <text>` | Convert with AI enhancement |
| `/voices` | List available voices |
| `/voice <name>` | Set voice (alloy, coral, nova, etc.) |
| `/speed <0.25-4.0>` | Set playback speed |
| `/tone <instruction>` | Set tone (e.g., "speak cheerfully") |
| `/settings` | Show current settings |

**Admin commands:**
| Command | Description |
|---------|-------------|
| `/invite` | Create user invite code |
| `/admincode` | Create admin invite code |
| `/codes` | List your active invite codes |
| `/revoke <code>` | Revoke an invite code |

**Also supports:**
- Send any text message → auto-converts to speech
- Send documents (PDF, DOCX, TXT, MD) → extracts and converts
- Send voice messages → transcribes and responds with audio

## Project Structure

```
src/
├── webhookIndex.ts    # Entry point (webhook mode)
├── webhookBot.ts      # Grammy bot + Express server
├── queue.ts           # BullMQ job definitions + worker
├── core.ts            # TTS business logic
├── openaiService.ts   # OpenAI API (TTS + transcription)
├── documentService.ts # PDF/DOCX parsing
├── userPreferences.ts # Per-user settings (wraps redis/preferences)
├── index.ts           # Entry point (polling mode)
├── bot.ts             # Polling bot (node-telegram-bot-api)
├── redis/
│   ├── client.ts      # Redis connection singleton
│   ├── preferences.ts # User preferences storage
│   ├── users.ts       # User management + auth
│   ├── invites.ts     # Invite code system
│   └── ratelimit.ts   # Rate limiting
└── middleware/
    ├── auth.ts        # Grammy auth middleware
    └── ratelimit.ts   # Grammy rate limit middleware

tests/
├── unit/              # Unit tests (vitest)
└── mocks/             # Redis, OpenAI, Telegram mocks
```

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key

# Bootstrap admins (comma-separated Telegram chat IDs)
ADMIN_CHAT_IDS=123456789,987654321

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Webhook
PORT=3000
DOMAIN=tts.example.com
WEBHOOK_PATH=/webhook
```

## Production Deployment Checklist

1. **Server Setup**
   ```bash
   # Create dedicated user
   useradd -r -m -d /srv/tts -s /bin/bash tts

   # Install Bun system-wide
   curl -fsSL https://bun.sh/install | BUN_INSTALL=/usr/local bash

   # Install Redis
   apt install redis-server
   systemctl enable redis-server
   ```

2. **Deploy Application**
   ```bash
   cd /srv/tts
   git clone https://github.com/adimov-eth/tts.git .
   bun install
   cp .env.example .env
   # Edit .env with production values
   chown -R tts:tts /srv/tts
   chmod 600 /srv/tts/.env
   ```

3. **Systemd Service** (`/etc/systemd/system/tts.service`)
   ```ini
   [Unit]
   Description=TTS Telegram Bot (Webhook)
   After=network.target redis-server.service
   Requires=redis-server.service

   [Service]
   Type=simple
   User=tts
   Group=tts
   WorkingDirectory=/srv/tts
   ExecStart=/usr/local/bin/bun run src/webhookIndex.ts
   Restart=always
   RestartSec=5
   Environment=NODE_ENV=production
   NoNewPrivileges=yes
   ProtectSystem=strict
   ProtectHome=yes
   ReadWritePaths=/srv/tts
   PrivateTmp=yes

   [Install]
   WantedBy=multi-user.target
   ```

4. **Nginx + HTTPS**
   ```bash
   apt install nginx certbot python3-certbot-nginx

   # Create /etc/nginx/sites-available/tts
   # Enable site, get certificate:
   certbot --nginx -d tts.example.com
   ```

5. **Firewall**
   ```bash
   ufw allow OpenSSH
   ufw allow 'Nginx Full'
   ufw enable
   ```

6. **Start**
   ```bash
   systemctl daemon-reload
   systemctl enable tts
   systemctl start tts
   ```

## OpenAI TTS Reference

### Voices

| Voice | Description |
|-------|-------------|
| `alloy` | Neutral, balanced (default) |
| `coral` | Warm, conversational |
| `nova` | Friendly, upbeat |
| `onyx` | Deep, authoritative |
| `shimmer` | Soft, gentle |
| + 6 more | ash, ballad, echo, fable, sage, verse |

Preview at: https://openai.fm/

### Models

| Model | Instructions Support | Notes |
|-------|---------------------|-------|
| `gpt-4o-mini-tts` | Yes | Best quality, supports tone/accent |
| `tts-1` | No | Fast, lower quality |
| `tts-1-hd` | No | Higher quality, slower |

### Supported Languages

57 languages including: English, Russian, Spanish, French, German, Chinese, Japanese, Korean, Arabic, Hindi, and more.

## Health Check

```bash
curl https://tts.example.com/health
# {"status":"ok","queue":"connected"}
```

## License

MIT
