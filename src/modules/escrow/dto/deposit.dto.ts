import {
  IsEnum,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
} from 'class-validator';
import { EscrowCurrency, FundingSource } from '../types';

export class DepositDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsOptional()
  investorId?: string;

  @IsString()
  @IsNotEmpty()
  amount!: string;

  @IsEnum(EscrowCurrency)
  currency!: EscrowCurrency;

  @IsEnum(FundingSource)
  source!: FundingSource;

  @IsString()
  @IsOptional()
  txHash?: string;

  @IsString()
  @IsOptional()
  providerTxId?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
