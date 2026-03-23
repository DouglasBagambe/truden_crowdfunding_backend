import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document, Schema as MongooseSchema, Types } from 'mongoose';

export enum ListingStatus {
    Active = 'active',
    Sold = 'sold',
    Cancelled = 'cancelled',
    Expired = 'expired',
}

@Schema({ timestamps: true })
export class MarketplaceListing {
    /** On-chain listing ID from the contract */
    @Prop({ type: Number, required: true, unique: true, index: true })
    onchainListingId!: number;

    /** ERC-1155 projectId (same as projectOnchainId) */
    @Prop({ type: Number, required: true, index: true })
    projectOnchainId!: number;

    /** MongoDB project reference */
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'Project', index: true })
    projectId?: Types.ObjectId;

    /** MongoDB user reference for the seller */
    @Prop({ type: MongooseSchema.Types.ObjectId, ref: 'User', required: true, index: true })
    sellerId!: Types.ObjectId;

    /** Seller's on-chain wallet address */
    @Prop({ type: String, required: true, lowercase: true })
    sellerWallet!: string;

    /** Number of ERC-1155 tokens listed */
    @Prop({ type: Number, required: true })
    tokenAmount!: number;

    /** Price per token in wei (ETH on Base) */
    @Prop({ type: String, required: true })
    pricePerTokenWei!: string;

    /** Human-readable price per token in ETH */
    @Prop({ type: Number, required: true })
    pricePerTokenEth!: number;

    /** Total listing value in ETH */
    @Prop({ type: Number, required: true })
    totalValueEth!: number;

    /** Original fiat value (UGX) represented by these tokens */
    @Prop({ type: Number, default: 0 })
    originalFiatValue!: number;

    /** Payment token address (address(0) = native ETH) */
    @Prop({ type: String, default: '0x0000000000000000000000000000000000000000' })
    paymentToken!: string;

    /** On-chain expiry timestamp (unix seconds) */
    @Prop({ type: Number, required: true })
    expiryTimestamp!: number;

    /** Whether partial fills are allowed */
    @Prop({ type: Boolean, default: true })
    partialFill!: boolean;

    /** Minimum token amount per purchase */
    @Prop({ type: Number, default: 1 })
    minPurchase!: number;

    /** Current listing status */
    @Prop({
        type: String,
        enum: Object.values(ListingStatus),
        default: ListingStatus.Active,
        index: true,
    })
    status!: ListingStatus;

    /** Transaction hash of the createListing call */
    @Prop({ type: String })
    createTxHash?: string;

    /** Project title for quick display */
    @Prop({ type: String })
    projectTitle?: string;
}

export type MarketplaceListingDocument = MarketplaceListing & Document;
export const MarketplaceListingSchema = SchemaFactory.createForClass(MarketplaceListing);
