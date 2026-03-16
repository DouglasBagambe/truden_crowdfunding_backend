import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { InvestmentStatus } from '../interfaces/investment.interface';

// NOTE: NFT fields (nftId, nftTokenId, nftTxHash, nftMetadataURI, nftContractAddress)
// exist in the blockchain/nfts-future branch and will be restored when the
// custodial-wallet + smart-contract infrastructure is ready.

@Schema({ timestamps: true })
export class Investment {
  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
    ref: 'Project',
  })
  projectId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    required: true,
    index: true,
    ref: 'User',
  })
  investorId!: Types.ObjectId;

  @Prop({ type: Number, required: true })
  amount!: number;

  /** ISO-4217 currency code, e.g. 'UGX' */
  @Prop({ type: String, default: 'UGX' })
  currency!: string;

  /** Payment gateway transaction reference (DPO / Flutterwave) */
  @Prop({ type: String, default: null, index: true })
  txHash?: string | null;

  @Prop({
    type: String,
    enum: Object.values(InvestmentStatus),
    default: InvestmentStatus.Pending,
  })
  status!: InvestmentStatus;

  /** Optional admin or system notes */
  @Prop({ type: String, default: null })
  notes?: string | null;
}

export type InvestmentDocument = Investment & Document;

export const InvestmentSchema = SchemaFactory.createForClass(Investment);
