import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ProjectType } from '../../../common/enums/project-type.enum';

export type AttachmentRequirementDocument = HydratedDocument<AttachmentRequirement>;

@Schema({
  collection: 'project_attachment_requirements',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class AttachmentRequirement {
  @Prop({ type: String, enum: ProjectType, required: true, index: true })
  projectType!: ProjectType;

  @Prop({ type: String, trim: true, index: true })
  category?: string;

  @Prop({ type: String, trim: true, index: true })
  subcategory?: string;

  @Prop({ type: String, trim: true, index: true })
  industry?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 2000 })
  description?: string;

  @Prop({ type: Boolean, default: true })
  isRequired!: boolean;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const AttachmentRequirementSchema =
  SchemaFactory.createForClass(AttachmentRequirement);

AttachmentRequirementSchema.index(
  {
    projectType: 1,
    category: 1,
    subcategory: 1,
    industry: 1,
    isActive: 1,
  },
  { name: 'attachment_requirement_scope_idx' },
);
