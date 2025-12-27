import { Type } from 'class-transformer';
import {
  IsDateString,
  IsEnum,
  IsInt,
  IsMongoId,
  IsOptional,
  Min,
} from 'class-validator';
import {
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { KycApplicationStatus } from '../interfaces/kyc.interface';

export class AdminFilterKycDto {
  @ApiPropertyOptional({ enum: KycApplicationStatus })
  @IsOptional()
  @IsEnum(KycApplicationStatus)
  status?: KycApplicationStatus;

  @ApiPropertyOptional({ description: 'Filter by userId' })
  @IsOptional()
  @IsMongoId()
  userId?: string;

  @ApiPropertyOptional({ description: 'Submitted from date', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  fromDate?: string;

  @ApiPropertyOptional({ description: 'Submitted to date', format: 'date-time' })
  @IsOptional()
  @IsDateString()
  toDate?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  pageSize = 20;
}
