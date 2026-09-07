import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import {
  FinancialProjection,
  type FinancialProjectionDocument,
} from './financial-projection.schema';

export interface LedgerProjectionEvent {
  eventId: string;
  campaignId: string;
  milestoneId?: string;
  kind: 'payment' | 'allocation' | 'milestone' | 'refund';
  state: string;
  amountMinor: string;
  currency: string;
  ledgerJournalId: string;
  reconciliationReference: string;
}

@Injectable()
export class FinancialProjectionService {
  constructor(
    @InjectModel(FinancialProjection.name)
    private readonly projections: Model<FinancialProjectionDocument>,
  ) {}

  async apply(event: LedgerProjectionEvent): Promise<void> {
    if (!event.ledgerJournalId || !event.reconciliationReference) {
      throw new Error(
        'Financial projections require ledger and reconciliation references',
      );
    }
    await this.projections.updateOne(
      { eventId: event.eventId },
      { $setOnInsert: event },
      { upsert: true },
    );
  }

  async listCampaign(campaignId: string): Promise<FinancialProjection[]> {
    return this.projections
      .find({ campaignId })
      .sort({ createdAt: 1 })
      .lean()
      .exec();
  }
}
