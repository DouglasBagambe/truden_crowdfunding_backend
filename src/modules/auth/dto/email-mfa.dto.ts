import { IsString, Length } from 'class-validator';
import { ApiProperty } from '../../../common/swagger.decorators';

export class VerifyEmailMfaDto {
  @ApiProperty({ description: '6-digit email MFA code' })
  @IsString()
  @Length(6, 8)
  token!: string;
}
