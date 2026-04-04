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

  // ─── NFT / Blockchain fields ────────────────────────────────────────────────

  /**
   * The user's self-custodial wallet address (MetaMask / WalletConnect).
   * Required to mint the NFT on-chain after payment is confirmed.
   */
  @Prop({ type: String, default: null, lowercase: true })
  walletAddress?: string | null;

  /** On-chain project token ID (same as projectOnchainId on the Project doc) */
  @Prop({ type: Number, default: null })
  nftProjectId?: number | null;

  /** Amount of ERC-1155 tokens minted to the investor */
  @Prop({ type: Number, default: null })
  nftTokenAmount?: number | null;

  /** Transaction hash of the mintInvestmentTokens call */
  @Prop({ type: String, default: null })
  nftTxHash?: string | null;

  /** IPFS URI of the NFT metadata */
  @Prop({ type: String, default: null })
  nftMetadataUri?: string | null;

  /** Whether the NFT has been minted on-chain */
  @Prop({ type: Boolean, default: false })
  nftMinted!: boolean;

  /** Whether the investor has listed this position on the marketplace */
  @Prop({ type: Boolean, default: false })
  listed!: boolean;
}

export type InvestmentDocument = Investment & Document;

export const InvestmentSchema = SchemaFactory.createForClass(Investment);
