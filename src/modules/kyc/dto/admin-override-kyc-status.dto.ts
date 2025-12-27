import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import * as kycInterface from '../interfaces/kyc.interface';

export class AdminOverrideKycStatusDto {
  @ApiProperty({ enum: [
    kycInterface.KycApplicationStatus.APPROVED,
    kycInterface.KycApplicationStatus.REJECTED,
    kycInterface.KycApplicationStatus.NEEDS_MORE_INFO,
    kycInterface.KycApplicationStatus.UNDER_REVIEW,
  ] })
  @IsEnum(kycInterface.KycApplicationStatus)
  status!: kycInterface.KycApplicationStatus;

  @ApiPropertyOptional({ description: 'Reason for rejection or notes for user' })
  @IsOptional()
  @IsString()
  @Length(0, 1024)
  rejectionReason?: string;

  @ApiPropertyOptional({ description: 'Internal manual notes for compliance' })
  @IsOptional()
  @IsString()
  @Length(0, 2048)
  manualNotes?: string;

  @ApiPropertyOptional({ enum: ['BASIC', 'ENHANCED'] })
  @IsOptional()
  @IsString()
  level?: kycInterface.KycLevel;
}
