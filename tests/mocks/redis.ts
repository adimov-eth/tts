import RedisMock from 'ioredis-mock';

let mockRedis: RedisMock | null = null;

export function getMockRedis() {
  if (!mockRedis) {
    mockRedis = new RedisMock();
  }
  return mockRedis;
}

export function resetMockRedis() {
  if (mockRedis) {
    mockRedis.flushall();
  }
}
