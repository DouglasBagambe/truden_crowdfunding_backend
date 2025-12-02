import { IsEmail, IsOptional, IsString, IsUrl, Length } from 'class-validator';
import { Transform } from 'class-transformer';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';

export class UpdateProfileDto {
  @ApiPropertyOptional({ minLength: 2, maxLength: 64 })
  @IsOptional()
  @IsString()
  @Length(2, 64)
  displayName?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional({ format: 'uri' })
  @IsOptional()
  @IsUrl()
  @Transform(({ value }) => (typeof value === 'string' && value.trim() === '' ? undefined : value))
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Avatar image as base64 (data URL or raw base64)' })
  @IsOptional()
  @IsString()
  avatarBase64?: string;

  @ApiPropertyOptional({ description: 'Country code (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  country?: string;
}
