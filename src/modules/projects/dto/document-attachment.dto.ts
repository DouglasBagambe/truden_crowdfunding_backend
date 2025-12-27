import { IsBoolean, IsOptional, IsString, IsUrl, Length, ValidateIf } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';

export class DocumentAttachmentDto {
  @ApiProperty({ description: 'Human-friendly title for the attachment' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiPropertyOptional({ description: 'Attachment URL (legacy/optional; use fileId for uploaded files)' })
  @IsOptional()
  @ValidateIf((o: DocumentAttachmentDto) => !o.fileId || o.url !== undefined)
  @IsUrl()
  url?: string;

  @ApiPropertyOptional({ description: 'Stored file id (preferred for uploaded attachments)' })
  @IsOptional()
  @IsString()
  fileId?: string;

  @ApiPropertyOptional({ description: 'Optional type/label (e.g., pitch, deck, audit)' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  type?: string;

  @ApiPropertyOptional({
    description: 'Marks attachments that are mandatory for verification (others are supporting docs)',
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
