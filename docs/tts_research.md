# Building a production Telegram TTS bot with Bun and GrammyJS

OpenAI's newest **gpt-4o-mini-tts** model (March 2025) offers superior voice control through an `instructions` parameter unavailable in older models, while requesting **opus format directly** eliminates audio conversion overhead since Telegram natively requires OGG/Opus for voice messages. The architecture should queue TTS requests via BullMQ for reliability, cache results using text+voice+speed hashes, and implement fallback providers since ElevenLabs offers **10x better accuracy** than OpenAI but at **11x the cost**. Critical gotcha: **fluent-ffmpeg was archived in May 2025**—use direct FFmpeg spawning or Bun-native alternatives instead.

---

## OpenAI TTS API delivers steerable voices at competitive pricing

The **gpt-4o-mini-tts** model represents OpenAI's most capable TTS offering, priced at approximately **$0.015 per minute** of generated audio. Unlike tts-1 and tts-1-hd which accept raw text only, gpt-4o-mini-tts supports an `instructions` parameter enabling tone, accent, and speaking style control. The model accepts up to **2,000 input tokens** (roughly 4,000-8,000 characters depending on language) and supports 11 voices across 50+ languages.

```typescript
import OpenAI from 'openai';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
  maxRetries: 5,
  timeout: 60000,
});

async function generateTTS(text: string, voice: string = 'coral'): Promise<Buffer> {
  const response = await openai.audio.speech.create({
    model: 'gpt-4o-mini-tts',
    voice: voice as any,
    input: text,
    response_format: 'opus', // Native Telegram format!
    speed: 1.0,
    instructions: 'Speak in a warm, friendly tone with clear enunciation.',
  });
  
  return Buffer.from(await response.arrayBuffer());
}
```

For long text exceeding the token limit, chunk at sentence boundaries rather than arbitrary character counts. The safest approach targets **3,800 characters per chunk** with sentence-boundary detection, ensuring natural breaks for audio concatenation. Rate limits vary dramatically by tier—free accounts see roughly **3 requests per minute** while paid tiers scale significantly higher.

Error handling should distinguish between retryable errors (429 rate limits, 5xx server errors) and terminal failures (401 authentication, 400 bad requests). The OpenAI SDK handles basic retries automatically, but implementing exponential backoff with jitter prevents thundering herd problems when multiple users hit limits simultaneously. Always respect the `Retry-After` header when present.

---

## Document parsing requires format-specific libraries optimized for Bun

Text extraction quality varies dramatically across file formats and libraries. For **PDF files**, the choice depends on document complexity: **pdf-parse** (2.9M weekly downloads) handles simple text-based PDFs efficiently with pure JavaScript and explicit Bun support, while **unpdf** from the Nuxt ecosystem offers TypeScript-first design specifically optimized for serverless and Bun environments. Complex multi-column layouts benefit from **pdfjs-dist**, the same engine powering Firefox's PDF viewer.

```typescript
// Simple PDF extraction with pdf-parse
import { PDFParse } from 'pdf-parse';

const parser = new PDFParse({ url: 'https://example.com/file.pdf' });
const result = await parser.getText();
await parser.destroy();

// Serverless-optimized extraction with unpdf
import { extractText, getDocumentProxy } from 'unpdf';

const buffer = await Bun.file('./document.pdf').arrayBuffer();
const pdf = await getDocumentProxy(new Uint8Array(buffer));
const { text } = await extractText(pdf, { mergePages: true });
```

For **DOCX files**, **mammoth** dominates with 1.1M weekly downloads and excellent structure preservation—it converts Word documents to HTML or plain text while maintaining semantic hierarchy (headings, paragraphs, lists) crucial for natural TTS output. The `extractRawText()` method provides clean text extraction, while `convertToHtml()` preserves structure for chapter navigation.

**Markdown processing** benefits from combining **gray-matter** for frontmatter extraction with **remark** and the strip-markdown plugin for converting formatted text to TTS-friendly plain text. For **HTML**, **cheerio** offers jQuery-like syntax at 8x the speed of jsdom—remove script, style, and navigation elements before extracting body text. **EPUB handling** with **epub2** provides chapter iteration and TOC parsing essential for audiobook-style output.

Scanned PDFs require OCR via **tesseract.js**, which supports 100+ languages but cannot process PDFs directly—first render pages to images using pdfjs-dist. Cloud OCR services (Google Cloud Vision, AWS Textract) offer better accuracy for production workloads but add latency and cost.

---

## GrammyJS plugins enable sophisticated bot interactions

The **Conversations plugin** handles multi-step user flows elegantly, managing state across message exchanges without manual session tracking. The critical pattern: wrap all side effects in `conversation.external()` to prevent replay issues when conversations resume.

```typescript
import { type Conversation, conversations, createConversation } from '@grammyjs/conversations';

async function setupVoice(conversation: Conversation<Context>, ctx: Context) {
  await ctx.reply('Select your preferred voice:', { reply_markup: voiceKeyboard });
  const voiceCtx = await conversation.waitFor('callback_query:data');
  const voice = voiceCtx.callbackQuery.data.replace('voice_', '');
  await voiceCtx.answerCallbackQuery();
  
  await ctx.reply('Enter speaking speed (0.5-2.0):');
  const speedCtx = await conversation.waitFor('message:text');
  const speed = parseFloat(speedCtx.message.text);
  
  // Wrap session access in external() to prevent replay issues
  await conversation.external((ctx) => {
    ctx.session.voice = voice;
    ctx.session.speed = speed;
  });
  
  await ctx.reply(`Settings saved: ${voice} at ${speed}x speed`);
}

bot.use(conversations());
bot.use(createConversation(setupVoice));
bot.command('setup', (ctx) => ctx.conversation.enter('setupVoice'));
```

The **Menu plugin** simplifies complex navigation with nested menus and dynamic content. Menus automatically handle callback queries and support back navigation, state-dependent button labels, and hierarchical structures. Call `ctx.menu.update()` when dynamic button labels change to refresh the display.

**Session management** should use Redis in production via `@grammyjs/storage-redis` for distributed state, though the free cloud storage adapter works for hobby projects. Define TypeScript interfaces for session data to catch configuration errors at compile time. Session timeouts via `enhanceStorage()` prevent stale data accumulation.

For **long-running operations**, Telegram's webhook timeout of approximately **60 seconds** demands a respond-first pattern: acknowledge the user immediately, queue processing via BullMQ, and update the status message as work progresses. Use `ctx.replyWithChatAction('upload_voice')` to show typing indicators during generation, repeating every 5 seconds for extended operations.

**File upload handling** requires the `@grammyjs/files` plugin for downloading user-submitted documents. Telegram limits bot file downloads to **20MB** and uploads to **50MB**. Always validate file size and MIME type before processing—PDF, DOCX, and TXT represent the common TTS input formats.

```typescript
import { hydrateFiles } from '@grammyjs/files';

bot.api.config.use(hydrateFiles(bot.token));

bot.on('message:document', async (ctx) => {
  const doc = ctx.message.document;
  
  if (doc.file_size && doc.file_size > 20 * 1024 * 1024) {
    return ctx.reply('❌ File exceeds 20MB limit');
  }
  
  const allowedTypes = ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
  if (!allowedTypes.includes(doc.mime_type || '')) {
    return ctx.reply('❌ Unsupported format. Send PDF or DOCX.');
  }
  
  const file = await ctx.getFile();
  const path = await file.download();
  // Process extracted text...
});
```

---

## Audio processing demands Bun-compatible FFmpeg alternatives

**Fluent-ffmpeg was archived in May 2025** and has known compatibility issues with Bun's limited stdio stream support. For Bun projects, use direct process spawning or the **bun-ffmpeg** wrapper designed for the runtime.

```typescript
// Bun-native FFmpeg conversion to Telegram voice format
async function convertToTelegramVoice(inputPath: string, outputPath: string): Promise<void> {
  const proc = Bun.spawn([
    'ffmpeg',
    '-i', inputPath,
    '-c:a', 'libopus',
    '-b:a', '48k',
    '-ar', '48000',
    '-ac', '1',
    '-application', 'voip',
    '-vbr', 'on',
    outputPath
  ]);
  
  await proc.exited;
  if (proc.exitCode !== 0) {
    throw new Error(`FFmpeg failed with code ${proc.exitCode}`);
  }
}
```

Telegram voice messages require **OGG container with Opus codec** at 48kHz sample rate. Files under **1MB display native waveform visualization**; larger files up to 50MB send as audio files instead. Duration metadata is critical—without it, Telegram displays 00:00 regardless of actual length.

For concatenating multiple TTS chunks, use FFmpeg's concat demuxer with a list file for efficiency (avoids re-encoding), or the concat filter when normalizing different sample rates. Adding **0.5-1.5 second pauses** between paragraphs creates natural-sounding audiobook output using the `apad` filter or generated silence via `anullsrc`.

Use **ffmpeg-static** for bundled binaries in deployments, eliminating system dependencies. Temporary file management should use a `withTempDirectory` pattern that guarantees cleanup even on errors—audio processing generates many intermediate files that accumulate without proper disposal.

---

## Production architecture balances reliability with cost efficiency

**BullMQ** provides job queuing with priority levels (premium users get priority 1, standard users priority 10), automatic retries with exponential backoff, and progress tracking. Connect workers to Redis (or Dragonfly for better performance) and process jobs in parallel across multiple instances.

```typescript
import { Queue, Worker, QueueEvents } from 'bullmq';

const connection = { url: process.env.REDIS_URL };
const ttsQueue = new Queue('tts-processing', { connection });

// Add job with priority and retry config
await ttsQueue.add('generate-tts', 
  { text, voice, userId, chatId },
  { 
    priority: isPremium ? 1 : 10,
    attempts: 3,
    backoff: { type: 'exponential', delay: 1000 },
    removeOnComplete: true 
  }
);

// Worker processes jobs
const worker = new Worker('tts-processing', async (job) => {
  await job.updateProgress(10);
  const cacheKey = generateCacheKey(job.data.text, job.data.voice, job.data.speed);
  
  const cached = await redis.get(cacheKey);
  if (cached) return Buffer.from(cached, 'base64');
  
  await job.updateProgress(50);
  const audio = await generateTTS(job.data.text, job.data.voice);
  await redis.setex(cacheKey, 86400 * 7, audio.toString('base64'));
  
  return audio;
}, { connection, concurrency: 5 });
```

**Caching** uses SHA-256 hashes of `text:voice:speed` as keys, storing base64-encoded audio in Redis with 7-day TTL. For large audio files, store in S3/MinIO and cache only the reference URL. Implement cache-aside pattern: check cache first, generate on miss, store result.

**User quotas** track daily and monthly character limits per tier. Free users might receive 5,000 daily characters, premium 50,000. Store quota state in PostgreSQL for persistence, with Redis counters for fast runtime checks.

**Fallback TTS providers** ensure reliability when OpenAI experiences issues. ElevenLabs offers highest quality (82% accuracy vs OpenAI's 77%) with voice cloning capabilities, but costs **$0.165 per 1,000 characters** versus OpenAI's approximately **$0.015**. Google Cloud TTS and Amazon Polly provide cost-effective alternatives at $4-16 per million characters.

**Language detection** via **franc** (82-419 languages) or **Nito-ELD** (faster, 60 languages) enables automatic voice selection. Map detected language codes to appropriate voices per provider—Japanese text might route to OpenAI (better Asian language support) while European languages go to ElevenLabs.

**Monitoring** combines Sentry for error tracking with custom analytics tracking request counts, cache hit rates, and latency distributions. Set up Prometheus metrics for dashboard visualization and alerting on queue backlogs or error rate spikes.

---

## Testing strategies validate bot behavior without external dependencies

Bun's built-in test runner supports mocking and spying patterns essential for bot testing. Mock OpenAI API responses to test TTS integration without incurring costs or network latency.

```typescript
import { describe, expect, test, mock, spyOn } from 'bun:test';

describe('TTS Service', () => {
  test('generates audio from text', async () => {
    const mockCreate = mock(async () => ({
      arrayBuffer: async () => new ArrayBuffer(1000)
    }));
    
    const openai = { audio: { speech: { create: mockCreate } } };
    const service = new TTSService(openai as any);
    
    const result = await service.generate('Hello world', 'coral');
    
    expect(mockCreate).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'gpt-4o-mini-tts', voice: 'coral' })
    );
    expect(result).toBeInstanceOf(Buffer);
  });
});
```

Test Grammy handlers in isolation by creating mock context objects with the expected update structure. The `grammy_tests` library (in development) provides higher-level abstractions for simulating user interactions. Integration tests should verify the full flow from message receipt through queue processing to audio delivery, using test Redis instances and mocked external APIs.

---

## Conclusion

Building a production TTS bot requires careful orchestration of multiple systems: OpenAI's gpt-4o-mini-tts model for steerable voice generation, format-specific parsers for document text extraction, GrammyJS plugins for conversational UI, FFmpeg for audio processing (avoiding the deprecated fluent-ffmpeg), and BullMQ for reliable job processing. The most significant architectural decision involves the tradeoff between OpenAI's cost efficiency and ElevenLabs' superior quality—a hybrid approach using OpenAI as primary with ElevenLabs fallback balances cost and reliability.

Key implementation priorities: request opus format directly from OpenAI to eliminate conversion overhead, cache aggressively using content-addressable keys, implement proper quota tracking before users exhaust resources, and always respond to Telegram within 60 seconds by queuing heavy processing. The fluent-ffmpeg deprecation represents the most significant recent change affecting existing tutorials—migrate to direct spawning or Bun-native wrappers for new projects.