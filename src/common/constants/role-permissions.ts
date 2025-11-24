import { Permission } from '../enums/permission.enum';
import { UserRole } from '../enums/role.enum';

const ALL_PERMISSIONS = Object.values(Permission);

export const ROLE_PERMISSIONS: Record<UserRole, Permission[]> = {
  [UserRole.SUPERADMIN]: ALL_PERMISSIONS,
  [UserRole.ADMIN]: [
    Permission.MANAGE_USERS,
    Permission.REVIEW_PROJECTS,
    Permission.APPROVE_PROJECTS,
    Permission.MANAGE_PROJECTS,
    Permission.MANAGE_ESCROW,
  ],
  [UserRole.INNOVATOR]: [Permission.SUBMIT_PROJECT, Permission.EDIT_OWN_PROJECT],
  [UserRole.APPROVER]: [Permission.REVIEW_PROJECTS, Permission.APPROVE_PROJECTS],
  [UserRole.INVESTOR]: [Permission.INVEST],
  [UserRole.TREASURY]: [
    Permission.MANAGE_TREASURY,
    Permission.MANAGE_ESCROW,
  ],
};
