import { Types } from 'mongoose';

export type ObjectId = Types.ObjectId;

export enum DocumentState {
  DRAFT = 'DRAFT',
  PUBLISHED = 'PUBLISHED',
  REVOKED = 'REVOKED',
}

export enum DocumentCategory {
  LEGAL = 'LEGAL',
  FINANCIAL = 'FINANCIAL',
  TECH = 'TECH',
  PITCH = 'PITCH',
  MISC = 'MISC',
}

export enum AccessLevel {
  READ = 'READ',
  DOWNLOAD = 'DOWNLOAD',
  ANNOTATE = 'ANNOTATE',
  MANAGE = 'MANAGE',
}

export enum AccessAction {
  UPLOAD = 'UPLOAD',
  DOWNLOAD = 'DOWNLOAD',
  VIEW = 'VIEW',
  GRANT_ACCESS = 'GRANT_ACCESS',
  REVOKE_ACCESS = 'REVOKE_ACCESS',
  DELETE = 'DELETE',
}

export interface DocumentMetadata {
  description?: string;
  tags?: string[];
  category?: DocumentCategory | string;
  version?: number;
  relatedMilestoneId?: ObjectId;
}

export interface AclEntry {
  userId?: ObjectId;
  role?: string;
  accessLevel: AccessLevel | string;
  expiresAt?: Date;
}
