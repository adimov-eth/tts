// Mock OpenAI TTS responses
export const mockTTSResponse = new ArrayBuffer(1000);  // Fake audio

export function createMockOpenAI() {
  return {
    audio: {
      speech: {
        create: vi.fn().mockResolvedValue({
          arrayBuffer: () => Promise.resolve(mockTTSResponse),
        }),
      },
      transcriptions: {
        create: vi.fn().mockResolvedValue({
          text: 'This is transcribed text',
        }),
      },
    },
  };
}
