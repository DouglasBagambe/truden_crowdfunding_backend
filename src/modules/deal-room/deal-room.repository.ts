import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type FilterQuery } from 'mongoose';
import {
  DealDocument,
  DealDocumentDocument,
  Folder,
  FolderDocument,
  AccessLog,
  AccessLogDocument,
} from './schemas/deal-room.schema';
import { AccessAction, DocumentCategory, DocumentState } from './types';
import type { AclEntry } from './types';

interface ListFilters {
  category?: DocumentCategory;
  tags?: string[];
}

@Injectable()
export class DealRoomRepository {
  constructor(
    @InjectModel(DealDocument.name)
    private readonly documentModel: Model<DealDocumentDocument>,
    @InjectModel(Folder.name)
    private readonly folderModel: Model<FolderDocument>,
    @InjectModel(AccessLog.name)
    private readonly accessLogModel: Model<AccessLogDocument>,
  ) {}

  async createDocument(
    data: Partial<DealDocument>,
  ): Promise<DealDocumentDocument> {
    const doc = new this.documentModel(data);
    return doc.save();
  }

  async updateDocumentAcl(
    documentId: Types.ObjectId,
    acl: AclEntry[],
  ): Promise<DealDocumentDocument | null> {
    return this.documentModel
      .findByIdAndUpdate(documentId, { $set: { acl } }, { new: true })
      .exec();
  }

  async findDocumentById(
    id: Types.ObjectId,
  ): Promise<DealDocumentDocument | null> {
    return this.documentModel.findById(id).exec();
  }

  async listDocumentsByProject(
    projectId: Types.ObjectId,
    filters: ListFilters,
    page: number,
    pageSize: number,
    sort: 'createdAt' | 'filename' | 'size' = 'createdAt',
  ): Promise<{ items: DealDocumentDocument[]; total: number }> {
    const query: FilterQuery<DealDocumentDocument> = {
      projectId,
      state: { $ne: DocumentState.REVOKED },
    };

    if (filters.category) {
      query['metadata.category'] = filters.category;
    }

    if (filters.tags && filters.tags.length > 0) {
      query['metadata.tags'] = { $in: filters.tags };
    }

    const sortSpec: Record<string, 1 | -1> =
      sort === 'filename'
        ? { filename: 1 }
        : sort === 'size'
          ? { size: -1 }
          : { createdAt: -1 };

    const [items, total] = await Promise.all([
      this.documentModel
        .find(query)
        .sort(sortSpec)
        .skip((page - 1) * pageSize)
        .limit(pageSize)
        .exec(),
      this.documentModel.countDocuments(query).exec(),
    ]);

    return { items, total };
  }

  async createFolder(data: Partial<Folder>): Promise<FolderDocument> {
    const folder = new this.folderModel(data);
    return folder.save();
  }

  async createAccessLog(params: {
    documentId: Types.ObjectId;
    userId: Types.ObjectId;
    action: AccessAction;
    ipAddress?: string;
    userAgent?: string;
    walletAddress?: string;
  }): Promise<AccessLogDocument> {
    const log = new this.accessLogModel(params);
    return log.save();
  }

  async getAccessLogsForProject(
    projectId: Types.ObjectId,
  ): Promise<AccessLogDocument[]> {
    const docs = await this.documentModel
      .find({ projectId })
      .select('_id')
      .exec();

    const ids = docs.map((d) => d._id);
    if (ids.length === 0) {
      return [];
    }

    return this.accessLogModel
      .find({ documentId: { $in: ids } })
      .sort({ timestamp: -1 })
      .exec();
  }
}
