import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum PaymentStatus {
    Pending = 'pending',
    Processing = 'processing',
    Successful = 'successful',
    Failed = 'failed',
    Cancelled = 'cancelled',
}

export enum PaymentMethod {
    MobileMoney = 'mobile_money',
    Card = 'card',
    BankTransfer = 'bank_transfer',
    Wallet = 'wallet',
}

export enum PaymentProvider {
    Flutterwave = 'flutterwave',
    Blockchain = 'blockchain',
    DPO = 'dpo',
}

export enum MobileMoneyProvider {
    MTN = 'mtn',
    Airtel = 'airtel',
    Vodafone = 'vodafone',
}

@Schema({ timestamps: true })
export class PaymentTransaction {
    @Prop({
        type: MongooseSchema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'User',
    })
    userId!: Types.ObjectId;

    @Prop({
        type: MongooseSchema.Types.ObjectId,
        required: true,
        index: true,
        ref: 'Project',
    })
    projectId!: Types.ObjectId;

    @Prop({ type: Number, required: true })
    amount!: number;

    @Prop({ type: String, required: true, default: 'UGX' })
    currency!: string;

    @Prop({
        type: String,
        enum: Object.values(PaymentMethod),
        required: true,
    })
    paymentMethod!: PaymentMethod;

    @Prop({
        type: String,
        enum: Object.values(PaymentProvider),
        required: true,
    })
    provider!: PaymentProvider;

    // Flutterwave specific fields
    @Prop({ type: String, index: true })
    flutterwaveTransactionId?: string;

    @Prop({ type: String, unique: true, sparse: true, index: true })
    flutterwaveReference?: string;

    @Prop({ type: String })
    flutterwavePaymentLink?: string;

    // Mobile money specific
    @Prop({ type: String, enum: Object.values(MobileMoneyProvider) })
    mobileMoneyProvider?: MobileMoneyProvider;

    @Prop({ type: String })
    phoneNumber?: string;

    // DPO specific fields
    @Prop({ type: String, index: true })
    dpoToken?: string;

    // Card specific
    @Prop({ type: String })
    cardLast4?: string;

    @Prop({ type: String })
    cardBrand?: string;

    // Status
    @Prop({
        type: String,
        enum: Object.values(PaymentStatus),
        default: PaymentStatus.Pending,
        index: true,
    })
    status!: PaymentStatus;

    @Prop({ type: String })
    failureReason?: string;

    // Metadata
    @Prop({ type: Object })
    metadata?: Record<string, any>;

    // Investment tracking
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Investment' })
    investmentId?: Types.ObjectId;

    @Prop({ type: Boolean, default: false })
    nftMinted!: boolean;

    @Prop({ type: String })
    nftTokenId?: string;

    @Prop({ type: String })
    blockchainTxHash?: string;

    // Webhook data
    @Prop({ type: Object })
    webhookData?: Record<string, any>;

    @Prop({ type: Date })
    completedAt?: Date;
}

export type PaymentTransactionDocument = PaymentTransaction & Document;

export const PaymentTransactionSchema =
    SchemaFactory.createForClass(PaymentTransaction);

// Indexes
PaymentTransactionSchema.index({ userId: 1, status: 1 });
PaymentTransactionSchema.index({ projectId: 1, status: 1 });
// PaymentTransactionSchema.index({ flutterwaveReference: 1 });
PaymentTransactionSchema.index({ createdAt: -1 });
