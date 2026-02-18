import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';
import { InvestmentStatus } from '../interfaces/investment.interface';

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

  @Prop({ type: String, default: null })
  nftId?: string | null;

  @Prop({ type: Number, default: null, index: true })
  nftTokenId?: number | null;

  @Prop({ type: String, default: null })
  nftTxHash?: string | null;

  @Prop({ type: String, default: null })
  nftMetadataURI?: string | null;

  @Prop({ type: String, default: null })
  nftContractAddress?: string | null;

  @Prop({ type: String, default: null })
  txHash?: string | null;

  @Prop({
    type: String,
    enum: Object.values(InvestmentStatus),
    default: InvestmentStatus.Pending,
  })
  status!: InvestmentStatus;
}

export type InvestmentDocument = Investment & Document;

export const InvestmentSchema = SchemaFactory.createForClass(Investment);


