import {
  ArrayMinSize,
  IsArray,
  IsNotEmpty,
  IsNumberString,
  IsObject,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';

export class DistributionTargetDto {
  @IsString()
  @IsNotEmpty()
  recipientId!: string;

  @IsNumberString()
  amount!: string;

  @IsString()
  @IsOptional()
  walletAddress?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}

export class DistributeFundsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DistributionTargetDto)
  @ArrayMinSize(1)
  recipients!: DistributionTargetDto[];

  @IsString()
  @IsOptional()
  description?: string;

  @IsString()
  @IsOptional()
  txHash?: string;

  @IsObject()
  @IsOptional()
  metadata?: Record<string, any>;
}
