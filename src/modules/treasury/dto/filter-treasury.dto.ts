import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
} from 'class-validator';
import { Type } from 'class-transformer';
import { TreasuryTransactionType } from '../interfaces/treasury-transaction.interface';

export class FilterTreasuryDto {
  @IsEnum(TreasuryTransactionType)
  @IsOptional()
  type?: TreasuryTransactionType;

  @IsDateString()
  @IsOptional()
  fromDate?: string;

  @IsDateString()
  @IsOptional()
  toDate?: string;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  minAmount?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  maxAmount?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  page?: number;

  @Type(() => Number)
  @IsNumber()
  @IsOptional()
  pageSize?: number;
}
