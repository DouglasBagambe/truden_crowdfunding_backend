import { Type, Transform } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import {
  ApiProperty,
  ApiPropertyOptional,
} from '../../../common/swagger.decorators';
import { ProjectStatus } from '../../../common/enums/project-status.enum';
import { ProjectType } from '../../../common/enums/project-type.enum';
import { CharityCategory } from '../../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../../common/enums/charity-subcategory.enum';
import { ROIIndustry } from '../../../common/enums/roi-industry.enum';
import { AgreementRuleDto } from './agreement-rule.dto';
import { UseOfFundsDto } from './use-of-funds.dto';
import { MilestoneDto } from './milestone.dto';
import { DocumentAttachmentDto } from './document-attachment.dto';
import { SocialLinkDto } from './social-link.dto';

const toDate = (value: unknown) =>
  value ? new Date(value as string) : undefined;
const toStringArray = (value: unknown): string[] | undefined => {
  if (Array.isArray(value)) return value as string[];
  if (typeof value === 'string') {
    return value
      .split(',')
      .map((v) => v.trim())
      .filter((v) => v.length > 0);
  }
  return undefined;
};

export class CreateProjectDto {
  @ApiProperty({
    description: 'Project type: ROI or CHARITY',
    enum: ProjectType,
  })
  @IsEnum(ProjectType)
  type!: ProjectType;

  @ApiProperty({ description: 'Project name' })
  @IsString()
  @Length(4, 200)
  name!: string;

  @ApiProperty({ description: 'Brief summary of the project' })
  @IsString()
  @Length(4, 500)
  summary!: string;

  @ApiProperty({ description: 'Full story/description of the project' })
  @IsString()
  @Length(10, 8000)
  story!: string;

  @ApiProperty({ description: 'Primary country of operation/registration' })
  @IsString()
  @Length(2, 128)
  country!: string;

  @ApiPropertyOptional({ description: 'City/location of the project' })
  @IsOptional()
  @IsString()
  @Length(2, 128)
  location?: string;

  @ApiProperty({ description: 'Who benefits from the project funds' })
  @IsString()
  @Length(2, 256)
  beneficiary!: string;

  @ApiPropertyOptional({
    description: 'Tags for quick filtering (comma separated or array)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(30)
  @IsString({ each: true })
  @Transform(({ value }) => toStringArray(value))
  tags?: string[];

  @ApiPropertyOptional({
    description: 'Optional video URLs (pitches, demos)',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  @Transform(({ value }) => toStringArray(value))
  videoUrls?: string[];

  @ApiPropertyOptional({
    description: 'Gallery images for the project',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsUrl({}, { each: true })
  @Transform(({ value }) => toStringArray(value))
  galleryImages?: string[];

  @ApiPropertyOptional({
    description: 'Social links for the project/beneficiary',
    type: [SocialLinkDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => SocialLinkDto)
  socialLinks?: SocialLinkDto[];

  @ApiPropertyOptional({ description: 'Official project website' })
  @IsOptional()
  @IsUrl()
  website?: string;

  @ApiProperty({ description: 'Preferred payment method for contributions' })
  @IsString()
  @Length(2, 128)
  paymentMethod!: string;

  @ApiPropertyOptional({
    description: 'Category (for CHARITY projects)',
    enum: CharityCategory,
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.CHARITY)
  @IsEnum(CharityCategory)
  category?: CharityCategory;

  @ApiPropertyOptional({
    description: 'Subcategory (for CHARITY projects)',
    enum: CharitySubcategory,
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.CHARITY)
  @IsEnum(CharitySubcategory)
  subcategory?: CharitySubcategory;

  @ApiPropertyOptional({
    description: 'Industry (for ROI projects)',
    enum: ROIIndustry,
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.ROI)
  @IsEnum(ROIIndustry)
  industry?: ROIIndustry;

  @ApiPropertyOptional({ description: 'Risks and challenges (ROI projects)' })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.ROI)
  @IsOptional()
  @IsString()
  @Length(0, 4000)
  risks?: string;

  @ApiProperty({ description: 'Target amount required for funding' })
  @IsNumber()
  @Min(0)
  targetAmount!: number;

  @ApiProperty({ description: 'Currency symbol/ticker for target amount' })
  @IsString()
  @Length(1, 16)
  currency!: string;

  @ApiPropertyOptional({ description: 'Funding collection start date' })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => toDate(value))
  fundingStartDate?: Date;

  @ApiPropertyOptional({ description: 'Funding collection end date' })
  @IsOptional()
  @IsDate()
  @Transform(({ value }) => toDate(value))
  fundingEndDate?: Date;

  @ApiPropertyOptional({
    description: 'Milestones associated with the project',
    type: [MilestoneDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => MilestoneDto)
  milestones?: MilestoneDto[];

  @ApiPropertyOptional({
    description:
      'Supporting attachments (required verification docs + additional materials)',
    type: [DocumentAttachmentDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(50)
  @ValidateNested({ each: true })
  @Type(() => DocumentAttachmentDto)
  attachments?: DocumentAttachmentDto[];

  @ApiPropertyOptional({
    description:
      'Rules/agreements investors must accept for this project (type-specific preferred)',
    type: [AgreementRuleDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgreementRuleDto)
  agreements?: AgreementRuleDto[];

  @ApiPropertyOptional({
    description: 'Agreements for ROI projects',
    type: [AgreementRuleDto],
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.ROI)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgreementRuleDto)
  roiAgreements?: AgreementRuleDto[];

  @ApiPropertyOptional({
    description: 'Agreements for Charity projects',
    type: [AgreementRuleDto],
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.CHARITY)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => AgreementRuleDto)
  charityAgreements?: AgreementRuleDto[];

  @ApiPropertyOptional({
    description: 'Use of funds breakdown (short list)',
    type: [UseOfFundsDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @ValidateNested({ each: true })
  @Type(() => UseOfFundsDto)
  useOfFunds?: UseOfFundsDto[];

  @ApiPropertyOptional({
    description: 'Risk factors for ROI projects',
    type: [String],
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.ROI)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  riskFactors?: string[];

  @ApiPropertyOptional({
    description: 'Disclosures for ROI projects',
    type: [String],
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.ROI)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  disclosures?: string[];

  @ApiPropertyOptional({
    description: 'Verification badges for charity projects',
    type: [String],
  })
  @ValidateIf((o: CreateProjectDto) => o.type === ProjectType.CHARITY)
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  verificationBadges?: string[];

  @ApiPropertyOptional({
    description: 'Short highlights for the public page',
    type: [String],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsString({ each: true })
  highlights?: string[];

  @ApiPropertyOptional({
    enum: ProjectStatus,
    description:
      'Initial status; defaults to DRAFT and only DRAFT is allowed on creation',
  })
  @IsOptional()
  @IsEnum(ProjectStatus)
  status?: ProjectStatus;

  @ApiPropertyOptional({
    description:
      'Flag to require investor acceptance of all required agreements',
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  requiresAgreement?: boolean;
}
