import { Transform } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
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

const queryString = (value: unknown): string | undefined =>
  typeof value === 'string'
    ? value
    : typeof value === 'number'
      ? String(value)
      : undefined;
const toStringArray = (value: unknown): string[] | undefined => {
  const values: unknown[] = Array.isArray(value)
    ? value
    : (queryString(value)?.split(',') ?? []);
  const strings = values
    .map(queryString)
    .filter((item): item is string => item !== undefined)
    .map((item) => item.trim())
    .filter(Boolean);
  return strings.length ? strings : undefined;
};

export enum ProjectSort {
  NEWEST = 'newest',
  FUNDED = 'funded',
  ENDING = 'ending',
}

export class QueryProjectsDto {
  @IsOptional()
  @IsEnum(ProjectSort)
  sort?: ProjectSort = ProjectSort.NEWEST;

  @ApiPropertyOptional({ enum: ProjectStatus, isArray: true })
  @IsOptional()
  @IsArray()
  @IsEnum(ProjectStatus, { each: true })
  @Transform(({ value }) =>
    toStringArray(value)?.map((status) => status.toUpperCase()),
  )
  statuses?: ProjectStatus[];

  @ApiPropertyOptional({
    enum: ProjectType,
    description: 'Project type filter',
  })
  @IsOptional()
  @IsEnum(ProjectType)
  @Transform(({ value }) => queryString(value)?.trim().toUpperCase())
  type?: ProjectType;

  @ApiPropertyOptional({
    description: 'Project category filter (charity)',
    enum: CharityCategory,
  })
  @IsOptional()
  @IsEnum(CharityCategory)
  @Transform(({ value }) => queryString(value)?.trim().toLowerCase())
  category?: CharityCategory;

  @ApiPropertyOptional({
    description: 'Project industry filter (ROI)',
    enum: ROIIndustry,
  })
  @IsOptional()
  @IsEnum(ROIIndustry)
  @Transform(({ value }) => queryString(value)?.trim().toLowerCase())
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
  @Transform(({ value }) => toStringArray(value))
  tags?: string[];

  @ApiPropertyOptional({ description: 'Search by name/summary/story text' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'Page number (1-based)', default: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Transform(({ value }) => toNumber(value, 1))
  page?: number = 1;

  @ApiPropertyOptional({ description: 'Page size', default: 20, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Transform(({ value }) => toNumber(value, 20))
  pageSize?: number = 20;
}
