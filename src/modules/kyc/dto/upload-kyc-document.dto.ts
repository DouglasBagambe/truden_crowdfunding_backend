import { IsEnum, IsObject, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { KycDocumentType } from '../interfaces/kyc.interface';

export class UploadKycDocumentDto {
  @ApiProperty({ enum: KycDocumentType })
  @IsEnum(KycDocumentType)
  type!: KycDocumentType;

  @ApiPropertyOptional({ description: 'Human-readable label for the document' })
  @IsOptional()
  @IsString()
  @Length(0, 128)
  label?: string;

  @ApiPropertyOptional({ description: 'Additional metadata about the document' })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
