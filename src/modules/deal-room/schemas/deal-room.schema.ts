import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import {
  Document as MongooseDocument,
  Schema as MongooseSchema,
  Types,
} from 'mongoose';
import type { DocumentMetadata } from '../types';
import { AccessAction, DocumentState, AccessLevel } from '../types';

export type DealDocumentDocument = DealDocument & MongooseDocument;
export type FolderDocument = Folder & MongooseDocument;
export type AccessLogDocument = AccessLog & MongooseDocument;

@Schema({ timestamps: true })
export class DealDocument {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  uploaderId!: Types.ObjectId;

  @Prop({ required: true })
  filename!: string;

  @Prop({ required: true })
  mimeType!: string;

  @Prop({ type: Number, required: true })
  size!: number;

  @Prop({ required: true, unique: true })
  storageKey!: string;

  @Prop()
  thumbKey?: string;

  @Prop({
    type: {
      description: { type: String },
      tags: { type: [String], default: [] },
      category: { type: String },
      version: { type: Number, default: 1 },
      relatedMilestoneId: { type: MongooseSchema.Types.ObjectId },
    },
    default: {},
  })
  metadata!: DocumentMetadata;

  @Prop({
    type: [
      {
        userId: { type: MongooseSchema.Types.ObjectId },
        role: { type: String },
        accessLevel: { type: String, enum: AccessLevel, required: true },
        expiresAt: { type: Date },
      },
    ],
    default: [],
  })
  acl!: {
    userId?: Types.ObjectId;
    role?: string;
    accessLevel: AccessLevel;
    expiresAt?: Date;
  }[];

  @Prop({ type: String, enum: DocumentState, default: DocumentState.DRAFT })
  state!: DocumentState;

  @Prop()
  checksum?: string;

  @Prop({ type: Boolean, default: true })
  encrypted!: boolean;

  @Prop({ type: Date })
  createdAt!: Date;

  @Prop({ type: Date })
  updatedAt!: Date;
}

@Schema({ timestamps: true })
export class Folder {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ required: true })
  name!: string;

  @Prop({ type: MongooseSchema.Types.ObjectId, default: null })
  parentFolderId?: Types.ObjectId | null;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  createdBy!: Types.ObjectId;
}

@Schema({ timestamps: { createdAt: true, updatedAt: false } })
export class AccessLog {
  @Prop({ type: MongooseSchema.Types.ObjectId, required: true, index: true })
  documentId!: Types.ObjectId;

  @Prop({ type: MongooseSchema.Types.ObjectId, required: true })
  userId!: Types.ObjectId;

  @Prop({ type: String, enum: AccessAction, required: true })
  action!: AccessAction;

  @Prop()
  ipAddress?: string;

  @Prop()
  userAgent?: string;

  @Prop()
  walletAddress?: string;

  @Prop({ type: Date, default: Date.now })
  timestamp!: Date;
}

export const DealDocumentSchema = SchemaFactory.createForClass(DealDocument);
export const FolderSchema = SchemaFactory.createForClass(Folder);
export const AccessLogSchema = SchemaFactory.createForClass(AccessLog);

DealDocumentSchema.index({ projectId: 1, 'metadata.tags': 1 });
DealDocumentSchema.index({ storageKey: 1 }, { unique: true });
AccessLogSchema.index({ documentId: 1, timestamp: -1 });
