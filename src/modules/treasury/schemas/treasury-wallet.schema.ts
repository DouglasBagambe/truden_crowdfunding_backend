import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

@Schema({ timestamps: { createdAt: false, updatedAt: true } })
export class TreasuryWallet {
  @Prop({ type: Number, default: 0, min: 0 })
  totalBalance!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  availableBalance!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  reservedBalance!: number;

  @Prop({ type: Date })
  updatedAt!: Date;
}

export type TreasuryWalletDocument = TreasuryWallet & Document;

export const TreasuryWalletSchema = SchemaFactory.createForClass(TreasuryWallet);
