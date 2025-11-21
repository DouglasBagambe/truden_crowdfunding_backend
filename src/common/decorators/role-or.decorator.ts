import { applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';
import { UserRole } from '../enums/role.enum';

/**
 * Allows SUPERADMIN or any of the provided roles.
 */
export const RoleMetadataOr = (...roles: UserRole[]) =>
  applyDecorators(Roles(UserRole.SUPERADMIN, ...roles));
