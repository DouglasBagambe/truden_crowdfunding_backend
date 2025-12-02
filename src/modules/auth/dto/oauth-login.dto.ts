import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '../../../common/swagger.decorators';

export enum AuthProvider {
  EMAIL = 'email',
  GOOGLE = 'google',
  APPLE = 'apple',
}

export class OAuthLoginDto {
  @ApiProperty({ enum: AuthProvider, enumName: 'AuthProvider' })
  @IsEnum(AuthProvider)
  provider!: AuthProvider;

  @ApiProperty({ description: 'Provider id token or access token' })
  @IsString()
  idToken!: string;

  @ApiPropertyOptional({ description: 'Email returned by provider (optional)' })
  @IsOptional()
  @IsString()
  email?: string;

  @ApiPropertyOptional({ description: 'Display name returned by provider (optional)' })
  @IsOptional()
  @IsString()
  displayName?: string;
}
