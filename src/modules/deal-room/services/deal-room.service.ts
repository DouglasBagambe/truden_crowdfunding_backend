import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import type { JwtPayload } from '../../../common/interfaces/user.interface';
import { DealRoomRepository } from '../deal-room.repository';
import { DealRoomStorageService } from '../deal-room.storage';
import { DealRoomPolicy } from '../deal-room.policy';
import { UploadDto } from '../dto/upload.dto';
import { SearchDto } from '../dto/search.dto';
import { GrantAccessDto } from '../dto/grant-access.dto';
import { RevokeAccessDto } from '../dto/revoke-access.dto';
import { AccessAction, AccessLevel, DocumentState } from '../types';
import { DealRoomEvents } from '../events';

type UploadedFile = {
  originalname: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class DealRoomService {
  constructor(
    private readonly repository: DealRoomRepository,
    private readonly storage: DealRoomStorageService,
    private readonly policy: DealRoomPolicy,
  ) {}

  async uploadFile(
    user: JwtPayload,
    file: UploadedFile | undefined,
    dto: UploadDto,
  ) {
    if (!file) {
      throw new BadRequestException('File is required');
    }

    if (!Types.ObjectId.isValid(dto.projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    const projectId = new Types.ObjectId(dto.projectId);

    const maxSize = Number(process.env.DEALROOM_MAX_FILE_SIZE ?? 104_857_600); // 100MB default
    if (file.size > maxSize) {
      throw new BadRequestException('File is too large');
    }

    const storageKey = this.storage.generateStorageKey(
      dto.projectId,
      file.originalname,
    );
    await this.storage.uploadPlaceholder(storageKey);

    const encrypted = dto.encrypted ?? true;

    const uploaderId = new Types.ObjectId(user.sub);

    const document = await this.repository.createDocument({
      projectId,
      uploaderId,
      filename: file.originalname,
      mimeType: file.mimetype,
      size: file.size,
      storageKey,
      metadata: {
        description: dto.description,
        tags: dto.tags,
        category: dto.category,
        relatedMilestoneId: dto.relatedMilestoneId
          ? new Types.ObjectId(dto.relatedMilestoneId)
          : undefined,
        version: 1,
      },
      acl: [
        {
          userId: uploaderId,
          accessLevel: AccessLevel.MANAGE,
        },
      ],
      state: DocumentState.DRAFT,
      encrypted,
    });

    await this.repository.createAccessLog({
      documentId: document._id,
      userId: uploaderId,
      action: AccessAction.UPLOAD,
    });

    // Event hook placeholder
    void DealRoomEvents.DOCUMENT_UPLOADED;

    return {
      success: true,
      documentId: document._id.toHexString(),
    };
  }

  async listProjectFiles(
    user: JwtPayload,
    projectId: string,
    query: SearchDto,
  ) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 20;
    const sort =
      (query.sort as 'createdAt' | 'filename' | 'size') || 'createdAt';

    const { items, total } = await this.repository.listDocumentsByProject(
      new Types.ObjectId(projectId),
      {
        category: query.category,
        tags: query.tags,
      },
      page,
      pageSize,
      sort,
    );

    const visible: Array<{
      id: string;
      filename: string;
      mimeType: string;
      size: number;
      category?: unknown;
      tags: string[];
      state: DocumentState;
      canDownload: boolean;
      canAnnotate: boolean;
      canManage: boolean;
      createdAt: Date;
    }> = [];

    for (const doc of items) {
      const perms = this.policy.summarizePermissions(doc, user.sub, user.roles);

      if (!perms.canRead) {
        continue;
      }

      visible.push({
        id: doc._id.toHexString(),
        filename: doc.filename,
        mimeType: doc.mimeType,
        size: doc.size,
        category: doc.metadata?.category,
        tags: doc.metadata?.tags ?? [],
        state: doc.state,
        canDownload: perms.canDownload,
        canAnnotate: perms.canAnnotate,
        canManage: perms.canManage,
        createdAt: doc.createdAt,
      });
    }

    return {
      items: visible,
      total,
      page,
      pageSize,
    };
  }

  async getPreviewUrl(user: JwtPayload, documentId: string) {
    const doc = await this.getDocumentForUser(documentId, user, 'READ');

    const { url, expiresIn } = await this.storage.getPresignedUrl(
      doc.thumbKey || doc.storageKey,
      Number(process.env.S3_URL_EXPIRY_SECONDS ?? 60),
    );

    await this.repository.createAccessLog({
      documentId: doc._id,
      userId: new Types.ObjectId(user.sub),
      action: AccessAction.VIEW,
    });

    return { url, expiresIn };
  }

  async getDownloadUrl(user: JwtPayload, documentId: string) {
    const doc = await this.getDocumentForUser(documentId, user, 'DOWNLOAD');

    const { url, expiresIn } = await this.storage.getPresignedUrl(
      doc.storageKey,
      Number(process.env.S3_URL_EXPIRY_SECONDS ?? 60),
    );

    await this.repository.createAccessLog({
      documentId: doc._id,
      userId: new Types.ObjectId(user.sub),
      action: AccessAction.DOWNLOAD,
    });

    return { url, expiresIn };
  }

  async grantAccess(user: JwtPayload, dto: GrantAccessDto) {
    const doc = await this.getDocumentForUser(dto.documentId, user, 'MANAGE');

    const acl = [...doc.acl];

    const entry = {
      userId: dto.granteeUserId
        ? new Types.ObjectId(dto.granteeUserId)
        : undefined,
      role: dto.role,
      accessLevel: dto.accessLevel,
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
    };

    acl.push(entry);

    await this.repository.updateDocumentAcl(doc._id, acl);

    await this.repository.createAccessLog({
      documentId: doc._id,
      userId: new Types.ObjectId(user.sub),
      action: AccessAction.GRANT_ACCESS,
    });

    void DealRoomEvents.ACCESS_GRANTED;

    return { success: true };
  }

  async revokeAccess(user: JwtPayload, dto: RevokeAccessDto) {
    const doc = await this.getDocumentForUser(dto.documentId, user, 'MANAGE');

    let acl = [...doc.acl];

    if (dto.revokeAll) {
      acl = [];
    } else if (dto.granteeUserId) {
      acl = acl.filter((entry) => {
        if (!entry.userId) return true;
        return entry.userId.toHexString() !== dto.granteeUserId;
      });
    }

    await this.repository.updateDocumentAcl(doc._id, acl);

    await this.repository.createAccessLog({
      documentId: doc._id,
      userId: new Types.ObjectId(user.sub),
      action: AccessAction.REVOKE_ACCESS,
    });

    void DealRoomEvents.ACCESS_REVOKED;

    return { success: true };
  }

  async deleteDocument(user: JwtPayload, documentId: string) {
    const doc = await this.getDocumentForUser(documentId, user, 'MANAGE');

    doc.state = DocumentState.REVOKED;
    await doc.save();

    await this.repository.createAccessLog({
      documentId: doc._id,
      userId: new Types.ObjectId(user.sub),
      action: AccessAction.DELETE,
    });

    void DealRoomEvents.DOCUMENT_DELETED;

    return { success: true };
  }

  async getAuditLogs(user: JwtPayload, projectId: string) {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    // Only admins should reach this, controller is protected with Roles guard.
    const logs = await this.repository.getAccessLogsForProject(
      new Types.ObjectId(projectId),
    );

    return logs.map((log) => ({
      documentId: log.documentId.toHexString(),
      userId: log.userId.toHexString(),
      action: log.action,
      ipAddress: log.ipAddress,
      userAgent: log.userAgent,
      walletAddress: log.walletAddress,
      timestamp: log.timestamp,
    }));
  }

  private async getDocumentForUser(
    documentId: string,
    user: JwtPayload,
    level: 'READ' | 'DOWNLOAD' | 'MANAGE',
  ) {
    if (!Types.ObjectId.isValid(documentId)) {
      throw new BadRequestException('Invalid documentId');
    }

    const doc = await this.repository.findDocumentById(
      new Types.ObjectId(documentId),
    );

    if (!doc) {
      throw new NotFoundException('Document not found');
    }

    let allowed = false;

    if (level === 'READ') {
      allowed = this.policy.canRead(doc, user.sub, user.roles);
    } else if (level === 'DOWNLOAD') {
      allowed = this.policy.canDownload(doc, user.sub, user.roles);
    } else if (level === 'MANAGE') {
      allowed = this.policy.canManage(doc, user.sub, user.roles);
    }

    if (!allowed) {
      throw new ForbiddenException('Access denied');
    }

    return doc;
  }
}
