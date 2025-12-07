import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

@Schema({ timestamps: true })
export class Nft {
  @Prop({ type: Number, required: true, unique: true, index: true })
  tokenId!: number;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'Project',
    required: true,
    index: true,
  })
  projectId!: Types.ObjectId;

  @Prop({
    type: MongooseSchema.Types.ObjectId,
    ref: 'User',
    required: true,
    index: true,
  })
  investorId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true })
  walletAddress!: string;

  @Prop({ type: Number, required: true })
  amountInvested!: number;

  @Prop({ required: true })
  metadataUri!: string;

  @Prop({ type: Number, required: true, default: 0 })
  value!: number;

  @Prop({ required: true })
  txHash!: string;
}

export type NftDocument = Nft & Document;

export const NftSchema = SchemaFactory.createForClass(Nft);

NftSchema.index({ tokenId: 1 });
NftSchema.index({ investorId: 1 });
NftSchema.index({ projectId: 1 });
