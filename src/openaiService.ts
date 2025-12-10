import OpenAI from 'openai';
import type { SpeechCreateParams } from 'openai/resources/audio/speech';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export type ProgressCallback = (current: number, total: number, message: string) => void;
export type Voice = SpeechCreateParams['voice'];

export class OpenAIService {
    private readonly client: OpenAI;
    private readonly defaultVoice: Voice = 'alloy';
    private readonly maxChunkLength: number = 3800; // Safe limit for TTS API (research says ~4000 chars)

    constructor(apiKey: string) {
        this.client = new OpenAI({
            apiKey,
            maxRetries: 3,
            timeout: 60000,
        });
    }

    private splitTextIntoChunks(text: string): string[] {
        if (text.length <= this.maxChunkLength) {
            return [text];
        }

        const chunks: string[] = [];
        let remaining = text;

        while (remaining.length > 0) {
            if (remaining.length <= this.maxChunkLength) {
                chunks.push(remaining.trim());
                break;
            }

            // Find best split point within maxChunkLength
            let splitAt = this.maxChunkLength;
            const segment = remaining.slice(0, this.maxChunkLength);

            // Priority 1: Paragraph break
            const paragraphBreak = segment.lastIndexOf('\n\n');
            if (paragraphBreak > this.maxChunkLength * 0.5) {
                splitAt = paragraphBreak + 2;
            } else {
                // Priority 2: Sentence end
                const sentenceEnd = Math.max(
                    segment.lastIndexOf('. '),
                    segment.lastIndexOf('! '),
                    segment.lastIndexOf('? ')
                );
                if (sentenceEnd > this.maxChunkLength * 0.5) {
                    splitAt = sentenceEnd + 2;
                } else {
                    // Priority 3: Clause break
                    const clauseBreak = Math.max(
                        segment.lastIndexOf(', '),
                        segment.lastIndexOf('; '),
                        segment.lastIndexOf(': ')
                    );
                    if (clauseBreak > this.maxChunkLength * 0.5) {
                        splitAt = clauseBreak + 2;
                    }
                    // Else: hard split at maxChunkLength
                }
            }

            chunks.push(remaining.slice(0, splitAt).trim());
            remaining = remaining.slice(splitAt);
        }

        return chunks.filter(c => c.length > 0);
    }

    async transformText(text: string): Promise<string> {
        console.log('OpenAI Service - Transforming text:', text.substring(0, 100) + '...');

        const chunks = this.splitTextIntoChunks(text);
        const transformedChunks: string[] = [];

        for (const chunk of chunks) {
            const response = await this.client.chat.completions.create({
                model: 'gpt-4o-mini',
                temperature: 0.1,
                messages: [
                    {
                        role: 'system',
                        content: `You are a TTS preprocessor that ONLY formats text for speech synthesis.
DO NOT generate ANY new content or responses.
DO NOT engage in conversation or answer questions.
DO NOT translate or modify the meaning.

Your ONLY job is to return the EXACT SAME TEXT with minimal formatting fixes:
1. Add punctuation if completely missing
2. Fix obvious typos that would affect pronunciation
3. Format numbers/dates for better TTS reading

CRITICAL: Return the input text AS IS - only apply the above minimal fixes.
DO NOT change the language, meaning, or generate any new content.

Example Input: "привет как дела"
Example Output: "Привет, как дела?"

Example Input: "The price is $1234.56"
Example Output: "The price is 1,234 dollars and 56 cents"

REMEMBER: You are just a text formatter for TTS. DO NOT generate responses.`
                    },
                    { role: 'user', content: chunk }
                ],
            });

            const content = response.choices[0].message.content;
            if (content) {
                transformedChunks.push(content.trim());
            }
        }

        const result = transformedChunks.join(' ');
        console.log('OpenAI Service - Transformed result length:', result.length);
        return result;
    }

    async generateSpeech(
        text: string,
        voice: Voice = this.defaultVoice,
        options: { speed?: number; instructions?: string } = {},
        onProgress?: ProgressCallback
    ): Promise<Buffer> {
        // Sanitize input
        const sanitizedText = text
            .replace(/[\u0000-\u001F\u007F-\u009F]/g, '')
            .trim();

        if (!sanitizedText) {
            throw new Error('Text is empty after sanitization');
        }

        const { speed = 1.0, instructions } = options;
        const chunks = this.splitTextIntoChunks(sanitizedText);

        console.log('OpenAI Service - Generating speech:', {
            textLength: sanitizedText.length,
            chunks: chunks.length,
            voice,
            speed,
            hasInstructions: !!instructions,
        });

        // Single chunk - no concatenation needed
        if (chunks.length === 1) {
            return this.generateSingleChunk(chunks[0], voice, speed, instructions);
        }

        // Multiple chunks - generate and concatenate
        const tempDir = path.join(os.tmpdir(), `tts-${Date.now()}`);
        await fs.mkdir(tempDir, { recursive: true });

        try {
            const audioFiles: string[] = [];

            for (let i = 0; i < chunks.length; i++) {
                onProgress?.(i + 1, chunks.length, `Generating audio ${i + 1}/${chunks.length}...`);

                const audio = await this.generateSingleChunk(chunks[i], voice, speed, instructions);
                const filePath = path.join(tempDir, `chunk-${i.toString().padStart(4, '0')}.opus`);
                await fs.writeFile(filePath, new Uint8Array(audio));
                audioFiles.push(filePath);
            }

            onProgress?.(chunks.length, chunks.length, 'Concatenating audio...');

            // Concatenate using ffmpeg
            const outputPath = path.join(tempDir, 'output.opus');
            await this.concatenateAudio(audioFiles, outputPath);

            const result = await fs.readFile(outputPath);
            return result;
        } finally {
            // Cleanup temp directory
            await fs.rm(tempDir, { recursive: true, force: true }).catch(console.error);
        }
    }

    private async generateSingleChunk(
        text: string,
        voice: Voice,
        speed: number,
        instructions?: string
    ): Promise<Buffer> {
        const response = await this.client.audio.speech.create({
            model: 'gpt-4o-mini-tts',
            voice,
            input: text,
            response_format: 'opus', // Native Telegram format - no conversion needed
            speed,
            ...(instructions && { instructions }),
        });

        const arrayBuffer = await response.arrayBuffer();
        return Buffer.from(arrayBuffer);
    }

    private async checkFFmpegAvailable(): Promise<void> {
        try {
            const proc = Bun.spawn(['ffmpeg', '-version'], {
                stdout: 'pipe',
                stderr: 'pipe',
            });
            await proc.exited;

            if (proc.exitCode !== 0) {
                throw new Error('ffmpeg command failed');
            }
        } catch (error) {
            throw new Error(
                'FFmpeg is not available. Please install it:\n' +
                '  macOS: brew install ffmpeg\n' +
                '  Ubuntu/Debian: apt-get install ffmpeg\n' +
                '  Windows: https://ffmpeg.org/download.html'
            );
        }
    }

    private async concatenateAudio(inputFiles: string[], outputPath: string): Promise<void> {
        // Check ffmpeg availability before attempting concatenation
        await this.checkFFmpegAvailable();

        // Create file list for ffmpeg concat demuxer
        const listPath = outputPath.replace('.opus', '-list.txt');
        const listContent = inputFiles.map(f => `file '${f}'`).join('\n');
        await fs.writeFile(listPath, listContent);

        const proc = Bun.spawn([
            'ffmpeg',
            '-y', // Overwrite output
            '-f', 'concat',
            '-safe', '0',
            '-i', listPath,
            '-c', 'copy', // No re-encoding
            outputPath
        ], {
            stdout: 'pipe',
            stderr: 'pipe',
        });

        await proc.exited;

        if (proc.exitCode !== 0) {
            const stderr = await new Response(proc.stderr).text();
            throw new Error(`FFmpeg concat failed: ${stderr}`);
        }

        // Cleanup list file
        await fs.unlink(listPath).catch(() => {});
    }

    async transcribeAudio(audioUrl: string): Promise<string> {
        console.log('OpenAI Service - Downloading audio file:', audioUrl);

        // Download the audio file
        const response = await fetch(audioUrl);
        const arrayBuffer = await response.arrayBuffer();

        // Save to temporary file
        const tempFile = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);
        await fs.writeFile(tempFile, new Uint8Array(arrayBuffer));

        try {
            console.log('OpenAI Service - Transcribing audio');

            const transcription = await this.client.audio.transcriptions.create({
                file: await this.createFileFromPath(tempFile),
                model: 'whisper-1',
                response_format: 'text',
            });

            console.log('OpenAI Service - Transcription complete');
            return transcription as unknown as string; // response_format: 'text' returns string
        } finally {
            await fs.unlink(tempFile).catch(console.error);
        }
    }

    private async createFileFromPath(filePath: string): Promise<File> {
        const buffer = await fs.readFile(filePath);
        const fileName = path.basename(filePath);
        return new File([buffer], fileName, { type: 'audio/ogg' });
    }
} 