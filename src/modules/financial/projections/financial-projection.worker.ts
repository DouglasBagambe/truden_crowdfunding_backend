import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createClient, type RedisClientType } from 'redis';
import { FinancialProjectionService } from './financial-projection.service';

@Injectable()
export class FinancialProjectionWorker implements OnModuleDestroy {
  private redis?: RedisClientType;

  constructor(
    private readonly projections: FinancialProjectionService,
    private readonly config: ConfigService,
  ) {}

  async processOne(consumer = 'projection-worker'): Promise<boolean> {
    const redis = await this.getRedis();
    try {
      await redis.xGroupCreate(
        'keibo:financial-events',
        'mongo-projections',
        '0',
        { MKSTREAM: true },
      );
    } catch (error) {
      if (!String(error).includes('BUSYGROUP')) throw error;
    }
    const entries = (await redis.xReadGroup(
      'mongo-projections',
      consumer,
      { key: 'keibo:financial-events', id: '>' },
      { COUNT: 1, BLOCK: 1 },
    )) as unknown as Array<{
      messages: Array<{ id: string; message: Record<string, string> }>;
    }> | null;
    const entry = entries?.[0]?.messages[0];
    if (!entry) return false;
    const message = entry.message;
    const payload = JSON.parse(message.payload) as Record<string, string>;
    const projectionKinds: Record<
      string,
      {
        kind: 'payment' | 'allocation' | 'milestone' | 'refund';
        state: string;
      }
    > = {
      'payment.captured': { kind: 'payment', state: 'captured' },
      'campaign.allocated': { kind: 'allocation', state: 'allocated' },
      'payment.settled': { kind: 'payment', state: 'settled' },
      'payment.refunded': { kind: 'refund', state: 'refunded' },
      'payment.reversed': { kind: 'refund', state: 'reversed' },
      'campaign.released': { kind: 'milestone', state: 'released' },
    };
    const projection = projectionKinds[message.topic];
    if (projection) {
      await this.projections.apply({
        eventId: message.outboxId,
        campaignId: payload.projectId,
        milestoneId: payload.milestoneId,
        kind: projection.kind,
        state: projection.state,
        amountMinor: payload.amountMinor,
        currency: payload.currency,
        ledgerJournalId: payload.ledgerJournalId,
        reconciliationReference: payload.reconciliationReference,
      });
    }
    await redis.xAck('keibo:financial-events', 'mongo-projections', entry.id);
    return true;
  }

  async onModuleDestroy(): Promise<void> {
    if (this.redis?.isOpen) await this.redis.quit();
  }

  private async getRedis(): Promise<RedisClientType> {
    const url = this.config.get<string>('REDIS_URL');
    if (!url)
      throw new Error('REDIS_URL is required for financial projections');
    if (!this.redis) this.redis = createClient({ url });
    if (!this.redis.isOpen) await this.redis.connect();
    return this.redis;
  }
}
