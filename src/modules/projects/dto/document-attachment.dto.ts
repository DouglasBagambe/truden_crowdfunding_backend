import { IsBoolean, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';

export class DocumentAttachmentDto {
  @ApiProperty({ description: 'Human-friendly title for the attachment' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiProperty({ description: 'Attachment URL (IPFS, S3, etc.)' })
  @IsUrl()
  url!: string;

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
