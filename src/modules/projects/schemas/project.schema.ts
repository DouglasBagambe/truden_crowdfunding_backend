import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { Schema as MongooseSchema } from 'mongoose';
import { CharityCategory } from '../../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../../common/enums/charity-subcategory.enum';
import { ROIIndustry } from '../../../common/enums/roi-industry.enum';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({
  collection: 'projects',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  discriminatorKey: 'type',
})
export class Project {
  @Prop({ required: true, trim: true, index: true })
  creatorId!: string;

  @Prop({
    required: true,
    type: String,
    enum: ProjectType,
    index: true,
    default: ProjectType.ROI,
  })
  type!: ProjectType;

  @Prop({ required: true, trim: true, index: true, alias: 'title' })
  name!: string;

  @Prop({ required: true, trim: true })
  summary!: string;

  @Prop({ required: true, trim: true, alias: 'description' })
  story!: string;

  @Prop({ required: true, trim: true })
  country!: string;

  @Prop({ trim: true })
  location?: string;

  @Prop({ required: true, trim: true })
  beneficiary!: string;

  @Prop({ required: true, trim: true })
  paymentMethod!: string;

  @Prop({ type: [String], default: [] })
  tags!: string[];

  // Type-only hints for discriminator properties; actual schema is on child classes
  declare category?: string;
  declare subcategory?: string;
  declare industry?: string;
  declare risks?: string;

  @Prop({ type: [String], default: [] })
  videoUrls!: string[];

  @Prop({
    type: [
      {
        platform: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
      },
    ],
    default: [],
  })
  socialLinks!: Array<{
    platform: string;
    url: string;
  }>;

  @Prop({ trim: true })
  website?: string;

  @Prop({
    type: String,
    enum: ProjectStatus,
    default: ProjectStatus.DRAFT,
    index: true,
  })
  status!: ProjectStatus;

  @Prop({ required: true, min: 0 })
  targetAmount!: number;

  @Prop({ required: true, trim: true })
  currency!: string;

  @Prop({ type: Date, alias: 'fundingStartAt' })
  fundingStartDate?: Date;

  @Prop({ type: Date, alias: 'fundingEndAt' })
  fundingEndDate?: Date;

  @Prop({ type: String, trim: true })
  decisionReason?: string;

  @Prop({ type: Boolean, default: true })
  requiresAgreement!: boolean;

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        url: { type: String, required: true, trim: true },
        type: { type: String, trim: true },
        isRequired: { type: Boolean, default: false },
      },
    ],
    default: [],
  })
  attachments!: Array<{
    title: string;
    url: string;
    type?: string;
    isRequired?: boolean;
  }>;

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        requiresAcceptance: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  agreements!: Array<{
    title: string;
    description?: string;
    requiresAcceptance: boolean;
  }>;

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        requiresAcceptance: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  roiAgreements!: Array<{
    title: string;
    description?: string;
    requiresAcceptance: boolean;
  }>;

  @Prop({
    type: [
      {
        title: { type: String, required: true, trim: true },
        description: { type: String, trim: true },
        requiresAcceptance: { type: Boolean, default: true },
      },
    ],
    default: [],
  })
  charityAgreements!: Array<{
    title: string;
    description?: string;
    requiresAcceptance: boolean;
  }>;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

export class ROIProject extends Project {
  @Prop({ required: true, trim: true, index: true, enum: ROIIndustry })
  declare industry: string;

  @Prop({ trim: true })
  declare risks?: string;
}

export class CharityProject extends Project {
  @Prop({ required: true, trim: true, index: true, enum: CharityCategory })
  declare category: string;

  @Prop({ trim: true, enum: CharitySubcategory })
  declare subcategory?: string;
}

export const ROIProjectSchema = SchemaFactory.createForClass(ROIProject);
export const CharityProjectSchema =
  SchemaFactory.createForClass(CharityProject);

ProjectSchema.discriminator(
  ProjectType.ROI,
  ROIProjectSchema as MongooseSchema,
);
ProjectSchema.discriminator(
  ProjectType.CHARITY,
  CharityProjectSchema as MongooseSchema,
);

ProjectSchema.index({
  title: 'text',
  description: 'text',
  name: 'text',
  summary: 'text',
  story: 'text',
  beneficiary: 'text',
  category: 'text',
  subcategory: 'text',
  industry: 'text',
  tags: 'text',
  location: 'text',
});

ProjectSchema.pre('validate', function (next) {
  const doc = this as unknown as Project &
    Partial<ROIProject> &
    Partial<CharityProject>;
  if (!doc.type) {
    return next(new Error('Project type is required'));
  }

  if (doc.type === ProjectType.CHARITY) {
    if (!doc.category) {
      return next(new Error('Charity projects must include a category'));
    }
    if (doc.industry) {
      return next(new Error('Charity projects cannot set industry'));
    }
    if (doc.roiAgreements && doc.roiAgreements.length) {
      return next(new Error('Charity projects cannot set ROI agreements'));
    }
  }

  if (doc.type === ProjectType.ROI) {
    if (!doc.industry) {
      return next(new Error('ROI projects must include an industry'));
    }
    if (doc.category || doc.subcategory) {
      return next(new Error('ROI projects cannot set category or subcategory'));
    }
    if (doc.charityAgreements && doc.charityAgreements.length) {
      return next(new Error('ROI projects cannot set charity agreements'));
    }
  }

  return next();
});
