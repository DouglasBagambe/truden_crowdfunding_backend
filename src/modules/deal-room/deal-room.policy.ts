import { Injectable } from '@nestjs/common';
import { Types } from 'mongoose';
import type { DealDocumentDocument } from './schemas/deal-room.schema';
import { AccessLevel, DocumentCategory, DocumentState } from './types';
import { UserRole } from '../../common/enums/role.enum';

@Injectable()
export class DealRoomPolicy {
  private getLevelRank(level: AccessLevel): number {
    switch (level) {
      case AccessLevel.READ:
        return 1;
      case AccessLevel.DOWNLOAD:
        return 2;
      case AccessLevel.ANNOTATE:
        return 3;
      case AccessLevel.MANAGE:
        return 4;
      default:
        return 0;
    }
  }

  private hasLevel(required: AccessLevel, actual: AccessLevel): boolean {
    return this.getLevelRank(actual) >= this.getLevelRank(required);
  }

  private userMatches(userId: string, entryUserId?: Types.ObjectId): boolean {
    if (!entryUserId) return false;
    return entryUserId.toHexString() === userId;
  }

  canRead(
    document: DealDocumentDocument,
    userId: string,
    roles: UserRole[],
  ): boolean {
    return this.hasAccess(document, userId, roles, AccessLevel.READ);
  }

  canDownload(
    document: DealDocumentDocument,
    userId: string,
    roles: UserRole[],
  ): boolean {
    return this.hasAccess(document, userId, roles, AccessLevel.DOWNLOAD);
  }

  canManage(
    document: DealDocumentDocument,
    userId: string,
    roles: UserRole[],
  ): boolean {
    return this.hasAccess(document, userId, roles, AccessLevel.MANAGE);
  }

  summarizePermissions(
    document: DealDocumentDocument,
    userId: string,
    roles: UserRole[],
  ): {
    canRead: boolean;
    canDownload: boolean;
    canAnnotate: boolean;
    canManage: boolean;
  } {
    const canRead = this.canRead(document, userId, roles);
    const canDownload = this.canDownload(document, userId, roles);
    const canAnnotate = this.hasAccess(
      document,
      userId,
      roles,
      AccessLevel.ANNOTATE,
    );
    const canManage = this.canManage(document, userId, roles);
    return { canRead, canDownload, canAnnotate, canManage };
  }

  private hasAccess(
    document: DealDocumentDocument,
    userId: string,
    roles: UserRole[],
    required: AccessLevel,
  ): boolean {
    if (document.state === DocumentState.REVOKED) {
      return false;
    }

    const now = new Date();

    // Direct user ACL
    for (const entry of document.acl) {
      if (
        this.userMatches(userId, entry.userId) &&
        (!entry.expiresAt || entry.expiresAt > now) &&
        this.hasLevel(required, entry.accessLevel as AccessLevel)
      ) {
        return true;
      }
    }

    // Role-based ACL
    for (const entry of document.acl) {
      if (!entry.role) continue;
      if (!roles.includes(entry.role as UserRole)) continue;
      if (entry.expiresAt && entry.expiresAt <= now) continue;
      if (this.hasLevel(required, entry.accessLevel as AccessLevel)) {
        return true;
      }
    }

    // Admin override
    if (roles.includes(UserRole.ADMIN)) {
      return true;
    }

    // KYC gating for FINANCIAL docs is not enforced yet; can be added here later.
    if (document.metadata?.category === DocumentCategory.FINANCIAL) {
      // TODO: integrate KYC checks using user profile.
    }

    return false;
  }
}
