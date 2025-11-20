import { IsEmail, IsOptional, IsString, IsUrl, Length } from 'class-validator';
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
  avatarUrl?: string;

  @ApiPropertyOptional({ description: 'Country code (ISO-3166 alpha 2)' })
  @IsOptional()
  @IsString()
  country?: string;
}
