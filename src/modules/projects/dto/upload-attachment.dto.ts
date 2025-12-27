import { ApiPropertyOptional, ApiProperty } from '../../../common/swagger.decorators';
import { IsOptional, IsString, Length, IsBoolean } from 'class-validator';

export class UploadAttachmentDto {
  @ApiProperty({ description: 'Title/name for the uploaded attachment' })
  @IsString()
  @Length(2, 128)
  title!: string;

  @ApiPropertyOptional({ description: 'Optional type/label (e.g., certificate, license)' })
  @IsOptional()
  @IsString()
  @Length(0, 64)
  type?: string;

  @ApiPropertyOptional({ description: 'Mark as required' })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean;
}
