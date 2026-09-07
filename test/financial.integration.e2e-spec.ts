import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'crypto';
import { createClient } from 'redis';
import { FinancialDatabase } from '../src/modules/financial/financial.database';
import { FinancialService } from '../src/modules/financial/financial.service';
import { FinancialOutboxService } from '../src/modules/financial/financial-outbox.service';

describe('financial PostgreSQL integration', () => {
  const databaseUrl = process.env.FINANCIAL_DATABASE_URL;
  const redisUrl = process.env.REDIS_URL;
  if (!databaseUrl || !redisUrl)
    throw new Error(
      'FINANCIAL_DATABASE_URL and REDIS_URL are required; financial integration tests cannot be skipped',
    );
  const config = {
    get: <T>(key: string): T | undefined =>
      (
        ({
          FINANCIAL_DATABASE_URL: databaseUrl,
          REDIS_URL: redisUrl,
        }) as Record<string, unknown>
      )[key] as T | undefined,
  } as ConfigService;
  const database = new FinancialDatabase(config);
  const financial = new FinancialService(database);
  const outbox = new FinancialOutboxService(database, config);
  const redis = createClient({ url: redisUrl });

  beforeAll(async () => {
    await redis.connect();
    expect(await redis.ping()).toBe('PONG');
    await financial.initializeSchema();
    await financial.initializeSchema();
    await database.query(
      'TRUNCATE financial_outbox, financial_inbox, financial_postings, financial_journals, financial_payment_intents, financial_reconciliations CASCADE',
    );
  });

  afterAll(async () => {
    await outbox.onModuleDestroy();
    if (redis.isOpen) await redis.quit();
  });

  it('enforces idempotency, balanced immutable postings, inbox deduplication and capture allocation', async () => {
    const correlationId = randomUUID();
    const intent = await financial.createPaymentIntent({
      projectId: 'project-1',
      contributorId: 'user-1',
      amountMinor: 10_000n,
      currency: 'UGX',
      idempotencyKey: 'intent-1',
      correlationId,
    });
    const replay = await financial.createPaymentIntent({
      projectId: 'project-1',
      contributorId: 'user-1',
      amountMinor: 10_000n,
      currency: 'UGX',
      idempotencyKey: 'intent-1',
      correlationId,
    });
    expect(replay).toMatchObject({ id: intent.id, replayed: true });
    await expect(
      financial.createPaymentIntent({
        projectId: 'project-1',
        contributorId: 'user-1',
        amountMinor: 10_001n,
        milestoneId: 'milestone-1',
        currency: 'UGX',
        idempotencyKey: 'intent-1',
        correlationId,
      }),
    ).rejects.toThrow('different payment intent');
    expect(
      await financial.acceptProviderEvent({
        provider: 'test-provider',
        providerEventId: 'event-1',
        eventType: 'captured',
        paymentIntentId: intent.id,
        amountMinor: 10_000n,
        currency: 'UGX',
        providerFeeMinor: 300n,
        receivedAt: new Date(),
      }),
    ).toEqual({ accepted: true });
    expect(
      await financial.acceptProviderEvent({
        provider: 'test-provider',
        providerEventId: 'event-1',
        eventType: 'captured',
        paymentIntentId: intent.id,
        amountMinor: 10_000n,
        currency: 'UGX',
        providerFeeMinor: 300n,
        receivedAt: new Date(),
      }),
    ).toEqual({ accepted: false });
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: true,
    });
    const balance = await database.query<{ balance: string }>(
      'SELECT SUM(debit_minor - credit_minor)::text AS balance FROM financial_postings WHERE currency = $1',
      ['UGX'],
    );
    expect(balance.rows[0].balance).toBe('0');
    const escrow = await database.query<{ credit: string }>(
      "SELECT SUM(credit_minor)::text AS credit FROM financial_postings WHERE account = 'liability:campaign_escrow:project-1:UGX'",
    );
    expect(escrow.rows[0].credit).toBe('9700');
    expect(await outbox.publishNext()).toEqual({ published: true });
    const stream = await redis.xRange('keibo:financial-events', '-', '+');
    expect(stream.some((entry) => entry.message.outboxId)).toBe(true);
    await expect(
      database.query('UPDATE financial_postings SET credit_minor = 1'),
    ).rejects.toThrow('immutable');
  });

  it('retries out-of-order evidence, conserves each currency, settles, refunds, and separates fees', async () => {
    const intent = await financial.createPaymentIntent({
      projectId: 'project-ordering',
      contributorId: 'user-ordering',
      amountMinor: 25_000n,
      currency: 'USD',
      idempotencyKey: 'intent-ordering',
      correlationId: randomUUID(),
    });
    const event = (
      providerEventId: string,
      eventType: 'captured' | 'settled' | 'refunded',
    ) => ({
      provider: 'test-provider',
      providerEventId,
      eventType,
      paymentIntentId: intent.id,
      amountMinor: 25_000n,
      currency: 'USD',
      providerFeeMinor: 500n,
      receivedAt: new Date(),
    });

    await financial.acceptProviderEvent(
      event('settlement-before-capture', 'settled'),
    );
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: false,
      deadLettered: false,
    });
    const retry = await database.query<{
      attempts: number;
      last_error: string;
    }>(
      "SELECT attempts, last_error FROM financial_inbox WHERE provider_event_id = 'settlement-before-capture'",
    );
    expect(retry.rows[0]).toMatchObject({ attempts: 1 });
    expect(retry.rows[0].last_error).toContain(
      'Cannot settle payment from pending',
    );

    await financial.acceptProviderEvent(
      event('capture-after-settlement', 'captured'),
    );
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: true,
    });
    await database.query(
      "UPDATE financial_inbox SET next_attempt_at = now() WHERE provider_event_id = 'settlement-before-capture'",
    );
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: true,
    });
    await financial.acceptProviderEvent(
      event('refund-after-settlement', 'refunded'),
    );
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: true,
    });

    const state = await database.query<{ state: string }>(
      'SELECT state FROM financial_payment_intents WHERE id = $1',
      [intent.id],
    );
    expect(state.rows[0].state).toBe('refunded');
    const conservation = await database.query<{
      currency: string;
      balance: string;
    }>(
      `SELECT currency, SUM(debit_minor - credit_minor)::text AS balance
       FROM financial_postings GROUP BY currency ORDER BY currency`,
    );
    expect(conservation.rows).toEqual(
      expect.arrayContaining([
        { currency: 'UGX', balance: '0' },
        { currency: 'USD', balance: '0' },
      ]),
    );
    const providerCost = await database.query<{ balance: string }>(
      `SELECT COALESCE(SUM(credit_minor - debit_minor), 0)::text AS balance
       FROM financial_postings WHERE account = 'liability:provider_cost:test-provider:USD'`,
    );
    expect(providerCost.rows[0].balance).toBe('0');
  });

  it('applies the exact five percent success fee and prevents concurrent escrow overdraft', async () => {
    const correlationId = randomUUID();
    const intent = await financial.createPaymentIntent({
      projectId: 'project-release',
      contributorId: 'user-release',
      amountMinor: 10_001n,
      currency: 'EUR',
      idempotencyKey: 'intent-release',
      correlationId,
    });
    await financial.acceptProviderEvent({
      provider: 'test-provider',
      providerEventId: 'capture-release',
      eventType: 'captured',
      paymentIntentId: intent.id,
      amountMinor: 10_001n,
      currency: 'EUR',
      providerFeeMinor: 0n,
      receivedAt: new Date(),
    });
    expect(await financial.processNextInboxEvent()).toEqual({
      processed: true,
    });

    const releases = await Promise.allSettled([
      financial.releaseCampaignFunds({
        projectId: 'project-release',
        currency: 'EUR',
        amountMinor: 10_001n,
        milestoneId: 'milestone-2',
        approvalReference: 'milestone-release-1',
        correlationId,
      }),
      financial.releaseCampaignFunds({
        projectId: 'project-release',
        currency: 'EUR',
        amountMinor: 10_001n,
        approvalReference: 'milestone-release-2',
        correlationId,
      }),
    ]);
    expect(
      releases.filter((result) => result.status === 'fulfilled'),
    ).toHaveLength(1);
    expect(
      releases.filter((result) => result.status === 'rejected'),
    ).toHaveLength(1);
    const fee = await database.query<{ credit: string }>(
      `SELECT SUM(credit_minor)::text AS credit
       FROM financial_postings WHERE account = 'revenue:campaign_success_fee:EUR'`,
    );
    expect(fee.rows[0].credit).toBe('500');
  });

  it('records explained reconciliation variances and denies cross-user intent reads', async () => {
    const reconciliation = await financial.reconcile({
      provider: 'test-provider',
      currency: 'USD',
      providerTotalMinor: '10',
      evidenceReference: 'statement:test:usd:1',
    });
    expect(reconciliation.differenceMinor).toBe('10');
    await expect(
      financial.getPaymentIntent(
        '00000000-0000-0000-0000-000000000000',
        'other-user',
      ),
    ).rejects.toThrow('Payment intent not found');
  });

  it('rolls back invalid journals and recovers, retries, then dead-letters outbox delivery', async () => {
    await expect(
      financial.postJournal({
        idempotencyKey: 'invalid-unbalanced-journal',
        correlationId: randomUUID(),
        description: 'must rollback',
        lines: [
          { account: 'asset:test:KES', debitMinor: 10n, creditMinor: 0n },
          { account: 'liability:test:KES', debitMinor: 0n, creditMinor: 9n },
        ],
      }),
    ).rejects.toThrow('balance');
    const absent = await database.query<{ count: string }>(
      "SELECT COUNT(*)::text AS count FROM financial_journals WHERE idempotency_key = 'invalid-unbalanced-journal'",
    );
    expect(absent.rows[0].count).toBe('0');

    await database.query("UPDATE financial_outbox SET status = 'published'");
    await database.query(
      `INSERT INTO financial_outbox (topic, aggregate_id, payload, correlation_id, status, attempts)
       VALUES ('test.delivery', 'test-aggregate', '{}'::jsonb, $1, 'pending', 5)`,
      [randomUUID()],
    );
    const unavailableConfig = {
      get: (key: string) =>
        key === 'REDIS_URL' ? 'redis://127.0.0.1:1' : undefined,
    } as ConfigService;
    const unavailableOutbox = new FinancialOutboxService(
      database,
      unavailableConfig,
    );
    expect(await unavailableOutbox.publishNext()).toEqual({
      published: false,
      deadLettered: true,
    });
    await unavailableOutbox.onModuleDestroy();

    await database.query(
      `INSERT INTO financial_outbox
       (topic, aggregate_id, payload, correlation_id, status, locked_at)
       VALUES ('test.recovery', 'test-aggregate', '{}'::jsonb, $1, 'processing', now() - interval '10 minutes')`,
      [randomUUID()],
    );
    expect(await outbox.recoverStaleProcessing()).toBeGreaterThanOrEqual(1);
  });
});
