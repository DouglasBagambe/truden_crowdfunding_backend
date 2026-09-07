import { ConfigService } from '@nestjs/config';
import { ServiceUnavailableException } from '@nestjs/common';
import { RateLimitService } from './rate-limit.service';

const configFor = (environment: string) =>
  ({
    get: jest.fn((name: string) =>
      name === 'NODE_ENV' ? environment : undefined,
    ),
  }) as unknown as ConfigService;

describe('RateLimitService', () => {
  it('allows requests up to the in-memory development limit and then locks out', async () => {
    const service = new RateLimitService(configFor('test'));
    expect(
      (await service.consume('login', 'identity', 2, 60_000)).allowed,
    ).toBe(true);
    expect(
      (await service.consume('login', 'identity', 2, 60_000)).allowed,
    ).toBe(true);
    const blocked = await service.consume('login', 'identity', 2, 60_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBeGreaterThan(0);
  });

  it('fails closed in production without a ready distributed store', async () => {
    const service = new RateLimitService(configFor('production'));
    await expect(
      service.consume('login', 'identity', 2, 60_000),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('rejects production startup when the distributed store is not configured', async () => {
    const service = new RateLimitService(configFor('production'));
    await expect(service.onModuleInit()).rejects.toThrow('REDIS_URL');
  });
});
