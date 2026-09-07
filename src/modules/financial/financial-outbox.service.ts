import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import { FinancialDatabase } from './financial.database';

const MAX_ATTEMPTS = 6;
const RETRY_SECONDS = [5, 30, 120, 600, 3600, 21_600];

@Injectable()
export class FinancialOutboxService implements OnModuleDestroy {
  private redis?: RedisClientType;

  constructor(
    private readonly database: FinancialDatabase,
    private readonly config: ConfigService,
  ) {}

  async publishNext(): Promise<{
    published: boolean;
    deadLettered?: boolean;
  }> {
    const item = await this.database.transaction(async (client) => {
      const selected = await client.query<{
        id: string;
        topic: string;
        aggregate_id: string;
        payload: Record<string, unknown>;
        correlation_id: string;
        attempts: number;
      }>(
        `SELECT id, topic, aggregate_id, payload, correlation_id, attempts
         FROM financial_outbox
         WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY created_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!selected.rowCount) return undefined;
      const row = selected.rows[0];
      await client.query(
        `UPDATE financial_outbox SET status = 'processing', attempts = attempts + 1,
         locked_at = now() WHERE id = $1`,
        [row.id],
      );
      return { ...row, attempts: row.attempts + 1 };
    });
    if (!item) return { published: false };

    try {
      const redis = await this.getRedis();
      await redis.xAdd('keibo:financial-events', '*', {
        outboxId: item.id,
        topic: item.topic,
        aggregateId: item.aggregate_id,
        correlationId: item.correlation_id,
        payload: JSON.stringify(item.payload),
      });
      await this.database.query(
        `UPDATE financial_outbox SET status = 'published', published_at = now(),
         locked_at = NULL, last_error = NULL WHERE id = $1`,
        [item.id],
      );
      return { published: true };
    } catch (error) {
      const deadLettered = item.attempts >= MAX_ATTEMPTS;
      const retrySeconds =
        RETRY_SECONDS[Math.min(item.attempts - 1, RETRY_SECONDS.length - 1)];
      await this.database.query(
        `UPDATE financial_outbox SET status = $2, locked_at = NULL, last_error = $3,
         next_attempt_at = now() + ($4 * interval '1 second') WHERE id = $1`,
        [
          item.id,
          deadLettered ? 'dead_letter' : 'pending',
          error instanceof Error
            ? error.message.slice(0, 500)
            : 'Redis publish failed',
          retrySeconds,
        ],
      );
      return { published: false, deadLettered };
    }
  }

  async recoverStaleProcessing(): Promise<number> {
    const result = await this.database.query(
      `UPDATE financial_outbox SET status = 'pending', locked_at = NULL,
       next_attempt_at = now(), last_error = 'Recovered stale processing claim'
       WHERE status = 'processing' AND locked_at < now() - interval '5 minutes'`,
    );
    return result.rowCount ?? 0;
  }

  async readiness(): Promise<boolean> {
    try {
      return (await (await this.getRedis()).ping()) === 'PONG';
    } catch {
      return false;
    }
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) await this.redis.quit();
  }

  private async getRedis(): Promise<RedisClientType> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url) throw new Error('REDIS_URL is required for financial outbox');
    if (!this.redis) this.redis = createClient({ url });
    if (!this.redis.isOpen) await this.redis.connect();
    return this.redis;
  }
}
