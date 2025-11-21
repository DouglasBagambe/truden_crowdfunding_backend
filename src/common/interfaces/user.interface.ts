import { UserRole, KYCStatus } from '../enums/role.enum';

export interface IUser {
  id: string;
  email?: string;
  password?: string;
  walletAddress?: string;
  role: UserRole[];
  kycStatus: KYCStatus;
  nonce?: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  lastLogin?: Date;
  profile: {
    firstName?: string;
    lastName?: string;
    avatar?: string;
    bio?: string;
  };
}

export interface JwtPayload {
  sub: string;
  email?: string;
  walletAddress?: string;
  roles: UserRole[];
  [key: string]: any;
}
