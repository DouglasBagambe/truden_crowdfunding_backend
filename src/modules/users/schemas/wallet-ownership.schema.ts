import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletOwnershipDocument = HydratedDocument<WalletOwnership>;

@Schema({ collection: 'wallet_ownerships', timestamps: true })
export class WalletOwnership {
  @Prop({ required: true, unique: true, lowercase: true, trim: true })
  address!: string;

  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;
}

export const WalletOwnershipSchema =
  SchemaFactory.createForClass(WalletOwnership);
