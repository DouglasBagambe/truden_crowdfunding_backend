import { IsBoolean, IsOptional, IsString, Length } from 'class-validator';
import { ApiProperty } from '../../../common/swagger.decorators';

export class BlockUserDto {
  @ApiProperty({ description: 'Whether the user should be blocked' })
  @IsBoolean()
  isBlocked: boolean;

  @ApiProperty({
    description: 'Optional reason for moderation',
    required: false,
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @Length(2, 256)
  reason?: string;
}
