import { IsEnum, IsString } from 'class-validator';
import { ApiProperty } from '../../../common/swagger.decorators';

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
}
