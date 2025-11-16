import { IsString, IsEthereumAddress } from 'class-validator';

export class LinkWalletDto {
  @IsEthereumAddress()
  walletAddress: string;

  @IsString()
  message: string;

  @IsString()
  signature: string;
}
