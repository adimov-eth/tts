import axios, { AxiosError } from 'axios';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as os from 'os';

export class OpenAIService {
    private readonly apiKey: string;
    private readonly defaultVoice: string = 'alloy';
    private readonly maxChunkLength: number = 4000; // Maximum safe length for API processing

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    private splitTextIntoChunks(text: string): string[] {
        const chunks: string[] = [];
        let currentChunk = '';
        
        // Split by sentences (basic implementation)
        const sentences = text.split(/(?<=[.!?])\s+/);
        
        for (const sentence of sentences) {
            if ((currentChunk + sentence).length > this.maxChunkLength) {
                if (currentChunk) {
                    chunks.push(currentChunk.trim());
                    currentChunk = '';
                }
                // If a single sentence is too long, split it by commas
                if (sentence.length > this.maxChunkLength) {
                    const subParts = sentence.split(/(?<=,)\s+/);
                    for (const part of subParts) {
                        if (part.length > this.maxChunkLength) {
                            // If still too long, split into fixed-size chunks
                            for (let i = 0; i < part.length; i += this.maxChunkLength) {
                                chunks.push(part.slice(i, i + this.maxChunkLength).trim());
                            }
                        } else {
                            chunks.push(part.trim());
                        }
                    }
                } else {
                    currentChunk = sentence;
                }
            } else {
                currentChunk += (currentChunk ? ' ' : '') + sentence;
            }
        }
        
        if (currentChunk) {
            chunks.push(currentChunk.trim());
        }
        
        return chunks;
    }

    async transformText(text: string): Promise<string> {
        try {
            console.log('OpenAI Service - Transforming text:', text);
            
            // Split text into manageable chunks
            const chunks = this.splitTextIntoChunks(text);
            const transformedChunks: string[] = [];
            
            // Process each chunk
            for (const chunk of chunks) {
                const response = await axios.post(
                    'https://api.openai.com/v1/chat/completions',
                    {
                        model: 'gpt-4',
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
(Only added basic punctuation, kept exact same text)

Example Input: "The price is $1234.56"
Example Output: "The price is 1,234 dollars and 56 cents"
(Only formatted numbers for better TTS reading)

REMEMBER: You are just a text formatter for TTS.
You are NOT a chatbot. DO NOT generate responses.`
                            },
                            {
                                role: 'user',
                                content: chunk
                            }
                        ],
                    },
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'application/json',
                        },
                    }
                );
                
                const transformedChunk = response.data.choices[0].message.content.trim();
                transformedChunks.push(transformedChunk);
            }
            
            // Combine transformed chunks
            const result = transformedChunks.join(' ');
            console.log('OpenAI Service - Transformed result:', result);
            return result;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('OpenAI Service - API Error:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    headers: error.response?.headers
                });
            } else {
                console.error('OpenAI Service - Unknown Error:', error);
            }
            throw new Error('Failed to transform text with OpenAI');
        }
    }

    async generateSpeech(text: string, voice: string = this.defaultVoice): Promise<Buffer> {
        try {
            console.log('OpenAI Service - Generating speech:', {
                text,
                voice,
                textLength: text.length
            });

            const response = await axios.post(
                'https://api.openai.com/v1/audio/speech',
                {
                    model: 'tts-1',
                    input: text,
                    voice: voice,
                },
                {
                    headers: {
                        'Authorization': `Bearer ${this.apiKey}`,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer',
                }
            );

            console.log('OpenAI Service - Response headers:', response.headers);
            console.log('OpenAI Service - Response size:', response.data.length);

            return Buffer.from(response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('OpenAI Service - TTS API Error:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: this.parseErrorResponse(error.response?.data),
                    headers: error.response?.headers
                });
                throw new Error(`OpenAI TTS API error: ${error.response?.statusText || 'Unknown error'}`);
            } else {
                console.error('OpenAI Service - Unknown TTS Error:', error);
                throw new Error('Failed to generate speech with OpenAI: Unknown error');
            }
        }
    }

    async transcribeAudio(audioUrl: string): Promise<string> {
        try {
            console.log('OpenAI Service - Downloading audio file:', audioUrl);
            
            // Download the audio file
            const audioResponse = await axios.get(audioUrl, {
                responseType: 'arraybuffer'
            });
            
            // Save to temporary file
            const tempFile = path.join(os.tmpdir(), `voice-${Date.now()}.ogg`);
            await fs.writeFile(tempFile, Buffer.from(audioResponse.data));

            try {
                console.log('OpenAI Service - Transcribing audio');
                
                // Create form data
                const formData = new FormData();
                formData.append('file', new Blob([await fs.readFile(tempFile)]), 'audio.ogg');
                formData.append('model', 'whisper-1');
                formData.append('response_format', 'text');

                // Send to OpenAI
                const response = await axios.post(
                    'https://api.openai.com/v1/audio/transcriptions',
                    formData,
                    {
                        headers: {
                            'Authorization': `Bearer ${this.apiKey}`,
                            'Content-Type': 'multipart/form-data',
                        },
                    }
                );

                console.log('OpenAI Service - Transcription complete');
                return response.data;
            } finally {
                // Clean up temp file
                await fs.unlink(tempFile).catch(console.error);
            }
        } catch (error) {
            if (axios.isAxiosError(error)) {
                console.error('OpenAI Service - Transcription API Error:', {
                    status: error.response?.status,
                    statusText: error.response?.statusText,
                    data: error.response?.data,
                    headers: error.response?.headers
                });
                throw new Error(`OpenAI Transcription API error: ${error.response?.statusText || 'Unknown error'}`);
            } else {
                console.error('OpenAI Service - Unknown Transcription Error:', error);
                throw new Error('Failed to transcribe audio with OpenAI: Unknown error');
            }
        }
    }

    private parseErrorResponse(data: any): any {
        if (data instanceof Buffer) {
            try {
                return JSON.parse(data.toString());
            } catch {
                return data.toString();
            }
        }
        return data;
    }
} 