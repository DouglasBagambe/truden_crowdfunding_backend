import { UserRole } from '../enums/role.enum';

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  [UserRole.SUPERADMIN]: 'Full platform access',
  [UserRole.ADMIN]:
    'Operational admin with project and user management, approvals, and escrow coordination',
  [UserRole.INNOVATOR]:
    'Project owner who can submit, edit, and manage their projects',
  [UserRole.APPROVER]:
    'Project assessment and approval lead for deal screening and go/no-go decisions',
  [UserRole.INVESTOR]: 'Can view and invest in approved projects',
  [UserRole.TREASURY]: 'Treasury operations and escrow management',
};
