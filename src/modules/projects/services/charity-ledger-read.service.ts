import { Injectable } from '@nestjs/common';
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
  constructor(private readonly database: FinancialDatabase) {}

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
      `SELECT id, project_id, amount_minor, currency, state, created_at, updated_at
       FROM financial_payment_intents WHERE project_id = $1 AND currency <> 'USDC'
       AND state IN ('captured', 'settled', 'released') ORDER BY created_at DESC LIMIT $2`,
      [projectId, limit],
    );
    return result.rows.map((row) => ({
      id: row.id,
      donorName: 'Anonymous',
      amount: charityMajorAmount(row.amount_minor, row.currency),
      currency: row.currency,
      message: null,
      createdAt: row.created_at,
    }));
  }
}
