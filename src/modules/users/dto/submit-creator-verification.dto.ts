import { IsArray, IsOptional, IsString, Length, IsUrl } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';

class VerificationAttachmentDto {
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

export class SubmitCreatorVerificationDto {
  @ApiPropertyOptional({ description: 'Evidence URLs (uploads, links)' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];

  @ApiPropertyOptional({
    description: 'Attachments (ID, certificate of incorporation, etc.)',
    type: [VerificationAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  attachments?: VerificationAttachmentDto[];

  @ApiPropertyOptional({ description: 'Notes for the reviewer' })
  @IsOptional()
  @IsString()
  @Length(0, 500)
  notes?: string;
}
