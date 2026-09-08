import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, RedisClientType } from 'redis';

@Injectable()
export class RateLimitService implements OnModuleInit, OnModuleDestroy {
  private client?: RedisClientType;
  private readonly memory = new Map<
    string,
    { count: number; expiresAt: number }
  >();

  constructor(private readonly configService: ConfigService) {}

  async onModuleInit(): Promise<void> {
    const redisUrl = this.configService.get<string>('REDIS_URL')?.trim();
const requireRedis =
  this.configService.get<string>('RATE_LIMIT_STORE') === 'redis';

    if (!requireRedis) return;
    if (!redisUrl) {
      throw new Error('REDIS_URL is required for distributed rate limiting');
    }

    this.client = createClient({ url: redisUrl });
    this.client.on('error', () => undefined);
    try {
      await this.client.connect();
      await this.client.ping();
    } catch {
      throw new Error('Redis rate-limit infrastructure is unavailable');
    }
  }

  async consume(
    scope: string,
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ allowed: boolean; retryAfterSeconds: number }> {
    const redisKey = `keibo:rate:${scope}:${key}`;
    if (this.client?.isReady) {
      try {
        const result = (await this.client.eval(
          "local current = redis.call('INCR', KEYS[1]); if current == 1 then redis.call('PEXPIRE', KEYS[1], ARGV[1]); end; local ttl = redis.call('PTTL', KEYS[1]); return {current, ttl}",
          { keys: [redisKey], arguments: [String(windowMs)] },
        )) as [number, number];
        return {
          allowed: Number(result[0]) <= limit,
          retryAfterSeconds: Math.max(1, Math.ceil(Number(result[1]) / 1000)),
        };
      } catch {
        throw new ServiceUnavailableException(
          'Request protection infrastructure is unavailable',
        );
      }
    }

    const now = Date.now();
    const current = this.memory.get(redisKey);
    if (!current || current.expiresAt <= now) {
      this.memory.set(redisKey, { count: 1, expiresAt: now + windowMs });
      return { allowed: true, retryAfterSeconds: Math.ceil(windowMs / 1000) };
    }
    current.count += 1;
    return {
      allowed: current.count <= limit,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((current.expiresAt - now) / 1000),
      ),
    };
  }

  async onModuleDestroy(): Promise<void> {
    if (this.client?.isOpen) await this.client.quit();
  }
}
