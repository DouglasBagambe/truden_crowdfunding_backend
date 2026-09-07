import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

export type FinancialProjectionDocument = HydratedDocument<FinancialProjection>;

@Schema({ collection: 'financial_projections', timestamps: true })
export class FinancialProjection {
  @Prop({ required: true, unique: true, index: true })
  eventId!: string;

  @Prop({ required: true, index: true })
  campaignId!: string;

  @Prop({ index: true })
  milestoneId?: string;

  @Prop({ required: true, index: true })
  kind!: 'payment' | 'allocation' | 'milestone' | 'refund';

  @Prop({ required: true })
  state!: string;

  @Prop({ required: true })
  amountMinor!: string;

  @Prop({ required: true })
  currency!: string;

  @Prop({ required: true, index: true })
  ledgerJournalId!: string;

  @Prop({ required: true })
  reconciliationReference!: string;
}

export const FinancialProjectionSchema =
  SchemaFactory.createForClass(FinancialProjection);

FinancialProjectionSchema.index({ campaignId: 1, kind: 1, state: 1 });
