import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import type { PoolClient } from 'pg';
import { FinancialDatabase } from './financial.database';
import { FINANCIAL_SCHEMA_SQL } from './financial.schema';
import type {
  LedgerLine,
  PaymentIntentInput,
  ProviderEvent,
} from './financial.types';
import {
  assertBalancedPosting,
  calculateCampaignSuccessFee,
} from './financial-ledger.util';

const RETRY_SCHEDULE_SECONDS = [60, 300, 1800, 7200, 86400];

function asMinor(value: string | number | bigint): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed <= 0n) throw new Error('non-positive');
    return parsed;
  } catch {
    throw new BadRequestException(
      'Amount must be a positive integer minor unit',
    );
  }
}

function asNonNegativeMinor(value: string | number | bigint): bigint {
  try {
    const parsed = BigInt(value);
    if (parsed < 0n) throw new Error('negative');
    return parsed;
  } catch {
    throw new BadRequestException(
      'Amount must be a non-negative integer minor unit',
    );
  }
}

function assertCurrency(currency: string): string {
  const normalized = currency.trim().toUpperCase();
  if (!/^[A-Z]{3}$/.test(normalized))
    throw new BadRequestException('Invalid currency');
  return normalized;
}

@Injectable()
export class FinancialService {
  private readonly logger = new Logger(FinancialService.name);

  constructor(private readonly database: FinancialDatabase) {}

  async initializeSchema(): Promise<void> {
    await this.database.query(FINANCIAL_SCHEMA_SQL);
  }

  async createPaymentIntent(input: PaymentIntentInput) {
    const currency = assertCurrency(input.currency);
    const amountMinor = asMinor(input.amountMinor);
    if (!input.idempotencyKey || input.idempotencyKey.length > 200) {
      throw new BadRequestException('A valid Idempotency-Key is required');
    }
    return this.database.transaction(async (client) => {
      const existing = await client.query<{
        id: string;
        state: string;
        project_id: string;
        contributor_id: string;
        amount_minor: string;
        currency: string;
      }>(
        `SELECT id, state, project_id, contributor_id, amount_minor, currency
         FROM financial_payment_intents WHERE idempotency_key = $1 FOR UPDATE`,
        [input.idempotencyKey],
      );
      if (existing.rowCount) {
        const prior = existing.rows[0];
        if (
          prior.project_id !== input.projectId ||
          prior.contributor_id !== input.contributorId ||
          prior.amount_minor !== amountMinor.toString() ||
          prior.currency !== currency
        ) {
          throw new ConflictException(
            'Idempotency-Key was already used for a different payment intent',
          );
        }
        return { id: prior.id, state: prior.state, replayed: true };
      }
      const result = await client.query<{ id: string; state: string }>(
        `INSERT INTO financial_payment_intents (project_id, contributor_id, amount_minor, currency, state, idempotency_key, correlation_id)
         VALUES ($1, $2, $3, $4, 'pending', $5, $6) RETURNING id, state`,
        [
          input.projectId,
          input.contributorId,
          amountMinor.toString(),
          currency,
          input.idempotencyKey,
          input.correlationId,
        ],
      );
      await this.enqueue(
        client,
        'payment.intent.created',
        result.rows[0].id,
        input.correlationId,
        { projectId: input.projectId },
      );
      return { ...result.rows[0], replayed: false };
    });
  }

  async acceptProviderEvent(
    event: ProviderEvent,
  ): Promise<{ accepted: boolean }> {
    const currency = assertCurrency(event.currency);
    const amountMinor = asMinor(event.amountMinor);
    return this.database.transaction(async (client) => {
      const inserted = await client.query(
        `INSERT INTO financial_inbox (provider, provider_event_id, event_type, payload, correlation_id)
         VALUES ($1, $2, $3, $4::jsonb, $5) ON CONFLICT (provider, provider_event_id) DO NOTHING`,
        [
          event.provider,
          event.providerEventId,
          event.eventType,
          JSON.stringify({
            ...event,
            amountMinor: amountMinor.toString(),
            currency,
          }),
          randomUUID(),
        ],
      );
      return { accepted: inserted.rowCount === 1 };
    });
  }

  async processNextInboxEvent(): Promise<{
    processed: boolean;
    deadLettered?: boolean;
  }> {
    return this.database.transaction(async (client) => {
      const next = await client.query<{
        id: string;
        attempts: number;
        payload: ProviderEvent;
      }>(
        `SELECT id, attempts, payload FROM financial_inbox WHERE status = 'pending' AND next_attempt_at <= now()
         ORDER BY received_at FOR UPDATE SKIP LOCKED LIMIT 1`,
      );
      if (!next.rowCount) return { processed: false };
      const item = next.rows[0];
      await client.query('SAVEPOINT financial_inbox_event');
      try {
        await this.applyProviderEvent(client, item.payload);
        await client.query(
          "UPDATE financial_inbox SET status = 'processed', processed_at = now() WHERE id = $1",
          [item.id],
        );
        return { processed: true };
      } catch (error) {
        await client.query('ROLLBACK TO SAVEPOINT financial_inbox_event');
        const attempts = item.attempts + 1;
        const dead = attempts > RETRY_SCHEDULE_SECONDS.length;
        const delay =
          RETRY_SCHEDULE_SECONDS[
            Math.min(attempts - 1, RETRY_SCHEDULE_SECONDS.length - 1)
          ];
        await client.query(
          `UPDATE financial_inbox SET status = $2, attempts = $3, last_error = $4,
           next_attempt_at = now() + ($5 * interval '1 second') WHERE id = $1`,
          [
            item.id,
            dead ? 'dead_letter' : 'pending',
            attempts,
            error instanceof Error
              ? error.message.slice(0, 500)
              : 'processing error',
            delay,
          ],
        );
        this.logger.error(
          `Financial inbox event ${item.id} failed without sensitive payload logging`,
        );
        return { processed: false, deadLettered: dead };
      }
    });
  }

  async postJournal(params: {
    idempotencyKey: string;
    correlationId: string;
    description: string;
    lines: LedgerLine[];
    reversalOf?: string;
  }) {
    this.assertBalanced(params.lines);
    return this.database.transaction((client) =>
      this.postJournalInTransaction(client, params),
    );
  }

  async reconcile(params: {
    provider: string;
    currency: string;
    providerTotalMinor: string;
    evidenceReference: string;
  }) {
    const currency = assertCurrency(params.currency);
    const providerTotalMinor = asNonNegativeMinor(params.providerTotalMinor);
    const ledger = await this.database.query<{ total: string }>(
      `SELECT COALESCE(SUM(debit_minor - credit_minor), 0)::text AS total FROM financial_postings
       WHERE currency = $1 AND account = 'asset:provider_receivable:${params.provider}:${currency}'`,
      [currency],
    );
    const ledgerTotalMinor = BigInt(ledger.rows[0]?.total ?? '0');
    const difference = providerTotalMinor - ledgerTotalMinor;
    const result = await this.database.query<{ id: string }>(
      `INSERT INTO financial_reconciliations (provider, currency, provider_total_minor, ledger_total_minor, difference_minor, evidence_reference)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING id`,
      [
        params.provider,
        currency,
        providerTotalMinor.toString(),
        ledgerTotalMinor.toString(),
        difference.toString(),
        params.evidenceReference,
      ],
    );
    return { id: result.rows[0].id, differenceMinor: difference.toString() };
  }

  async readiness() {
    return { financialDatabase: await this.database.readiness() };
  }

  async getPaymentIntent(id: string, contributorId: string) {
    const result = await this.database.query<{
      id: string;
      project_id: string;
      contributor_id: string;
      amount_minor: string;
      currency: string;
      state: string;
    }>(
      `SELECT id, project_id, contributor_id, amount_minor, currency, state
       FROM financial_payment_intents WHERE id = $1 AND contributor_id = $2`,
      [id, contributorId],
    );
    if (!result.rowCount)
      throw new BadRequestException('Payment intent not found');
    const intent = result.rows[0];
    return {
      id: intent.id,
      projectId: intent.project_id,
      amountMinor: intent.amount_minor,
      currency: intent.currency,
      state: intent.state,
    };
  }

  async assertIntentForCheckout(params: {
    id: string;
    contributorId: string;
    projectId: string;
    amountMinor: bigint;
    currency: string;
  }): Promise<void> {
    const intent = await this.getPaymentIntent(params.id, params.contributorId);
    if (
      intent.projectId !== params.projectId ||
      intent.amountMinor !== params.amountMinor.toString() ||
      intent.currency !== assertCurrency(params.currency) ||
      intent.state !== 'pending'
    ) {
      throw new ConflictException(
        'Payment intent does not match this checkout',
      );
    }
  }

  /** Called only after the campaign/milestone adapter has recorded an approved release. */
  async releaseCampaignFunds(params: {
    projectId: string;
    currency: string;
    amountMinor: bigint;
    milestoneId: string;
    approvalReference: string;
    correlationId: string;
  }) {
    const currency = assertCurrency(params.currency);
    const amountMinor = asMinor(params.amountMinor);
    const fee = calculateCampaignSuccessFee(amountMinor);
    return this.database.transaction(async (client) => {
      const escrowAccount = `liability:campaign_escrow:${params.projectId}:${currency}`;
      await this.lockLedgerAccount(client, escrowAccount);
      await this.assertCreditBalance(client, escrowAccount, amountMinor);
      const journal = await this.postJournalInTransaction(client, {
        idempotencyKey: `release:${params.approvalReference}`,
        correlationId: params.correlationId,
        description: 'Approved campaign milestone release',
        lines: [
          {
            account: escrowAccount,
            debitMinor: amountMinor,
            creditMinor: 0n,
          },
          {
            account: `liability:campaign_owner_payable:${params.projectId}:${currency}`,
            debitMinor: 0n,
            creditMinor: fee.ownerProceedsMinor,
          },
          {
            account: `revenue:campaign_success_fee:${currency}`,
            debitMinor: 0n,
            creditMinor: fee.keiboFeeMinor,
          },
        ],
      });
      if (!journal.replayed) {
        await this.enqueue(
          client,
          'campaign.released',
          params.projectId,
          params.correlationId,
          {
            projectId: params.projectId,
            milestoneId: params.milestoneId,
            amountMinor: amountMinor.toString(),
            platformFeeMinor: fee.keiboFeeMinor.toString(),
            currency,
            ledgerJournalId: journal.id,
            reconciliationReference: params.approvalReference,
          },
        );
      }
      return journal;
    });
  }

  private async applyProviderEvent(
    client: PoolClient,
    event: ProviderEvent,
  ): Promise<void> {
    const intent = await client.query<{
      id: string;
      project_id: string;
      amount_minor: string;
      currency: string;
      state: string;
      provider: string | null;
      provider_fee_minor: string | null;
      capture_journal_id: string | null;
    }>('SELECT * FROM financial_payment_intents WHERE id = $1 FOR UPDATE', [
      event.paymentIntentId,
    ]);
    if (!intent.rowCount) throw new Error('Payment intent not found');
    const payment = intent.rows[0];
    if (
      payment.currency !== assertCurrency(event.currency) ||
      BigInt(payment.amount_minor) !== asMinor(event.amountMinor)
    )
      throw new Error('Provider evidence does not match payment intent');
    if (payment.provider && payment.provider !== event.provider)
      throw new Error('Provider evidence does not match captured provider');
    if (['refunded', 'reversed'].includes(payment.state)) return;
    if (event.eventType === 'failed') {
      if (!['pending', 'authorized'].includes(payment.state))
        throw new Error(`Cannot fail payment from ${payment.state}`);
      await client.query(
        "UPDATE financial_payment_intents SET state = 'failed', updated_at = now() WHERE id = $1",
        [payment.id],
      );
      return;
    }
    if (event.eventType === 'authorized') {
      if (payment.state === 'authorized') return;
      if (payment.state !== 'pending')
        throw new Error(`Cannot authorize payment from ${payment.state}`);
      await client.query(
        "UPDATE financial_payment_intents SET state = 'authorized', updated_at = now() WHERE id = $1",
        [payment.id],
      );
      return;
    }
    const gross = BigInt(payment.amount_minor);
    const evidenceProviderFee = event.providerFeeMinor
      ? asNonNegativeMinor(event.providerFeeMinor)
      : 0n;
    const providerFee = payment.provider_fee_minor
      ? BigInt(payment.provider_fee_minor)
      : evidenceProviderFee;
    if (providerFee >= gross)
      throw new Error('Provider fee cannot equal or exceed captured amount');
    const campaignAllocation = gross - providerFee;

    if (event.eventType === 'settled') {
      if (payment.state === 'settled') return;
      if (payment.state !== 'captured')
        throw new Error(`Cannot settle payment from ${payment.state}`);
      const journal = await this.postJournalInTransaction(client, {
        idempotencyKey: `settlement:${event.provider}:${event.providerEventId}`,
        correlationId: randomUUID(),
        description: 'Provider funds settled to bank',
        lines: [
          {
            account: `asset:bank:${payment.currency}`,
            debitMinor: gross,
            creditMinor: 0n,
          },
          {
            account: `asset:provider_receivable:${event.provider}:${payment.currency}`,
            debitMinor: 0n,
            creditMinor: gross,
          },
        ],
      });
      await client.query(
        "UPDATE financial_payment_intents SET state = 'settled', updated_at = now() WHERE id = $1",
        [payment.id],
      );
      await this.enqueue(client, 'payment.settled', payment.id, randomUUID(), {
        projectId: payment.project_id,
        amountMinor: campaignAllocation.toString(),
        grossMinor: gross.toString(),
        providerFeeMinor: providerFee.toString(),
        currency: payment.currency,
        ledgerJournalId: journal.id,
        reconciliationReference: `${event.provider}:${event.providerEventId}`,
      });
      return;
    }

    if (event.eventType === 'refunded' || event.eventType === 'reversed') {
      if (!['captured', 'settled'].includes(payment.state))
        throw new Error(
          `Cannot ${event.eventType} payment from ${payment.state}`,
        );
      const assetAccount =
        payment.state === 'settled'
          ? `asset:bank:${payment.currency}`
          : `asset:provider_receivable:${event.provider}:${payment.currency}`;
      const escrowAccount = `liability:campaign_escrow:${payment.project_id}:${payment.currency}`;
      await this.lockLedgerAccount(client, escrowAccount);
      await this.assertCreditBalance(client, escrowAccount, campaignAllocation);
      const lines: LedgerLine[] = [
        {
          account: escrowAccount,
          debitMinor: campaignAllocation,
          creditMinor: 0n,
        },
        { account: assetAccount, debitMinor: 0n, creditMinor: gross },
      ];
      if (providerFee > 0n) {
        lines.splice(1, 0, {
          account: `liability:provider_cost:${event.provider}:${payment.currency}`,
          debitMinor: providerFee,
          creditMinor: 0n,
        });
      }
      const journal = await this.postJournalInTransaction(client, {
        idempotencyKey: `${event.eventType}:${event.provider}:${event.providerEventId}`,
        correlationId: randomUUID(),
        description: `Provider payment ${event.eventType}`,
        lines,
        reversalOf: payment.capture_journal_id ?? undefined,
      });
      await client.query(
        'UPDATE financial_payment_intents SET state = $2, updated_at = now() WHERE id = $1',
        [payment.id, event.eventType],
      );
      await this.enqueue(
        client,
        `payment.${event.eventType}`,
        payment.id,
        randomUUID(),
        {
          projectId: payment.project_id,
          amountMinor: campaignAllocation.toString(),
          grossMinor: gross.toString(),
          providerFeeMinor: providerFee.toString(),
          currency: payment.currency,
          ledgerJournalId: journal.id,
          reconciliationReference: `${event.provider}:${event.providerEventId}`,
        },
      );
      return;
    }

    if (event.eventType !== 'captured')
      throw new Error('Unsupported provider transition');
    if (['captured', 'settled'].includes(payment.state)) return;
    if (!['pending', 'authorized'].includes(payment.state))
      throw new Error(`Cannot capture payment from ${payment.state}`);
    if (payment.provider_fee_minor && providerFee !== evidenceProviderFee)
      throw new Error('Provider fee evidence changed for payment intent');
    const escrowAccount = `liability:campaign_escrow:${payment.project_id}:${payment.currency}`;
    await this.lockLedgerAccount(client, escrowAccount);
    const captureLines: LedgerLine[] = [
      {
        account: `asset:provider_receivable:${event.provider}:${payment.currency}`,
        debitMinor: gross,
        creditMinor: 0n,
      },
      {
        account: escrowAccount,
        debitMinor: 0n,
        creditMinor: campaignAllocation,
      },
    ];
    if (providerFee > 0n) {
      captureLines.push({
        account: `liability:provider_cost:${event.provider}:${payment.currency}`,
        debitMinor: 0n,
        creditMinor: providerFee,
      });
    }
    const journal = await this.postJournalInTransaction(client, {
      idempotencyKey: `capture:${event.provider}:${event.providerEventId}`,
      correlationId: randomUUID(),
      description: 'Provider payment captured',
      lines: captureLines,
    });
    await client.query(
      "UPDATE financial_payment_intents SET state = 'captured', provider = $2, provider_fee_minor = $3, capture_journal_id = $4, updated_at = now() WHERE id = $1",
      [payment.id, event.provider, providerFee.toString(), journal.id],
    );
    await this.enqueue(client, 'payment.captured', payment.id, randomUUID(), {
      projectId: payment.project_id,
      amountMinor: gross.toString(),
      grossMinor: gross.toString(),
      providerFeeMinor: providerFee.toString(),
      currency: payment.currency,
      ledgerJournalId: journal.id,
      reconciliationReference: `${event.provider}:${event.providerEventId}`,
    });
    await this.enqueue(
      client,
      'campaign.allocated',
      payment.project_id,
      randomUUID(),
      {
        projectId: payment.project_id,
        amountMinor: campaignAllocation.toString(),
        grossMinor: gross.toString(),
        providerFeeMinor: providerFee.toString(),
        currency: payment.currency,
        ledgerJournalId: journal.id,
        reconciliationReference: `${event.provider}:${event.providerEventId}`,
      },
    );
  }

  private async postJournalInTransaction(
    client: PoolClient,
    params: {
      idempotencyKey: string;
      correlationId: string;
      description: string;
      lines: LedgerLine[];
      reversalOf?: string;
    },
  ) {
    this.assertBalanced(params.lines);
    const existing = await client.query<{ id: string }>(
      'SELECT id FROM financial_journals WHERE idempotency_key = $1',
      [params.idempotencyKey],
    );
    if (existing.rowCount) return { id: existing.rows[0].id, replayed: true };
    const journal = await client.query<{ id: string }>(
      `INSERT INTO financial_journals (idempotency_key, correlation_id, description, reversal_of) VALUES ($1, $2, $3, $4) RETURNING id`,
      [
        params.idempotencyKey,
        params.correlationId,
        params.description,
        params.reversalOf ?? null,
      ],
    );
    for (const line of params.lines) {
      await client.query(
        `INSERT INTO financial_postings (journal_id, currency, account, debit_minor, credit_minor) VALUES ($1, $2, $3, $4, $5)`,
        [
          journal.rows[0].id,
          this.currencyFromAccount(line.account),
          line.account,
          line.debitMinor.toString(),
          line.creditMinor.toString(),
        ],
      );
    }
    return { id: journal.rows[0].id, replayed: false };
  }

  private async enqueue(
    client: PoolClient,
    topic: string,
    aggregateId: string,
    correlationId: string,
    payload: Record<string, string>,
  ) {
    await client.query(
      `INSERT INTO financial_outbox (topic, aggregate_id, payload, correlation_id) VALUES ($1, $2, $3::jsonb, $4)`,
      [topic, aggregateId, JSON.stringify(payload), correlationId],
    );
  }

  private async lockLedgerAccount(client: PoolClient, account: string) {
    await client.query(
      'SELECT pg_advisory_xact_lock(hashtextextended($1, 0))',
      [account],
    );
  }

  private async assertCreditBalance(
    client: PoolClient,
    account: string,
    requiredMinor: bigint,
  ) {
    const balance = await client.query<{ available: string }>(
      `SELECT COALESCE(SUM(credit_minor - debit_minor), 0)::text AS available
       FROM financial_postings WHERE account = $1`,
      [account],
    );
    if (BigInt(balance.rows[0]?.available ?? '0') < requiredMinor)
      throw new ConflictException('Insufficient campaign escrow balance');
  }

  private assertBalanced(lines: LedgerLine[]) {
    if (lines.length < 2)
      throw new BadRequestException('A journal needs at least two postings');
    if (!assertBalancedPosting(lines))
      throw new BadRequestException('Journal postings must balance');
    if (
      lines.some(
        (line) =>
          line.debitMinor < 0n ||
          line.creditMinor < 0n ||
          (line.debitMinor === 0n) === (line.creditMinor === 0n),
      )
    )
      throw new BadRequestException(
        'Each posting must have exactly one positive side',
      );
  }

  private currencyFromAccount(account: string): string {
    const match = account.match(/:([A-Z]{3})$/);
    if (!match)
      throw new BadRequestException(
        'Ledger account must end with a currency code',
      );
    return match[1];
  }
}
