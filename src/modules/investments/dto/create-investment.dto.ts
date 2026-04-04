import { IsNotEmpty, IsNumberString, IsOptional, IsString } from 'class-validator';

export class CreateInvestmentDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsNumberString()
  amount!: string;

  /** ISO-4217 currency code. Defaults to 'UGX'. */
  @IsString()
  @IsOptional()
  currency?: string;

  /** Optional note (e.g. investment terms acknowledged). */
  @IsString()
  @IsOptional()
  notes?: string;

  // projectOnchainId: preserved in blockchain/nfts-future branch
}
