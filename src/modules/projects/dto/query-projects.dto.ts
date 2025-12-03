import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { CharityCategory } from '../../../common/enums/charity-category.enum';
import { ROIIndustry } from '../../../common/enums/roi-industry.enum';

const toNumber = (value: unknown, fallback: number) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export class QueryProjectsDto {
  @ApiPropertyOptional({ enum: ProjectStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ProjectStatus, { each: true })
  statuses?: ProjectStatus[];

  @ApiPropertyOptional({ enum: ProjectType, description: 'Project type filter' })
  @IsOptional()
  @IsEnum(ProjectType)
  type?: ProjectType;

  @ApiPropertyOptional({
    description: 'Project category filter (charity)',
    enum: CharityCategory,
  })
  @IsOptional()
  @IsEnum(CharityCategory)
  category?: CharityCategory;

  @ApiPropertyOptional({
    description: 'Project industry filter (ROI)',
    enum: ROIIndustry,
  })
  @IsOptional()
  @IsEnum(ROIIndustry)
  industry?: ROIIndustry;

  @ApiPropertyOptional({ description: 'Filter by country of operation' })
  @IsOptional()
  @IsString()
  country?: string;

  @ApiPropertyOptional({
    description: 'Filter by tag; can be repeated',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  @Transform(({ value }) => {
    if (value === undefined || value === null || value === '') return undefined;
    return Array.isArray(value)
      ? value
      : String(value)
          .split(',')
          .map((tag) => tag.trim())
          .filter(Boolean);
  })
  tags?: string[];

  @ApiPropertyOptional({ description: 'Search by name/summary/story text' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Transform(({ value }) => toNumber(value, 1))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20, maximum: 100 })
  @IsOptional()
  @IsNumber()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => toNumber(value, 20))
  pageSize?: number = 20;
}
