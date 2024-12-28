import axios, { AxiosError } from 'axios';

export class ElevenLabsService {
    private readonly apiKey: string;
    private readonly defaultVoiceId: string = 'EXAVITQu4vr4xnSDxMaL'; // Default voice ID (Josh)

    constructor(apiKey: string) {
        this.apiKey = apiKey;
    }

    async generateSpeech(text: string, voiceId: string = this.defaultVoiceId): Promise<Buffer> {
        try {
            console.log('ElevenLabs Service - Generating speech:', {
                text,
                voiceId,
                textLength: text.length
            });

            const response = await axios.post(
                `https://api.elevenlabs.io/v1/text-to-speech/${voiceId}`,
                {
                    text,
                    model_id: 'eleven_monolingual_v1',
                    voice_settings: {
                        stability: 0.5,
                        similarity_boost: 0.5
                    }
                },
                {
                    headers: {
                        'xi-api-key': this.apiKey,
                        'Content-Type': 'application/json',
                    },
                    responseType: 'arraybuffer',
                }
            );

            console.log('ElevenLabs Service - Response headers:', response.headers);
            console.log('ElevenLabs Service - Response size:', response.data.length);

            return Buffer.from(response.data);
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error;
                console.error('ElevenLabs Service - API Error:', {
                    status: axiosError.response?.status,
                    statusText: axiosError.response?.statusText,
                    data: this.parseErrorResponse(axiosError.response?.data),
                    headers: axiosError.response?.headers
                });

                // Handle specific error cases
                if (axiosError.response?.status === 401) {
                    const errorData = this.parseErrorResponse(axiosError.response.data);
                    if (errorData?.detail?.status === 'detected_unusual_activity') {
                        throw new Error('ElevenLabs API blocked due to VPN/proxy usage. Please try again later or contact support.');
                    }
                    throw new Error('ElevenLabs API authentication failed. Please check your API key.');
                }
                
                if (axiosError.response?.status === 429) {
                    throw new Error('ElevenLabs API rate limit exceeded. Please try again later.');
                }

                throw new Error(`ElevenLabs API error: ${axiosError.response?.statusText || 'Unknown error'}`);
            } else {
                console.error('ElevenLabs Service - Unknown Error:', error);
                throw new Error('Failed to generate speech with ElevenLabs: Unknown error');
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

    async getVoices(): Promise<any> {
        try {
            console.log('ElevenLabs Service - Fetching voices');
            const response = await axios.get('https://api.elevenlabs.io/v1/voices', {
                headers: {
                    'xi-api-key': this.apiKey,
                }
            });
            console.log('ElevenLabs Service - Available voices:', response.data.voices.length);
            return response.data;
        } catch (error) {
            if (axios.isAxiosError(error)) {
                const axiosError = error as AxiosError;
                console.error('ElevenLabs Service - API Error:', {
                    status: axiosError.response?.status,
                    statusText: axiosError.response?.statusText,
                    data: axiosError.response?.data,
                    headers: axiosError.response?.headers
                });
            } else {
                console.error('ElevenLabs Service - Unknown Error:', error);
            }
            throw new Error('Failed to fetch voices from ElevenLabs');
        }
    }
} 