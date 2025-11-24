import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { BadRequestException } from '@nestjs/common';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';

const toBoolean = (value: unknown): boolean | undefined => {
  if (value === undefined || value === null || value === '') {
    return undefined;
  }
  if (typeof value === 'boolean') {
    return value;
  }
  if (typeof value === 'number') {
    return value !== 0;
  }
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes'].includes(normalized)) {
      return true;
    }
    if (['false', '0', 'no'].includes(normalized)) {
      return false;
    }
  }
  throw new BadRequestException('isBlocked must be a boolean value');
};

export class QueryUsersDto {
  @ApiPropertyOptional({ enum: UserRole })
  @IsOptional()
  @IsEnum(UserRole)
  role?: UserRole;

  @ApiPropertyOptional({ enum: KYCStatus })
  @IsOptional()
  @IsEnum(KYCStatus)
  kycStatus?: KYCStatus;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => toBoolean(value))
  isBlocked?: boolean;

  @ApiPropertyOptional({
    description: 'Case-insensitive search across wallet and email',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit = 25;

  @ApiPropertyOptional({ default: 0, minimum: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  skip = 0;
}
