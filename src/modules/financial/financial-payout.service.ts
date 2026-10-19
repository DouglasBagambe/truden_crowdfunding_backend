import { KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { FinancialDatabase } from './financial.database';
import { UsersRepository } from '../users/repositories/users.repository';
import { FlutterwaveV4PayoutAdapter } from './providers/flutterwave-v4-payout.adapter';

@Injectable()
export class FinancialPayoutService {
  constructor(
    private readonly database: FinancialDatabase,
    private readonly users: UsersRepository,
    private readonly flutterwave: FlutterwaveV4PayoutAdapter,
  ) {}
  async createDestination(input: {
    creatorId: string;
    type: 'bank' | 'mobile_money';
    accountNumber: string;
    bankOrNetwork: string;
    accountName?: string;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 200)
      throw new ConflictException('A valid Idempotency-Key is required');
    const user = await this.users.findById(input.creatorId);
    if (!user?.emailVerifiedAt)
      throw new ForbiddenException('Email verification is required');
    if (
      user.kycStatus !== KYCStatus.VERIFIED ||
      user.creatorVerification?.status !== CreatorVerificationStatus.VERIFIED
    )
      throw new ForbiddenException('Verified creator KYC is required');
    if (
      !/^\d{6,30}$/.test(input.accountNumber) ||
      !/^[A-Za-z0-9_-]{2,30}$/.test(input.bankOrNetwork)
    )
      throw new ConflictException('Invalid payout destination');
    const recipient = await this.flutterwave.createRecipient(input);
    const masked = `${input.type === 'bank' ? 'Bank' : 'Mobile money'} •••${input.accountNumber.slice(-4)}`;
    const row = await this.database.query<{ id: string }>(
      `INSERT INTO financial_payout_destinations (creator_id,provider,provider_recipient_id,destination_type,currency,masked_display,provider_metadata,status,verified_at) VALUES ($1,'flutterwave',$2,$3,'UGX',$4,$5::jsonb,'verified',now()) RETURNING id`,
      [
        input.creatorId,
        recipient.id,
        input.type,
        masked,
        JSON.stringify(recipient.metadata),
      ],
    );
    return {
      id: row.rows[0].id,
      type: input.type,
      currency: 'UGX',
      maskedDisplay: masked,
      status: 'verified',
    };
  }
  async list(creatorId: string) {
    const r = await this.database.query(
      `SELECT id,destination_type,currency,masked_display,status,created_at FROM financial_payout_destinations WHERE creator_id=$1 ORDER BY created_at DESC`,
      [creatorId],
    );
    return r.rows;
  }
  async disable(creatorId: string, id: string) {
    const r = await this.database.query(
      `UPDATE financial_payout_destinations SET status='disabled',disabled_at=now(),updated_at=now() WHERE id=$1 AND creator_id=$2 AND disabled_at IS NULL RETURNING id`,
      [id, creatorId],
    );
    if (!r.rowCount)
      throw new NotFoundException('Payout destination not found');
    return { id, status: 'disabled' };
  }
  async request(input: {
    creatorId: string;
    releaseId: string;
    destinationId: string;
    idempotencyKey: string;
  }) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 200)
      throw new ConflictException('A valid Idempotency-Key is required');
    const user = await this.users.findById(input.creatorId);
    if (
      !user?.emailVerifiedAt ||
      user.kycStatus !== KYCStatus.VERIFIED ||
      user.creatorVerification?.status !== CreatorVerificationStatus.VERIFIED
    )
      throw new ForbiddenException('Verified creator eligibility is required');
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`creator-wallet:${input.creatorId}`],
      );
      const rel = await client.query<{
        creator_id: string;
        owner_proceeds_minor: string;
        currency: string;
      }>(
        `SELECT creator_id,owner_proceeds_minor,currency FROM financial_campaign_releases WHERE id=$1 FOR UPDATE`,
        [input.releaseId],
      );
      if (!rel.rowCount || rel.rows[0].creator_id !== input.creatorId)
        throw new NotFoundException('Eligible release not found');
      const reserved = await client.query(
        'SELECT payout_id FROM financial_wallet_payout_allocations WHERE release_id=$1',
        [input.releaseId],
      );
      if (reserved.rowCount)
        throw new ConflictException(
          'Funds are already reserved for a Wallet withdrawal',
        );
      const exists = await client.query<{
        id: string;
        state: string;
        keibo_reference: string;
      }>(
        `SELECT id,state,keibo_reference FROM financial_payout_transfers WHERE release_id=$1 FOR UPDATE`,
        [input.releaseId],
      );
      if (exists.rowCount) return { ...exists.rows[0], replayed: true };
      const dest = await client.query(
        `SELECT id FROM financial_payout_destinations WHERE id=$1 AND creator_id=$2 AND status='verified' AND disabled_at IS NULL FOR UPDATE`,
        [input.destinationId, input.creatorId],
      );
      if (!dest.rowCount)
        throw new ConflictException('Verified payout destination not found');
      const id = randomUUID(),
        ref = `KEIBO-PAYOUT-${input.releaseId}`;
      await client.query(
        `INSERT INTO financial_payout_transfers (id,release_id,creator_id,payout_destination_id,amount_minor,currency,provider,keibo_reference,idempotency_key,state) VALUES ($1,$2,$3,$4,$5,$6,'flutterwave',$7,$8,'pending')`,
        [
          id,
          input.releaseId,
          input.creatorId,
          input.destinationId,
          rel.rows[0].owner_proceeds_minor,
          rel.rows[0].currency,
          ref,
          input.idempotencyKey,
        ],
      );
      await client.query(
        `INSERT INTO financial_jobs (job_type,aggregate_type,aggregate_id,deduplication_key,payload) VALUES ('payout.dispatch.requested','payout_transfer',$1,$2,$3::jsonb)`,
        [id, `payout.dispatch:${id}`, JSON.stringify({ payoutId: id })],
      );
      await client.query(
        `INSERT INTO financial_outbox (topic,aggregate_id,payload,correlation_id) VALUES ('payout.requested',$1,$2::jsonb,$3)`,
        [
          id,
          JSON.stringify({
            payoutId: id,
            releaseId: input.releaseId,
            reference: ref,
          }),
          randomUUID(),
        ],
      );
      return { id, state: 'pending', keiboReference: ref, replayed: false };
    });
  }
  async wallet(creatorId: string) {
    const result = await this.database.query<{
      currency: string;
      availableMinor: string;
      heldMinor: string;
      paidMinor: string;
    }>(
      `
      SELECT r.currency,
        COALESCE(SUM(r.owner_proceeds_minor) FILTER (WHERE p.id IS NULL),0)::text AS "availableMinor",
        COALESCE(SUM(r.owner_proceeds_minor) FILTER (WHERE p.id IS NOT NULL AND p.state<>'paid'),0)::text AS "heldMinor",
        COALESCE(SUM(r.owner_proceeds_minor) FILTER (WHERE p.state='paid'),0)::text AS "paidMinor"
      FROM financial_campaign_releases r
      LEFT JOIN financial_wallet_payout_allocations a ON a.release_id=r.id
      LEFT JOIN financial_payout_transfers p ON p.id=a.payout_id OR p.release_id=r.id
      WHERE r.creator_id=$1 GROUP BY r.currency ORDER BY r.currency`,
      [creatorId],
    );
    const transfers = await this.database.query(
      `SELECT id,project_id,currency,gross_amount_minor,owner_proceeds_minor,success_fee_minor,created_at
      FROM financial_campaign_releases WHERE creator_id=$1 ORDER BY created_at DESC`,
      [creatorId],
    );
    return { balances: result.rows, transfers: transfers.rows };
  }

  async withdrawWallet(input: {
    creatorId: string;
    destinationId: string;
    idempotencyKey: string;
    expectedAmountMinor: string;
  }) {
    if (!input.idempotencyKey || input.idempotencyKey.length > 200)
      throw new ConflictException('A valid Idempotency-Key is required');
    const user = await this.users.findById(input.creatorId);
    if (
      !user?.emailVerifiedAt ||
      user.isBlocked ||
      user.isActive === false ||
      user.kycStatus !== KYCStatus.VERIFIED ||
      user.creatorVerification?.status !== CreatorVerificationStatus.VERIFIED
    )
      throw new ForbiddenException(
        'Active verified creator eligibility is required',
      );
    return this.database.transaction(async (client) => {
      await client.query(
        'SELECT pg_advisory_xact_lock(hashtextextended($1,0))',
        [`creator-wallet:${input.creatorId}`],
      );
      const replay = await client.query<{
        id: string;
        creator_id: string;
        payout_destination_id: string;
        wallet_withdrawal: boolean;
        state: string;
        keibo_reference: string;
      }>('SELECT * FROM financial_payout_transfers WHERE idempotency_key=$1', [
        input.idempotencyKey,
      ]);
      if (replay.rowCount) {
        const row = replay.rows[0];
        if (
          row.creator_id !== input.creatorId ||
          row.payout_destination_id !== input.destinationId ||
          String(
            (row as typeof row & { amount_minor: string }).amount_minor,
          ) !== input.expectedAmountMinor ||
          !row.wallet_withdrawal
        )
          throw new ConflictException(
            'Idempotency-Key belongs to another withdrawal',
          );
        return {
          id: row.id,
          state: row.state,
          keiboReference: row.keibo_reference,
          replayed: true,
        };
      }
      const dest = await client.query<{ currency: string }>(
        `SELECT currency FROM financial_payout_destinations
        WHERE id=$1 AND creator_id=$2 AND status='verified' AND disabled_at IS NULL FOR UPDATE`,
        [input.destinationId, input.creatorId],
      );
      if (!dest.rowCount)
        throw new ConflictException('Select a verified payout destination');
      const currency = dest.rows[0].currency;
      const releases = await client.query<{
        id: string;
        owner_proceeds_minor: string;
      }>(
        `
        SELECT r.id,r.owner_proceeds_minor FROM financial_campaign_releases r
        WHERE r.creator_id=$1 AND r.currency=$2
          AND NOT EXISTS(SELECT 1 FROM financial_payout_transfers p WHERE p.release_id=r.id)
          AND NOT EXISTS(SELECT 1 FROM financial_wallet_payout_allocations a WHERE a.release_id=r.id)
        ORDER BY r.id FOR UPDATE`,
        [input.creatorId, currency],
      );
      const amount = releases.rows.reduce(
        (sum, r) => sum + BigInt(r.owner_proceeds_minor),
        0n,
      );
      if (amount <= 0n)
        throw new ConflictException(
          'No available Wallet funds in this destination currency',
        );
      if (amount.toString() !== input.expectedAmountMinor)
        throw new ConflictException(
          'Wallet balance changed. Refresh and review the withdrawal again.',
        );
      const id = randomUUID(),
        ref = `KEIBO-WALLET-${id}`;
      await client.query(
        `INSERT INTO financial_payout_transfers
        (id,release_id,creator_id,payout_destination_id,amount_minor,currency,provider,keibo_reference,idempotency_key,state,wallet_withdrawal)
        VALUES($1,NULL,$2,$3,$4,$5,'flutterwave',$6,$7,'pending',true)`,
        [
          id,
          input.creatorId,
          input.destinationId,
          amount.toString(),
          currency,
          ref,
          input.idempotencyKey,
        ],
      );
      for (const release of releases.rows)
        await client.query(
          `INSERT INTO financial_wallet_payout_allocations(payout_id,release_id,amount_minor) VALUES($1,$2,$3)`,
          [id, release.id, release.owner_proceeds_minor],
        );
      await client.query(
        `INSERT INTO financial_jobs(job_type,aggregate_type,aggregate_id,deduplication_key,payload)
        VALUES('payout.dispatch.requested','payout_transfer',$1,$2,$3::jsonb)`,
        [id, `payout.dispatch:${id}`, JSON.stringify({ payoutId: id })],
      );
      await client.query(
        `INSERT INTO financial_outbox(topic,aggregate_id,payload,correlation_id)
        VALUES('wallet.withdrawal.requested',$1,$2::jsonb,$3)`,
        [id, JSON.stringify({ payoutId: id, reference: ref }), randomUUID()],
      );
      return {
        id,
        state: 'pending',
        amountMinor: amount.toString(),
        currency,
        keiboReference: ref,
        replayed: false,
      };
    });
  }

  async listPayouts(creatorId: string) {
    const r = await this.database.query<{
      id: string;
      release_id: string;
      amount_minor: string;
      currency: string;
      state: string;
      keibo_reference: string;
      created_at: Date;
      masked_display: string;
    }>(
      `SELECT p.id,p.release_id,p.amount_minor,p.currency,p.state,p.keibo_reference,p.created_at,d.masked_display FROM financial_payout_transfers p JOIN financial_payout_destinations d ON d.id=p.payout_destination_id WHERE p.creator_id=$1 ORDER BY p.created_at DESC`,
      [creatorId],
    );
    return r.rows;
  }
  async getPayout(creatorId: string, id: string) {
    const r = await this.database.query<{
      id: string;
      release_id: string;
      amount_minor: string;
      currency: string;
      state: string;
      keibo_reference: string;
      created_at: Date;
      masked_display: string;
    }>(
      `SELECT p.id,p.release_id,p.amount_minor,p.currency,p.state,p.keibo_reference,p.created_at,d.masked_display FROM financial_payout_transfers p JOIN financial_payout_destinations d ON d.id=p.payout_destination_id WHERE p.id=$1 AND p.creator_id=$2`,
      [id, creatorId],
    );
    if (!r.rowCount) throw new NotFoundException('Payout not found');
    return r.rows[0];
  }
}
