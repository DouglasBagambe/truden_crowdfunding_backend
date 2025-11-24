import { IsEnum } from 'class-validator';
import { UserRole } from '../../../common/enums/role.enum';
import { ApiProperty } from '../../../common/swagger.decorators';

export class UpdateRoleDto {
  @ApiProperty({ enum: UserRole })
  @IsEnum(UserRole)
  role!: UserRole;
}
