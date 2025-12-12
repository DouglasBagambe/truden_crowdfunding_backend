import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { CharityCategory } from '../../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../../common/enums/charity-subcategory.enum';
import { ROIIndustry } from '../../../common/enums/roi-industry.enum';

export type ProjectDocument = HydratedDocument<Project>;

@Schema({
  collection: 'projects',
  timestamps: { createdAt: 'createdAt', updatedAt: 'updatedAt' },
  discriminatorKey: 'projectType',
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
    alias: 'type',
  })
  projectType!: ProjectType;

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

  @Prop({ trim: true, enum: CharityCategory })
  category?: CharityCategory;

  @Prop({ trim: true, enum: CharitySubcategory })
  subcategory?: CharitySubcategory;

  @Prop({ trim: true, enum: ROIIndustry })
  industry?: ROIIndustry;

  @Prop({ trim: true })
  risks?: string;

  @Prop({ type: [String], default: [] })
  videoUrls!: string[];

  @Prop({ type: [String], default: [] })
  galleryImages!: string[];

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
        templateId: { type: String, trim: true },
        templateVersion: { type: Number },
        requestedBy: { type: String, trim: true },
        requestedAt: { type: Date },
      },
    ],
    default: [],
  })
  attachments!: Array<{
    title: string;
    url: string;
    type?: string;
    isRequired?: boolean;
    templateId?: string;
    templateVersion?: number;
    requestedBy?: string;
    requestedAt?: Date;
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
        item: { type: String, trim: true },
        description: { type: String, trim: true },
        amount: { type: Number, min: 0 },
        percentage: { type: Number, min: 0 },
      },
    ],
    default: [],
  })
  useOfFunds!: Array<{
    item?: string;
    description?: string;
    amount?: number;
    percentage?: number;
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

  @Prop({ type: [String], default: [] })
  riskFactors!: string[];

  @Prop({ type: [String], default: [] })
  disclosures!: string[];

  @Prop({ type: [String], default: [] })
  verificationBadges!: string[];

  @Prop({ type: [String], default: [] })
  highlights!: string[];

  @Prop({ type: Number, default: 0, min: 0 })
  raisedAmount!: number;

  @Prop({ type: Number, default: 0, min: 0 })
  backerCount!: number;

  @Prop({
    type: [
      {
        performedBy: { type: String, required: true, trim: true },
        role: { type: String, trim: true },
        summary: { type: String, required: true, trim: true },
        decision: {
          type: String,
          enum: ['approve', 'reject', 'needs_more_info'],
          required: true,
        },
        evidenceUrls: { type: [String], default: [] },
        attachments: {
          type: [
            {
              title: { type: String, required: true, trim: true },
              url: { type: String, required: true, trim: true },
              type: { type: String, trim: true },
              isRequired: { type: Boolean, default: false },
            },
          ],
          default: [],
        },
        createdAt: { type: Date, default: Date.now },
      },
    ],
    default: [],
  })
  verificationLogs!: Array<{
    performedBy: string;
    role?: string;
    summary: string;
    decision: 'approve' | 'reject' | 'needs_more_info';
    evidenceUrls?: string[];
    attachments?: Array<{
      title: string;
      url: string;
      type?: string;
      isRequired?: boolean;
    }>;
    createdAt?: Date;
  }>;

  @Prop({ type: Date })
  lastVerifiedAt?: Date;

  @Prop({ type: Date })
  createdAt?: Date;

  @Prop({ type: Date })
  updatedAt?: Date;
}

export const ProjectSchema = SchemaFactory.createForClass(Project);

export class ROIProject {
  @Prop({ required: true, trim: true, index: true, enum: ROIIndustry })
  declare industry: string;

  @Prop({ trim: true })
  declare risks?: string;
}

export class CharityProject {
  @Prop({ required: true, trim: true, index: true, enum: CharityCategory })
  declare category: string;

  @Prop({ trim: true, enum: CharitySubcategory })
  declare subcategory?: string;
}

export const ROIProjectSchema = SchemaFactory.createForClass(ROIProject);
export const CharityProjectSchema =
  SchemaFactory.createForClass(CharityProject);

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
  highlights: 'text',
});

ProjectSchema.pre('validate', function (next) {
  const doc = this as unknown as Project &
    Partial<ROIProject> &
    Partial<CharityProject>;
  if (!doc.projectType) {
    return next(new Error('Project type is required'));
  }

  if (doc.projectType === ProjectType.CHARITY) {
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

  if (doc.projectType === ProjectType.ROI) {
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
