import { IsNotEmpty, IsNumberString, IsString } from 'class-validator';

export class MintNftDto {
  @IsString()
  @IsNotEmpty()
  investorId!: string;

  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsNotEmpty()
  walletAddress!: string;

  @IsNumberString()
  amountInvested!: string;
}
