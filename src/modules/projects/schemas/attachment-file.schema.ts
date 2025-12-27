import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

export type ProjectAttachmentFileDocument = HydratedDocument<ProjectAttachmentFile>;

@Schema({
  collection: 'project_attachment_files',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class ProjectAttachmentFile {
  @Prop({ type: Types.ObjectId, required: true, index: true })
  projectId!: Types.ObjectId;

  @Prop({ type: String, required: true, trim: true })
  filename!: string;

  @Prop({ type: String, trim: true })
  mimeType?: string;

  @Prop({ type: Number })
  size?: number;

  @Prop({ type: Buffer, required: true })
  data!: Buffer;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const ProjectAttachmentFileSchema =
  SchemaFactory.createForClass(ProjectAttachmentFile);
