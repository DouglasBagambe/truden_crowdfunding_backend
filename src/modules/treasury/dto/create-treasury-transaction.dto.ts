import {
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';

export class CreateTreasuryTransactionDto {
  @IsNumberString()
  @IsNotEmpty()
  amount!: string;

  @IsString()
  @IsOptional()
  txHash?: string;

  @IsString()
  @IsOptional()
  projectId?: string;

  @IsString()
  @IsOptional()
  investorId?: string;

  @IsString()
  @IsOptional()
  nftId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
