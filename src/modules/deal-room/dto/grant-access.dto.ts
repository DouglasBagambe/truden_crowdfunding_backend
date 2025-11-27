import {
  IsDateString,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
} from 'class-validator';
import { AccessLevel } from '../types';

export class GrantAccessDto {
  @IsString()
  @IsNotEmpty()
  documentId!: string;

  @IsString()
  @IsOptional()
  granteeUserId?: string;

  @IsString()
  @IsOptional()
  role?: string;

  @IsEnum(AccessLevel)
  accessLevel!: AccessLevel;

  @IsDateString()
  @IsOptional()
  expiresAt?: string;

  @IsString()
  @IsOptional()
  reason?: string;
}
