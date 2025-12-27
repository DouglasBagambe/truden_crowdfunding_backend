import { IsObject, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';

export class KycWebhookDto {
  @ApiProperty({ description: 'Provider reference ID for the KYC application' })
  @IsString()
  reference!: string;

  @ApiProperty({ description: 'Provider status string' })
  @IsString()
  status!: string;

  @ApiPropertyOptional({ description: 'Optional user identifier from provider' })
  @IsOptional()
  @IsString()
  externalUserId?: string;

  @ApiPropertyOptional({ description: 'Raw provider payload' })
  @IsOptional()
  @IsObject()
  payload?: Record<string, any>;
}
