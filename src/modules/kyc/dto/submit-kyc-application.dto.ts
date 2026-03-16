import { IsEnum, IsObject, IsOptional, IsString } from 'class-validator';
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

  /**
   * Who is submitting:
   *   INVESTOR → uses Didit (individual KYC, first 500 free/month)
   *   CREATOR  → uses Laboremus (full individual KYC + business KYB)
   * Defaults to INVESTOR (Didit) if omitted.
   */
  @ApiPropertyOptional({ enum: ['INVESTOR', 'CREATOR'], default: 'INVESTOR' })
  @IsOptional()
  @IsEnum(['INVESTOR', 'CREATOR'], { message: 'userType must be INVESTOR or CREATOR' })
  userType?: 'INVESTOR' | 'CREATOR';

  @ApiPropertyOptional({ description: 'Additional metadata to send to provider' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
