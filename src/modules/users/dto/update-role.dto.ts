import { IsEnum } from 'class-validator';
import { UserRole } from '../schemas/user.schema';
import { ApiProperty } from '../../../common/swagger.decorators';

export class UpdateRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}
