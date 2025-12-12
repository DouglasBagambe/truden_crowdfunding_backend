import { IsBoolean, IsEnum, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';
import { ProjectType } from '../../../common/enums/project-type.enum';

export class CreateAgreementTemplateDto {
  @ApiProperty({ enum: ProjectType })
  @IsEnum(ProjectType)
  projectType!: ProjectType;

  @ApiPropertyOptional({ description: 'Charity category or ROI category tag (optional)' })
  @IsOptional()
  @IsString()
  category?: string;

  @ApiPropertyOptional({ description: 'ROI industry tag (optional)' })
  @IsOptional()
  @IsString()
  industry?: string;

  @ApiProperty({ description: 'Agreement title', minLength: 2, maxLength: 200 })
  @IsString()
  @Length(2, 200)
  title!: string;

  @ApiPropertyOptional({ description: 'Agreement description', maxLength: 2000 })
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Indicates if investors must accept before contributing',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  requiresAcceptance?: boolean = true;

  @ApiPropertyOptional({ description: 'Activate immediately', default: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean = true;
}
