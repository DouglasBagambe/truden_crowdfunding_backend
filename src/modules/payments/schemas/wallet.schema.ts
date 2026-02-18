import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum WithdrawalMethodType {
    MobileMoney = 'mobile_money',
    BankAccount = 'bank_account',
}

@Schema({ _id: false })
export class WithdrawalMethod {
    @Prop({
        type: String,
        enum: Object.values(WithdrawalMethodType),
        required: true,
    })
    type!: WithdrawalMethodType;

    @Prop({ type: String, required: true })
    provider!: string; // e.g., 'mtn', 'airtel', 'stanbic_bank'

    @Prop({ type: String, required: true })
    accountNumber!: string;

    @Prop({ type: String, required: true })
    accountName!: string;

    @Prop({ type: Boolean, default: false })
    isDefault!: boolean;

    @Prop({ type: Boolean, default: true })
    isActive!: boolean;

    @Prop({ type: Date, default: Date.now })
    addedAt!: Date;
}

@Schema({ _id: false })
export class FiatBalance {
    @Prop({ type: Number, default: 0, min: 0 })
    UGX!: number;

    @Prop({ type: Number, default: 0, min: 0 })
    USD!: number;
}

@Schema({ _id: false })
export class CryptoBalance {
    @Prop({ type: Number, default: 0, min: 0 })
    ETH!: number;

    @Prop({ type: Number, default: 0, min: 0 })
    USDC!: number;
}

@Schema({ timestamps: true })
export class Wallet {
    @Prop({
        type: MongooseSchema.Types.ObjectId,
        required: true,
        unique: true,
        index: true,
        ref: 'User',
    })
    userId!: Types.ObjectId;

    // Fiat balance (from Flutterwave deposits)
    @Prop({ type: FiatBalance, default: {} })
    fiatBalance!: FiatBalance;

    // Crypto balance (from wallet deposits)
    @Prop({ type: CryptoBalance, default: {} })
    cryptoBalance!: CryptoBalance;

    // Total balance in USD for sorting/filtering
    @Prop({ type: Number, default: 0 })
    totalBalanceUSD!: number;

    // Transaction references
    @Prop({
        type: [{ type: MongooseSchema.Types.ObjectId, ref: 'PaymentTransaction' }],
        default: [],
    })
    transactions!: Types.ObjectId[];

    // Withdrawal methods
    @Prop({ type: [WithdrawalMethod], default: [] })
    withdrawalMethods!: WithdrawalMethod[];

    // Security
    @Prop({ type: Boolean, default: false })
    isLocked!: boolean;

    @Prop({ type: String })
    lockReason?: string;

    @Prop({ type: Date })
    lastActivityAt?: Date;
}

export type WalletDocument = Wallet & Document;

export const WalletSchema = SchemaFactory.createForClass(Wallet);

// Indexes
WalletSchema.index({ userId: 1 });
WalletSchema.index({ totalBalanceUSD: -1 });

// Pre-save hook to calculate total balance in USD
WalletSchema.pre('save', function (next) {
    const wallet = this as WalletDocument;

    // Simple conversion rates (should be fetched from API in production)
    const UGX_TO_USD = 0.00027; // 1 UGX = 0.00027 USD (approximate)
    const ETH_TO_USD = 2500; // 1 ETH = 2500 USD (approximate)
    const USDC_TO_USD = 1; // 1 USDC = 1 USD

    wallet.totalBalanceUSD =
        (wallet.fiatBalance?.UGX || 0) * UGX_TO_USD +
        (wallet.fiatBalance?.USD || 0) +
        (wallet.cryptoBalance?.ETH || 0) * ETH_TO_USD +
        (wallet.cryptoBalance?.USDC || 0) * USDC_TO_USD;

    next();
});
