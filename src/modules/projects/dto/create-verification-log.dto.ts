import { IsArray, IsOptional, IsString, Length } from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { DocumentAttachmentDto } from './document-attachment.dto';

export class CreateVerificationLogDto {
  @ApiProperty({ description: 'Verifier user id' })
  @IsString()
  @Length(1, 128)
  performedBy!: string;

  @ApiPropertyOptional({ description: 'Verifier role' })
  @IsOptional()
  @IsString()
  @Length(0, 128)
  role?: string;

  @ApiProperty({ description: 'Summary of the verification findings' })
  @IsString()
  @Length(4, 2000)
  summary!: string;

  @ApiProperty({
    description: 'Decision (approve/reject/needs_more_info)',
    enum: ['approve', 'reject', 'needs_more_info'],
  })
  @IsString()
  decision!: 'approve' | 'reject' | 'needs_more_info';

  @ApiPropertyOptional({
    description: 'External evidence URLs',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  evidenceUrls?: string[];

  @ApiPropertyOptional({
    description: 'Attached docs supporting verification',
    type: [DocumentAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  attachments?: DocumentAttachmentDto[];
}
