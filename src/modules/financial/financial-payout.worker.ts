import { ConflictException, Injectable } from '@nestjs/common';
import type { PoolClient } from 'pg';
import { FinancialDatabase } from './financial.database';
import { FlutterwaveV4PayoutAdapter } from './providers/flutterwave-v4-payout.adapter';

type CallbackInput = {
  transferId: string;
  reference: string;
  amount: string;
  currency: string;
  status: 'PENDING' | 'PROCESSING' | 'SUCCESSFUL' | 'FAILED' | 'UNKNOWN';
};

type PayoutRow = {
  id: string;
  state: string;
  provider_transfer_id: string | null;
  destination_status: string;
  destination_creator: string;
  creator_id: string;
  release_creator: string;
  amount_minor: string;
  owner_proceeds_minor: string;
  currency: string;
  release_currency: string;
  provider_recipient_id: string;
  keibo_reference: string;
  idempotency_key: string;
};

@Injectable()
export class FinancialPayoutWorker {
  constructor(
    private readonly database: FinancialDatabase,
    private readonly provider: FlutterwaveV4PayoutAdapter,
  ) {}
  verifyWebhookSignature(
    raw: Buffer | undefined,
    signature: string | undefined,
  ) {
    return this.provider.verifyWebhookSignature(raw, signature);
  }
  async dispatch(payload: Record<string, unknown>) {
    const payoutId = this.payoutId(payload);
    const row = await this.database.query<PayoutRow>(
      `SELECT p.*,d.provider_recipient_id,d.status AS destination_status,d.creator_id AS destination_creator,r.creator_id AS release_creator,r.owner_proceeds_minor,r.currency AS release_currency FROM financial_payout_transfers p JOIN financial_payout_destinations d ON d.id=p.payout_destination_id JOIN financial_campaign_releases r ON r.id=p.release_id WHERE p.id=$1`,
      [payoutId],
    );
    if (!row.rowCount)
      throw Object.assign(new Error('Payout not found'), { code: 'NOT_FOUND' });
    const payout = row.rows[0];
    if (payout.state === 'paid' || payout.provider_transfer_id) return;
    if (
      payout.destination_status !== 'verified' ||
      payout.destination_creator !== payout.creator_id ||
      payout.release_creator !== payout.creator_id ||
      payout.amount_minor !== payout.owner_proceeds_minor ||
      payout.currency !== payout.release_currency
    )
      throw Object.assign(new Error('Payout authority validation failed'), {
        code: 'PAYOUT_VALIDATION_FAILED',
      });
    const transfer = await this.provider.createTransfer({
      recipientId: payout.provider_recipient_id,
      amountMinor: BigInt(payout.amount_minor),
      currency: payout.currency,
      reference: payout.keibo_reference,
      narration: 'KEIBO campaign milestone payout',
      idempotencyKey: payout.idempotency_key,
    });
    const state = transfer.status === 'PROCESSING' ? 'processing' : 'pending';
    await this.database.transaction(async (client) => {
      const updated = await client.query(
        `UPDATE financial_payout_transfers SET provider_transfer_id=$2,provider_status=$3,state=$4,dispatched_at=COALESCE(dispatched_at,now()),updated_at=now() WHERE id=$1 AND provider_transfer_id IS NULL AND state<>'paid' RETURNING id`,
        [payout.id, transfer.id, transfer.status, state],
      );
      if (!updated.rowCount) return;
      await this.outbox(client, 'payout.dispatched', payout.id, {
        payoutId: payout.id,
        state,
      });
      await this.schedule(client, payout.id);
    });
  }
  async reconcile(payload: Record<string, unknown>) {
    const payoutId = this.payoutId(payload);
    const row = await this.database.query<PayoutRow>(
      'SELECT * FROM financial_payout_transfers WHERE id=$1',
      [payoutId],
    );
    if (!row.rowCount)
      throw Object.assign(new Error('Payout not found'), { code: 'NOT_FOUND' });
    const payout = row.rows[0];
    if (payout.state === 'paid') return;
    if (!payout.provider_transfer_id)
      throw Object.assign(new Error('Transfer dispatch not complete'), {
        code: 'RPC_PENDING',
      });
    const result = await this.provider.getTransferStatus(
      payout.provider_transfer_id,
    );
    await this.database.transaction(async (client) => {
      if (result.status === 'SUCCESSFUL')
        return this.transition(
          client,
          payout.id,
          'paid',
          result.status,
          'payout.paid',
          'paid_at',
        );
      if (result.status === 'FAILED')
        return this.transition(
          client,
          payout.id,
          'failed',
          result.status,
          'payout.failed',
          'failed_at',
        );
      if (result.status === 'UNKNOWN')
        throw Object.assign(new Error('Provider status unknown'), {
          code: 'RPC_PENDING',
        });
      await client.query(
        `UPDATE financial_payout_transfers SET state=$2,provider_status=$3,updated_at=now() WHERE id=$1 AND state NOT IN ('paid','failed')`,
        [
          payout.id,
          result.status === 'PROCESSING' ? 'processing' : 'pending',
          result.status,
        ],
      );
      await this.schedule(client, payout.id);
    });
  }
  async callback(input: CallbackInput) {
    if (
      !input.transferId ||
      !input.reference ||
      !/^\d+$/.test(input.amount) ||
      input.currency !== 'UGX'
    )
      throw new ConflictException('Malformed payout callback');
    await this.database.transaction(async (client) => {
      const row = await client.query<PayoutRow>(
        'SELECT * FROM financial_payout_transfers WHERE keibo_reference=$1 FOR UPDATE',
        [input.reference],
      );
      if (!row.rowCount)
        throw new ConflictException('Unknown payout reference');
      const payout = row.rows[0];
      if (
        payout.provider_transfer_id !== input.transferId ||
        payout.amount_minor !== input.amount ||
        payout.currency !== input.currency
      )
        throw new ConflictException('Payout callback does not match transfer');
      if (payout.state === 'paid') return;
      if (input.status === 'SUCCESSFUL')
        return this.transition(
          client,
          payout.id,
          'paid',
          input.status,
          'payout.paid',
          'paid_at',
        );
      if (input.status === 'FAILED')
        return this.transition(
          client,
          payout.id,
          'failed',
          input.status,
          'payout.failed',
          'failed_at',
        );
      if (input.status === 'PROCESSING') {
        const updated = await client.query(
          `UPDATE financial_payout_transfers SET state='processing',provider_status=$2,updated_at=now() WHERE id=$1 AND state='pending' RETURNING id`,
          [payout.id, input.status],
        );
        if (updated.rowCount)
          await this.outbox(client, 'payout.processing', payout.id, {
            payoutId: payout.id,
          });
      }
    });
    return { accepted: true };
  }
  private payoutId(payload: Record<string, unknown> | undefined) {
    const payoutId =
      typeof payload?.payoutId === 'string' ? payload.payoutId : '';
    if (!payoutId)
      throw Object.assign(new Error('Invalid payout job payload'), {
        code: 'INVALID_PAYLOAD',
      });
    return payoutId;
  }
  private async transition(
    client: PoolClient,
    id: string,
    state: 'paid' | 'failed',
    providerStatus: string,
    topic: 'payout.paid' | 'payout.failed',
    timestamp: 'paid_at' | 'failed_at',
  ) {
    const updated = await client.query(
      `UPDATE financial_payout_transfers SET state=$2,provider_status=$3,${timestamp}=COALESCE(${timestamp},now()),updated_at=now() WHERE id=$1 AND state<>$2 AND state<>'paid' RETURNING id`,
      [id, state, providerStatus],
    );
    if (updated.rowCount)
      await this.outbox(client, topic, id, { payoutId: id });
  }
  private async schedule(client: PoolClient, payoutId: string) {
    await client.query(
      `INSERT INTO financial_jobs(job_type,aggregate_type,aggregate_id,deduplication_key,payload,available_at) VALUES ('payout.reconcile.requested','payout_transfer',$1,$2,$3::jsonb,now()+interval '60 seconds') ON CONFLICT(deduplication_key) DO UPDATE SET available_at=LEAST(financial_jobs.available_at,EXCLUDED.available_at)`,
      [payoutId, `payout.reconcile:${payoutId}`, JSON.stringify({ payoutId })],
    );
  }
  private async outbox(
    client: PoolClient,
    topic: string,
    id: string,
    payload: Record<string, unknown>,
  ) {
    await client.query(
      'INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id) VALUES($1,$2,$3::jsonb,gen_random_uuid())',
      [topic, id, JSON.stringify(payload)],
    );
  }
}
