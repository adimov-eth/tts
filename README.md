# Telegram TTS Bot

A Telegram bot that converts text to speech using OpenAI's TTS API.

## Current State (Session 035 - Dec 2024)

**Working:**
- Text → Speech via OpenAI TTS API
- AI text preprocessing (GPT-4 for punctuation, number formatting)
- Two modes: polling (dev) and webhook (prod)
- Retry logic with exponential backoff for API errors
- Russian language support confirmed working

**Cleaned up:**
- Removed dead ElevenLabs code
- Fixed env validation (no longer requires unused keys)
- Made domain configurable via env
- Fixed Buffer → Uint8Array type issues for Bun

## Quick Start

```bash
bun install
cp .env.example .env
# Edit .env with your tokens

# Polling mode (needs Redis)
docker run -d -p 6379:6379 redis
bun run src/index.ts

# Webhook mode (needs public URL)
bun run src/webhookIndex.ts
# In another terminal: cloudflared tunnel --url http://localhost:3000
```

## Bot Commands

- `/start` - Welcome message
- `/help` - Show commands
- `/tts <text>` - Convert text to speech
- `/ttsai <text>` - Convert with AI text enhancement
- Send any text message → auto-converts to speech

---

## OpenAI TTS API Reference

### Models

| Model | Quality | Latency | Instructions Support | Price |
|-------|---------|---------|---------------------|-------|
| `gpt-4o-mini-tts` | Best | Medium | Yes (tone, accent, emotion) | ~$0.015/min |
| `tts-1` | Lower | Fastest | No | $15/1M chars |
| `tts-1-hd` | Higher | Slower | No | $30/1M chars |

**Current bot uses:** `tts-1` (should upgrade to `gpt-4o-mini-tts`)

### Voices (11 available)

| Voice | Description |
|-------|-------------|
| `alloy` | Neutral, balanced (current default) |
| `ash` | - |
| `ballad` | - |
| `coral` | Recommended for conversational |
| `echo` | - |
| `fable` | - |
| `nova` | - |
| `onyx` | Deep, authoritative |
| `sage` | - |
| `shimmer` | - |
| `verse` | - |

Preview voices at: https://openai.fm/

### API Parameters

```typescript
{
  model: "gpt-4o-mini-tts",  // or tts-1, tts-1-hd
  input: string,             // Max 4096 characters
  voice: "alloy",            // One of 11 voices
  instructions?: string,     // ONLY for gpt-4o-mini-tts - control tone/accent
  response_format?: "mp3",   // mp3, opus, aac, flac, wav, pcm
  speed?: 1.0,               // 0.25 to 4.0
}
```

### Supported Languages

Follows Whisper model: Afrikaans, Arabic, Armenian, Azerbaijani, Belarusian, Bosnian, Bulgarian, Catalan, Chinese, Croatian, Czech, Danish, Dutch, English, Estonian, Finnish, French, Galician, German, Greek, Hebrew, Hindi, Hungarian, Icelandic, Indonesian, Italian, Japanese, Kannada, Kazakh, Korean, Latvian, Lithuanian, Macedonian, Malay, Marathi, Maori, Nepali, Norwegian, Persian, Polish, Portuguese, Romanian, **Russian**, Serbian, Slovak, Slovenian, Spanish, Swahili, Swedish, Tagalog, Tamil, Thai, Turkish, Ukrainian, Urdu, Vietnamese, Welsh.

### Streaming Support

For real-time audio output, use `with_streaming_response` and `wav`/`pcm` format for lowest latency.

---

## TODO: API Feature Implementation

### Priority 1: Upgrade to gpt-4o-mini-tts

```typescript
// In openaiService.ts, change:
model: 'tts-1'
// To:
model: 'gpt-4o-mini-tts'
```

Enables `instructions` parameter for tone control.

### Priority 2: Voice Selection

Add `/voice <name>` command to select voice:

```typescript
// New command in bot.ts
this.bot.onText(/\/voice (.+)/, (msg, match) => {
  const voice = match[1].toLowerCase();
  const validVoices = ['alloy', 'ash', 'ballad', 'coral', 'echo', 'fable', 'nova', 'onyx', 'sage', 'shimmer', 'verse'];
  if (validVoices.includes(voice)) {
    // Store in user preferences (Redis or in-memory map)
    userVoices.set(msg.chat.id, voice);
    this.bot.sendMessage(msg.chat.id, `Voice set to: ${voice}`);
  }
});

// Add /voices command to list options
this.bot.onText(/\/voices/, (msg) => {
  this.bot.sendMessage(msg.chat.id,
    'Available voices:\nalloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse\n\nPreview at: openai.fm'
  );
});
```

### Priority 3: Instructions/Tone Control

Only works with `gpt-4o-mini-tts`:

```typescript
// Add /tone command
this.bot.onText(/\/tone (.+)/, (msg, match) => {
  const instruction = match[1];
  userInstructions.set(msg.chat.id, instruction);
  this.bot.sendMessage(msg.chat.id, `Tone instruction set: ${instruction}`);
});

// Examples:
// /tone Speak in a cheerful and positive tone
// /tone Whisper softly
// /tone Speak with a British accent
// /tone Sound excited and energetic
```

### Priority 4: Speed Control

```typescript
// Add /speed command (0.25 to 4.0)
this.bot.onText(/\/speed ([\d.]+)/, (msg, match) => {
  const speed = parseFloat(match[1]);
  if (speed >= 0.25 && speed <= 4.0) {
    userSpeeds.set(msg.chat.id, speed);
    this.bot.sendMessage(msg.chat.id, `Speed set to: ${speed}x`);
  }
});
```

### Priority 5: Output Format Selection

```typescript
// For voice messages, opus is optimal (low latency, small size)
// Add option for users who want high quality downloads
response_format: 'opus' // or 'mp3', 'wav', 'flac'
```

---

## Backlog: Document Processing

Future feature: Extract text from documents and convert to speech.

### Supported Formats

| Format | Extraction Method |
|--------|------------------|
| PDF | `pdf-parse` or `@anthropic-ai/sdk` with vision |
| DOCX | `mammoth` |
| TXT | Direct read |
| MD | Direct read (strip formatting) |
| EPUB | `epub2` |
| HTML | `cheerio` (strip tags) |

### Implementation Approach

```typescript
// New handler for document messages
this.bot.on('document', async (msg) => {
  const doc = msg.document;
  const file = await this.bot.getFile(doc.file_id);
  const fileUrl = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

  // Download and extract based on mime type
  const text = await extractText(fileUrl, doc.mime_type);

  // Chunk if > 4096 chars
  const chunks = splitIntoChunks(text, 4000);

  // Process each chunk
  for (const chunk of chunks) {
    await this.queueManager.addToQueue(msg.chat.id, chunk, false);
  }
});
```

### Dependencies to Add

```bash
bun add pdf-parse mammoth cheerio epub2
```

### Chunking Strategy

For long documents:
1. Split by paragraphs/sentences (preserve natural breaks)
2. Keep chunks under 4000 chars (buffer for API)
3. Add brief pause between audio segments
4. Optionally concatenate final audio files

---

## Architecture

```
src/
├── index.ts         # Polling mode entry (node-telegram-bot-api + BullMQ)
├── bot.ts           # Telegram bot class
├── ttsQueue.ts      # BullMQ queue processor
├── openaiService.ts # OpenAI TTS + GPT-4 text transform
├── webhookIndex.ts  # Webhook mode entry (grammy)
├── webhookBot.ts    # Grammy webhook handler
└── setupWebhook.ts  # Webhook configuration script
```

**Note:** Two Telegram bot libraries exist (node-telegram-bot-api for polling, grammy for webhook). Could consolidate to grammy for both.

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=your_telegram_bot_token
OPENAI_API_KEY=your_openai_api_key

# Redis (polling mode)
REDIS_HOST=localhost
REDIS_PORT=6379

# Webhook mode
PORT=3000
DOMAIN=your-domain.example.com
WEBHOOK_PATH=/webhook
```

## Testing with Cloudflare Tunnel

```bash
# Terminal 1
bun run src/webhookIndex.ts

# Terminal 2
cloudflared tunnel --url http://localhost:3000
# Copy URL (e.g., https://abc-123.trycloudflare.com)
# Update DOMAIN in .env (without https://)
# Restart the bot
```

## License

MIT
