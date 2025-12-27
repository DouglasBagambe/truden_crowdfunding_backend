import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { AuditLog, AuditLogDocument } from './schemas/audit-log.schema';

export interface AuditLogInput {
  action: string;
  actorId: string | Types.ObjectId;
  actorRoles?: string[];
  targetType?: string;
  targetId?: string;
  metadata?: Record<string, unknown>;
  ip?: string;
  userAgent?: string;
}

@Injectable()
export class AuditService {
  constructor(
    @InjectModel(AuditLog.name)
    private readonly auditModel: Model<AuditLogDocument>,
  ) {}

  async log(entry: AuditLogInput) {
    const actorId =
      typeof entry.actorId === 'string'
        ? new Types.ObjectId(entry.actorId)
        : entry.actorId;
    await this.auditModel.create({
      action: entry.action,
      actorId,
      actorRoles: entry.actorRoles ?? [],
      targetType: entry.targetType,
      targetId: entry.targetId,
      metadata: entry.metadata,
      ip: entry.ip,
      userAgent: entry.userAgent,
    });
  }
}
