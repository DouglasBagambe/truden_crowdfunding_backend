import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema } from 'mongoose';
import { TreasuryTransactionType } from '../interfaces/treasury-transaction.interface';

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class TreasuryTransaction {
  @Prop({ type: String, enum: TreasuryTransactionType, required: true })
  type!: TreasuryTransactionType;

  @Prop({ type: Number, required: true })
  amount!: number;

  @Prop()
  txHash?: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User' })
  initiatedBy?: MongooseSchema.Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.Mixed })
  metadata?: Record<string, any>;
}

export type TreasuryTransactionDocument = TreasuryTransaction & Document;

export const TreasuryTransactionSchema =
  SchemaFactory.createForClass(TreasuryTransaction);

TreasuryTransactionSchema.index({ type: 1 });
TreasuryTransactionSchema.index({ createdAt: -1 });
