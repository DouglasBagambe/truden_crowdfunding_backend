import { UserRole, KYCStatus } from '../enums/role.enum';

export interface IUser {
  id: string;
  email?: string;
  password?: string;
  primaryWallet?: string;
  linkedWallets?: string[];
  roles: UserRole[];
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
  [key: string]: any;
}
