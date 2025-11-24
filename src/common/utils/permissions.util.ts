import { Permission } from '../enums/permission.enum';
import { UserRole } from '../enums/role.enum';
import { ROLE_PERMISSIONS } from '../constants/role-permissions';

export const getPermissionsForRoles = (roles: UserRole[] = []): Permission[] => {
  const normalizedRoles = Array.isArray(roles) ? roles : [];
  const permissionSet = new Set<Permission>();

  for (const role of normalizedRoles) {
    const rolePermissions = ROLE_PERMISSIONS[role];
    if (rolePermissions) {
      rolePermissions.forEach((perm) => permissionSet.add(perm));
    }
  }

  return Array.from(permissionSet);
};
