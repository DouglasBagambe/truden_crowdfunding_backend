import { IsEthereumAddress, IsInt, IsPositive, IsString } from 'class-validator';

export class RecordPurchaseDto {
    /** Number of tokens purchased */
    @IsInt()
    @IsPositive()
    tokenAmount!: number;

    /** Buyer's wallet address */
    @IsEthereumAddress()
    buyerWallet!: string;

    /** Transaction hash of the on-chain purchase call */
    @IsString()
    purchaseTxHash!: string;
}
