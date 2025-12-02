import { IsEmail, IsOptional, IsString } from 'class-validator';
import { ApiPropertyOptional } from '../../../common/swagger.decorators';

export class VerifyEmailDto {
  @ApiPropertyOptional({ description: 'JWT verification token (legacy/optional)' })
  @IsString()
  @IsOptional()
  token?: string;

  @ApiPropertyOptional({ description: 'Short verification code sent via email' })
  @IsString()
  @IsOptional()
  code?: string;

  @ApiPropertyOptional({ description: 'Email (required when using code)' })
  @IsEmail()
  @IsOptional()
  email?: string;
}
