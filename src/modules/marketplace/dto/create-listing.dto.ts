import {
    IsBoolean,
    IsEthereumAddress,
    IsInt,
    IsNumber,
    IsOptional,
    IsPositive,
    IsString,
    Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class CreateListingDto {
    /** ERC-1155 project on-chain ID */
    @IsInt()
    @IsPositive()
    projectOnchainId!: number;

    /** Number of tokens to list */
    @IsInt()
    @IsPositive()
    tokenAmount!: number;

    /** Price per token in ETH (will be converted to wei on-chain) */
    @IsNumber()
    @IsPositive()
    pricePerTokenEth!: number;

    /** Payment token address; defaults to native ETH */
    @IsOptional()
    @IsEthereumAddress()
    paymentToken?: string;

    /** Unix timestamp (seconds) for listing expiry */
    @IsInt()
    @IsPositive()
    expiryTimestamp!: number;

    /** Allow partial fills */
    @IsOptional()
    @IsBoolean()
    partialFill?: boolean;

    /** Minimum tokens per purchase */
    @IsOptional()
    @IsInt()
    @Min(1)
    minPurchase?: number;

    /** The on-chain listing ID returned by the contract after the tx */
    @IsInt()
    @Min(0)
    onchainListingId!: number;

    /** Transaction hash of the createListing call */
    @IsString()
    createTxHash!: string;

    /** Seller's wallet address (validated against JWT user) */
    @IsEthereumAddress()
    sellerWallet!: string;

    /** MongoDB project ID for enrichment */
    @IsOptional()
    @IsString()
    projectId?: string;
}
