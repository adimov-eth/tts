# TTS Bot - Session Bootstrap

## Context
- TTS Telegram bot at `projects/tts/`
- Session 036: Refactored to shared core, both modes have identical features
- Uses `gpt-4o-mini-tts` model with voice/speed/instructions support

## Architecture
```
src/
├── core.ts           # Business logic (TTSCore class) - START HERE
├── userPreferences.ts # Per-user prefs (Map storage)
├── openaiService.ts   # OpenAI API (has chunking for transform, NOT for TTS)
├── bot.ts            # Polling transport
├── webhookBot.ts     # Webhook transport
├── index.ts          # Polling entry
└── webhookIndex.ts   # Webhook entry
```

## Current Features
- 11 voices (alloy, ash, ballad, coral, echo, fable, nova, onyx, sage, shimmer, verse)
- Speed control (0.25-4.0)
- Tone/instructions (gpt-4o-mini-tts only)
- Commands: /start, /help, /voices, /voice, /speed, /tone, /settings, /tts, /ttsai
- 4096 char limit with validation

## Next Task: Long Text & File Processing

**Read first:** `docs/LONG_TEXT_PLAN.md`

### Phase 1: Long text support
1. Modify `generateSpeech` to chunk internally (reuse `splitTextIntoChunks`)
2. Add ffmpeg-based audio concatenation
3. Add progress callback (`Processing 3/12...`)
4. Remove 4096 limit from core.ts (chunking handles it)

### Key insight
`splitTextIntoChunks()` already exists in openaiService.ts but only used for text transform. Need to apply same logic to TTS generation, then concat audio chunks.

### Dependencies needed
```bash
brew install ffmpeg  # System requirement
bun add fluent-ffmpeg @types/fluent-ffmpeg
```

## Testing
```bash
cd /Users/adimov/Developer/foundation/projects/tts
bun run src/webhookIndex.ts
# Other terminal: cloudflared tunnel --url http://localhost:3000
```

## Don't
- Don't add ElevenLabs back
- Don't over-engineer - sequential chunk processing is fine for now
- Don't forget progress feedback to user
