import {
  IsArray,
  IsDateString,
  IsOptional,
  IsString,
  Length,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { IsUrl } from 'class-validator';

class KycAttachmentDto {
  @ApiProperty({ description: 'Attachment title' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiProperty({ description: 'Attachment URL' })
  @IsUrl()
  url!: string;

  @ApiPropertyOptional({ description: 'Attachment type/label' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  type?: string;

  @ApiPropertyOptional({
    description: 'Required for verification',
    default: false,
  })
  @IsOptional()
  isRequired?: boolean;
}

export class SubmitKycDto {
  @ApiProperty({ description: 'Document type (e.g., passport, national_id)' })
  @IsString()
  @Length(2, 64)
  documentType!: string;

  @ApiProperty({ description: 'Document country (ISO-3166 alpha 2)' })
  @IsString()
  @Length(2, 4)
  documentCountry!: string;

  @ApiPropertyOptional({
    description: 'Last 4 of document number (hashed if needed)',
  })
  @IsOptional()
  @IsString()
  @Length(2, 16)
  documentLast4?: string;

  @ApiPropertyOptional({ description: 'Date of birth', format: 'date' })
  @IsOptional()
  @IsDateString()
  dateOfBirth?: string;

  @ApiPropertyOptional({
    description: 'Evidence URLs or document uploads (pre-upload to storage)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];

  @ApiPropertyOptional({
    description: 'Attachments metadata (if you manage uploads separately)',
    type: [KycAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  attachments?: KycAttachmentDto[];
}
