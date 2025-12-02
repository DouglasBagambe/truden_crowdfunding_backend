import { ApiProperty } from '../../../common/swagger.decorators';
import { IsString, MinLength, Matches } from 'class-validator';

export class ResetPasswordDto {
  @ApiProperty()
  @IsString()
  token!: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  @Matches(
    /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^\w\s]).{8,}$/,
    {
      message:
        'Password must be at least 8 characters and include upper, lower, number, and special character',
    },
  )
  newPassword!: string;
}
