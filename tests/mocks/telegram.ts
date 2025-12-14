// Mock Grammy bot API
export function createMockBotApi() {
  return {
    sendMessage: vi.fn().mockResolvedValue({ message_id: 1 }),
    sendVoice: vi.fn().mockResolvedValue({ message_id: 2 }),
    editMessageText: vi.fn().mockResolvedValue(true),
    deleteMessage: vi.fn().mockResolvedValue(true),
    getFile: vi.fn().mockResolvedValue({ file_path: 'test/path.ogg' }),
  };
}
