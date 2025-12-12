import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ProjectType } from '../../../common/enums/project-type.enum';

export type AgreementTemplateDocument = HydratedDocument<AgreementTemplate>;

@Schema({
  collection: 'project_agreement_templates',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
})
export class AgreementTemplate {
  @Prop({ type: String, enum: ProjectType, required: true, index: true })
  projectType!: ProjectType;

  @Prop({ type: String, trim: true, index: true })
  category?: string;

  @Prop({ type: String, trim: true, index: true })
  industry?: string;

  @Prop({ type: String, required: true, trim: true, maxlength: 200 })
  title!: string;

  @Prop({ type: String, trim: true, maxlength: 2000 })
  description?: string;

  @Prop({ type: Boolean, default: true })
  requiresAcceptance!: boolean;

  @Prop({ type: Boolean, default: true })
  isActive!: boolean;

  @Prop({ type: Number, default: 1, min: 1 })
  version!: number;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const AgreementTemplateSchema =
  SchemaFactory.createForClass(AgreementTemplate);

AgreementTemplateSchema.index(
  { projectType: 1, category: 1, industry: 1, isActive: 1 },
  { name: 'template_scope_idx' },
);
