import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';
import { ProjectType } from '../../../common/enums/project-type.enum';

export class CreateAttachmentRequirementDto {
  @ApiProperty({ enum: ProjectType })
  @IsEnum(ProjectType)
  projectType!: ProjectType;

  @ApiPropertyOptional({ description: 'Category (charity) scope' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'Subcategory (charity) scope' })
  @IsOptional()
  @IsString()
  subcategory?: string;

  @ApiPropertyOptional({ description: 'Industry (ROI) scope' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiProperty({ description: 'Attachment title/name', minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'Attachment description', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({ description: 'Whether this attachment is required', default: true })
  @IsOptional()
  @IsBoolean()
  isRequired?: boolean = true;

  @ApiPropertyOptional({ description: 'Activate immediately', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
