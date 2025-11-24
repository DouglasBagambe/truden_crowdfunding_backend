import { UserRole, KYCStatus } from '../enums/role.enum';
import { Permission } from '../enums/permission.enum';

export interface IUser {
  id: string;
  email?: string;
  password?: string;
  primaryWallet?: string;
  linkedWallets?: string[];
  roles: UserRole[];
  permissions?: Permission[];
  kycStatus: KYCStatus;
  nonce?: string;
  isActive: boolean;
  isBlocked: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLoginAt?: Date;
  profile: {
    displayName?: string;
    firstName?: string;
    lastName?: string;
    avatarUrl?: string;
    bio?: string;
    country?: string;
  };
}

export interface JwtPayload {
  sub: string;
  primaryWallet?: string;
  walletAddress?: string;
  email?: string;
  roles: UserRole[];
  permissions?: Permission[];
  [key: string]: any;
}
