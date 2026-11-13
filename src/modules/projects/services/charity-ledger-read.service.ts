import { Injectable, Optional } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { PaymentTransaction } from '../../payments/schemas/payment-transaction.schema';
import { FinancialDatabase } from '../../financial/financial.database';

export type CharityLedgerPayment = {
  id: string;
  project_id: string;
  contributor_id: string;
  amount_minor: string;
  currency: string;
  state: string;
  created_at: Date;
  updated_at: Date;
};
export type CharityLedgerTotal = {
  project_id: string;
  currency: string;
  amount_minor: string;
  backer_count: string;
};

export function charityMajorAmount(minor: string, currency: string): number {
  const amount = Number(minor);
  if (!Number.isSafeInteger(amount))
    throw new Error('Charity amount exceeds safe display precision');
  return amount / (currency.toUpperCase() === 'UGX' ? 1 : 100);
}

/** Read canonical ledger state; never increment legacy Mongo financial totals. */
@Injectable()
export class CharityLedgerReadService {
  constructor(
    private readonly database: FinancialDatabase,
    @Optional()
    @InjectModel(PaymentTransaction.name)
    private readonly checkoutPayments?: Model<PaymentTransaction>,
  ) {}

  /** Owner-only read model: paid is not necessarily settled or spendable. */
  async campaignFunds(projectIds: string[]) {
    if (!projectIds.length) return [];
    const result = await this.database.query<{
      project_id: string;
      currency: string;
      awaitingSettlementMinor: string;
      transferableMinor: string;
      transferredMinor: string;
    }>(
      `WITH paid AS (
        SELECT project_id,currency,
          SUM(amount_minor-COALESCE(provider_fee_minor,0)) FILTER (WHERE state='captured') AS awaiting,
          SUM(amount_minor-COALESCE(provider_fee_minor,0)) FILTER (WHERE state='settled') AS settled
        FROM financial_payment_intents WHERE project_id=ANY($1::text[]) AND currency<>'USDC'
        GROUP BY project_id,currency
      ), released AS (
        SELECT project_id,currency,SUM(gross_amount_minor) AS amount
        FROM financial_campaign_releases WHERE project_id=ANY($1::text[]) GROUP BY project_id,currency
      ) SELECT p.project_id,p.currency,COALESCE(p.awaiting,0)::text AS "awaitingSettlementMinor",
        GREATEST(COALESCE(p.settled,0)-COALESCE(r.amount,0),0)::text AS "transferableMinor",
        COALESCE(r.amount,0)::text AS "transferredMinor"
      FROM paid p LEFT JOIN released r ON r.project_id=p.project_id AND r.currency=p.currency`,
      [projectIds],
    );
    return result.rows;
  }

  async totals(projectIds: string[]): Promise<CharityLedgerTotal[]> {
    if (!projectIds.length) return [];
    const result = await this.database.query<CharityLedgerTotal>(
      `SELECT project_id, currency, SUM(amount_minor - COALESCE(provider_fee_minor, 0))::text AS amount_minor,
       COUNT(*)::text AS backer_count FROM financial_payment_intents
       WHERE project_id = ANY($1::text[]) AND currency <> 'USDC'
       AND state IN ('captured', 'settled', 'released') GROUP BY project_id, currency`,
      [projectIds],
    );
    return result.rows;
  }

  async donationsByUser(userId: string): Promise<CharityLedgerPayment[]> {
    const result = await this.database.query<CharityLedgerPayment>(
      `SELECT id, project_id, contributor_id, amount_minor, currency, state, created_at, updated_at
       FROM financial_payment_intents WHERE contributor_id = $1 AND currency <> 'USDC'
       AND state IN ('captured', 'settled', 'released') ORDER BY created_at DESC`,
      [userId],
    );
    return result.rows;
  }

  async donors(projectId: string, limit: number) {
    const result = await this.database.query<CharityLedgerPayment>(
      `SELECT id, project_id, contributor_id, amount_minor, currency, state, created_at, updated_at
       FROM financial_payment_intents WHERE project_id = $1 AND currency <> 'USDC'
       AND state IN ('captured', 'settled', 'released') ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    // Use only the public name actually supplied at checkout. Never infer one
    // from an email, phone number, or profile (including historical donations).
    const names = new Map<string, string>();
    if (this.checkoutPayments && result.rows.length) {
      const checkouts = await this.checkoutPayments
        .find({
          projectId: new Types.ObjectId(projectId),
          provider: 'dpo',
          'metadata.paymentIntentId': { $in: result.rows.map((row) => row.id) },
        })
        .select('userId metadata.paymentIntentId metadata.donorName')
        .lean()
        .exec();
      for (const row of result.rows) {
        const matching = checkouts.filter(
          (checkout) =>
            checkout.metadata?.paymentIntentId === row.id &&
            String(checkout.userId) === row.contributor_id,
        );
        const supplied = matching.map(
          (checkout): unknown => checkout.metadata?.donorName,
        );
        // Conflicting or missing historical metadata stays anonymous.
        if (
          supplied.length &&
          supplied.every(
            (name) =>
              typeof name === 'string' &&
              name.trim() &&
              !name.includes('@') &&
              name === supplied[0],
          )
        )
          names.set(row.id, (supplied[0] as string).trim().slice(0, 100));
      }
    }
    return result.rows.map((row) => ({
      id: row.id,
      donorName: names.get(row.id) || 'Anonymous',
      amount: charityMajorAmount(row.amount_minor, row.currency),
      currency: row.currency,
      message: null,
      createdAt: row.created_at,
    }));
  }
}
