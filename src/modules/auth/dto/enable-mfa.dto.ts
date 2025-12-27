import { IsString, Length } from 'class-validator';
import { ApiProperty } from '../../../common/swagger.decorators';

export class EnableMfaDto {
  @ApiProperty({ description: '6-digit TOTP code' })
  @IsString()
  @Length(6, 8)
  token!: string;
}
