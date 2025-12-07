import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { DocumentCategory } from '../types';

export class UploadDto {
  @IsString()
  @IsNotEmpty()
  projectId!: string;

  @IsString()
  @IsOptional()
  folderId?: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsArray()
  @IsString({ each: true })
  @IsOptional()
  tags?: string[];

  @IsEnum(DocumentCategory)
  @IsOptional()
  category?: DocumentCategory;

  @IsString()
  @IsOptional()
  relatedMilestoneId?: string;

  @IsBoolean()
  @IsOptional()
  encrypted?: boolean;
}
