import { ApiPropertyOptional, ApiProperty } from '../../../common/swagger.decorators';
import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';

export class RequestAttachmentDto {
  @ApiProperty({ description: 'Title/name of the requested attachment' })
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'Reason or description for the requested attachment' })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Whether this attachment is required', default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean = true;
}
