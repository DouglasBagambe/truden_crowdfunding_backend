import { IsEnum, IsObject, IsOptional } from 'class-validator';
import {
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import type { KycLevel } from '../interfaces/kyc.interface';

export class SubmitKycApplicationDto {
  @ApiPropertyOptional({ enum: ['BASIC', 'ENHANCED'] })
  @IsOptional()
  @IsEnum(['BASIC', 'ENHANCED'], {
    message: 'level must be BASIC or ENHANCED',
  })
  level?: KycLevel;

  @ApiPropertyOptional({ description: 'Additional metadata to send to provider' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
