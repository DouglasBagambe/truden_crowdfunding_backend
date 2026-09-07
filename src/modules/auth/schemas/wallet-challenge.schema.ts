import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type WalletChallengeDocument = HydratedDocument<WalletChallenge>;
export type WalletChallengePurpose = 'link' | 'unlink';

@Schema({ collection: 'wallet_challenges', timestamps: true })
export class WalletChallenge {
  @Prop({ type: Types.ObjectId, ref: 'User', required: true, index: true })
  userId!: Types.ObjectId;

  @Prop({ required: true, lowercase: true, trim: true, index: true })
  address!: string;

  @Prop({ required: true, enum: ['link', 'unlink'] })
  purpose!: WalletChallengePurpose;

  @Prop({ required: true, unique: true, select: false })
  nonceHash!: string;

  @Prop({ required: true })
  domain!: string;

  @Prop({ required: true })
  uri!: string;

  @Prop({ type: [Number], required: true })
  allowedChainIds!: number[];

  @Prop({ type: Date, required: true })
  expiresAt!: Date;

  @Prop({ type: Date, index: true })
  consumedAt?: Date;
}

export const WalletChallengeSchema =
  SchemaFactory.createForClass(WalletChallenge);
WalletChallengeSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });
