# Long Text & File Processing Plan

## Current State
- `splitTextIntoChunks()` exists in openaiService.ts - used only for GPT-4 text transform
- `generateSpeech()` has hard 4096 char limit - no chunking
- No file parsing capability

## Architecture

```
Input (text or file)
    ↓
[File Parser] → Extract text (PDF, DOCX, TXT, MD, EPUB, HTML)
    ↓
[Chunker] → Split at natural boundaries (sentences/paragraphs)
    ↓
[TTS Generator] → Parallel/sequential audio generation per chunk
    ↓
[Audio Concatenator] → Merge chunks into single file
    ↓
Output (mp3/opus file)
```

## 1. Text Chunking Strategy

**Boundary priority:**
1. Paragraph breaks (`\n\n`) - natural pauses
2. Sentence ends (`.!?`) - short pauses
3. Clause breaks (`,;:`) - last resort
4. Hard split at 4000 chars - emergency

**Why 4000 not 4096:** Safety margin for encoding differences.

```typescript
interface Chunk {
    text: string;
    index: number;
    isLast: boolean;
}

function chunkText(text: string, maxLen = 4000): Chunk[]
```

## 2. Audio Concatenation

**Options:**

| Method | Pros | Cons |
|--------|------|------|
| ffmpeg CLI | Robust, all formats | External dependency |
| fluent-ffmpeg | Node wrapper | Still needs ffmpeg binary |
| Buffer concat | No deps | Only works for raw PCM |
| Web Audio API | Browser native | Not Node.js |

**Recommendation:** Use ffmpeg - it's the standard, handles mp3/opus/aac properly.

```bash
# Concat approach
ffmpeg -f concat -safe 0 -i filelist.txt -c copy output.mp3
```

```typescript
// filelist.txt format
file '/tmp/chunk-0.mp3'
file '/tmp/chunk-1.mp3'
file '/tmp/chunk-2.mp3'
```

**Alternative:** Request `pcm` format from OpenAI (raw audio), concat buffers directly, then encode final output. More control but more work.

## 3. File Parsing

| Format | Library | Notes |
|--------|---------|-------|
| PDF | `pdf-parse` | Text extraction, loses formatting |
| DOCX | `mammoth` | Clean text output |
| EPUB | `epub2` | Chapter-aware extraction |
| HTML | `cheerio` | Strip tags, keep text |
| TXT/MD | native `fs` | Direct read |

```typescript
interface ParsedDocument {
    text: string;
    metadata?: {
        title?: string;
        author?: string;
        chapters?: string[];
    };
}

async function parseFile(filePath: string): Promise<ParsedDocument>
```

## 4. Processing Pipeline

```typescript
interface ProcessingOptions {
    voice: Voice;
    speed: number;
    instructions?: string;
    format: 'mp3' | 'opus' | 'aac';
    onProgress?: (current: number, total: number) => void;
}

async function processLongText(
    text: string,
    options: ProcessingOptions
): Promise<Buffer> {
    const chunks = chunkText(text);
    const audioChunks: Buffer[] = [];

    for (let i = 0; i < chunks.length; i++) {
        options.onProgress?.(i + 1, chunks.length);
        const audio = await generateSpeech(chunks[i].text, ...);
        audioChunks.push(audio);
    }

    return concatenateAudio(audioChunks, options.format);
}
```

## 5. Telegram Integration

**New commands:**
- `/file` - Reply to a document to convert it
- No new command needed for long text - just handle automatically

**Progress feedback:**
```
Processing... (chunk 3/12)
```

**File size limits:**
- Telegram voice messages: 50MB max
- Telegram documents: 50MB (or 2GB for bots with local API)
- Practical limit: ~30 min audio ≈ 30MB mp3

## 6. Implementation Order

### Phase 1: Long text support
- Refactor `generateSpeech` to use chunking internally
- Add audio concatenation with ffmpeg
- Progress callback in core.ts
- Update bot handlers to show progress

### Phase 2: File support
- Add file parsing (start with TXT, PDF)
- Add `/file` command or handle document messages
- Add more formats (DOCX, EPUB, HTML)

### Phase 3: Optimizations
- Parallel chunk processing (respect rate limits)
- Caching for repeated requests
- Streaming response (send audio as it's ready)

## 7. Dependencies to Add

```json
{
    "pdf-parse": "^1.1.1",
    "mammoth": "^1.6.0",
    "epub2": "^3.0.2",
    "cheerio": "^1.0.0",
    "fluent-ffmpeg": "^2.1.2"
}
```

**System requirement:** ffmpeg installed
- macOS: `brew install ffmpeg`
- Ubuntu: `apt install ffmpeg`
- Check: `ffmpeg -version`

## 8. Error Handling

- **Chunk fails:** Retry 3x with backoff, then skip with warning
- **Concat fails:** Return partial audio with error message
- **File parse fails:** Return specific error per format
- **Too long (>1hr audio):** Reject with limit message

## 9. Edge Cases

- Empty file → "File appears empty"
- Binary file misidentified → Check magic bytes
- Scanned PDF (images) → "PDF contains images, not text"
- Very long text (book-length) → Warn about processing time

## 10. Rate Limits

OpenAI TTS rate limits (as of 2024):
- Tier 1: 50 RPM
- Tier 2: 100 RPM
- Tier 3+: higher

For a 10-chunk request at 50 RPM, sequential is fine (~12 seconds).
For 50+ chunks, consider:
- Parallel with semaphore (e.g., 5 concurrent)
- Progress updates per completion
- Graceful degradation if rate limited

## Next Session

Start with **Phase 1**:
1. Move `splitTextIntoChunks` to a shared util or keep in openaiService
2. Modify `generateSpeech` to accept long text, chunk internally
3. Add ffmpeg concat function
4. Wire up progress callback to Telegram "Processing (3/12)..."
5. Test with 10K+ character text
