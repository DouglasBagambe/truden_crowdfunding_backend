import {
  BadRequestException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { Types } from 'mongoose';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { MilestoneStatus } from '../../common/enums/milestone-status.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { ProjectDecisionDto } from './dto/decision.dto';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { ProjectDocument } from './schemas/project.schema';
import { ProjectType } from '../../common/enums/project-type.enum';
import { AgreementRuleDto } from './dto/agreement-rule.dto';
import { CharityCategory } from '../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../common/enums/charity-subcategory.enum';
import { ROIIndustry } from '../../common/enums/roi-industry.enum';
import { UseOfFundsDto } from './dto/use-of-funds.dto';
import { CreateVerificationLogDto } from './dto/create-verification-log.dto';
import { UsersRepository } from '../users/repositories/users.repository';
import { KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import { AgreementTemplatesService } from './services/agreement-templates.service';
import { AgreementTemplateDocument } from './schemas/agreement-template.schema';

const PUBLIC_STATUSES: ProjectStatus[] = [
  ProjectStatus.APPROVED,
  ProjectStatus.FUNDING,
  ProjectStatus.FUNDED,
  ProjectStatus.FUNDING_FAILED,
];

const OWNER_EDITABLE_STATUSES: ProjectStatus[] = [
  ProjectStatus.DRAFT,
  ProjectStatus.PENDING_REVIEW,
  ProjectStatus.CHANGES_REQUESTED,
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepo: ProjectsRepository,
    private readonly milestonesRepo: MilestonesRepository,
    private readonly usersRepo: UsersRepository,
    private readonly agreementTemplatesService: AgreementTemplatesService,
  ) {}

  async createProject(creatorId: string, dto: CreateProjectDto) {
    if (dto.status && dto.status !== ProjectStatus.DRAFT) {
      throw new BadRequestException('Projects can only be created as DRAFT');
    }

    const projectType = dto.type ?? (dto as any).projectType;
    this.validateProjectType(
      { ...dto, type: projectType },
      { requireType: true },
    );
    const agreementsPayload: AgreementRuleDto[] =
      await this.resolveAgreementsWithTemplates(projectType, {
        agreements: this.normalizeAgreementArray(dto.agreements ?? []),
        roiAgreements: this.normalizeAgreementArray(dto.roiAgreements ?? []),
        charityAgreements: this.normalizeAgreementArray(
          dto.charityAgreements ?? [],
        ),
        category: dto.category,
        industry: dto.industry,
      });

    const project = await this.projectsRepo.create({
      creatorId,
      projectType,
      name: dto.name,
      summary: dto.summary,
      story: dto.story,
      country: dto.country,
      location: dto.location,
      beneficiary: dto.beneficiary,
      paymentMethod: dto.paymentMethod,
      category: dto.category,
      subcategory: dto.subcategory,
      industry: dto.industry,
      risks: dto.risks,
      status: ProjectStatus.DRAFT,
      targetAmount: dto.targetAmount,
      currency: dto.currency,
      fundingStartDate: dto.fundingStartDate,
      fundingEndDate: dto.fundingEndDate,
      tags: dto.tags ?? [],
      videoUrls: dto.videoUrls ?? [],
      socialLinks: dto.socialLinks ?? [],
      website: dto.website,
      attachments: dto.attachments ?? [],
      agreements: agreementsPayload,
      roiAgreements: projectType === ProjectType.ROI ? agreementsPayload : [],
      charityAgreements:
        projectType === ProjectType.CHARITY ? agreementsPayload : [],
      requiresAgreement: dto.requiresAgreement ?? true,
      galleryImages: this.normalizeStringArray(dto.galleryImages),
      useOfFunds: this.normalizeUseOfFundsArray(dto.useOfFunds),
      riskFactors: this.normalizeStringArray(dto.riskFactors),
      disclosures: this.normalizeStringArray(dto.disclosures),
      verificationBadges: this.normalizeStringArray(dto.verificationBadges),
      highlights: this.normalizeStringArray(dto.highlights),
      raisedAmount: 0,
      backerCount: 0,
    });

    if (dto.milestones?.length) {
      const milestonesPayload = dto.milestones.map((m) => ({
        title: m.title,
        description: m.description,
        dueDate: m.dueDate,
        payoutPercentage: m.payoutPercentage ?? 0,
        status: MilestoneStatus.PLANNED,
        proofLinks: m.proofLinks ?? [],
      }));
      await this.milestonesRepo.createMany(
        String(project.id),
        milestonesPayload,
      );
    }

    return this.getProjectWithMilestones(String(project.id));
  }

  async updateProject(
    projectId: string,
    creatorId: string,
    dto: UpdateProjectDto,
  ) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const currentType = this.normalizeProjectType(
      this.readProjectType(project),
    );
    if (project.creatorId !== creatorId) {
      throw new ForbiddenException('You can only edit your own projects');
    }
    if (!OWNER_EDITABLE_STATUSES.includes(project.status)) {
      throw new BadRequestException(
        'Project cannot be edited in the current status',
      );
    }

    if (dto.status && dto.status !== project.status) {
      throw new BadRequestException('Status cannot be changed via update');
    }

    const validationInput: Partial<CreateProjectDto> = {
      ...dto,
      type: dto.type ?? currentType,
      category: dto.category ?? this.normalizeCategory(project.category),
      subcategory:
        dto.subcategory ?? this.normalizeSubcategory(project.subcategory),
      industry: dto.industry ?? this.normalizeIndustry(project.industry),
    };

    this.validateProjectType(validationInput);
    const setPayload: Partial<ProjectDocument> = {};
    const inferredType: ProjectType | undefined =
      dto.type ??
      currentType ??
      (dto.category || project.category ? ProjectType.CHARITY : undefined) ??
      (dto.industry || project.industry ? ProjectType.ROI : undefined);
    if (inferredType !== undefined) setPayload.projectType = inferredType;
    if (dto.name !== undefined) setPayload.name = dto.name;
    if (dto.summary !== undefined) setPayload.summary = dto.summary;
    if (dto.story !== undefined) setPayload.story = dto.story;
    if (dto.country !== undefined) setPayload.country = dto.country;
    if (dto.location !== undefined) setPayload.location = dto.location;
    if (dto.beneficiary !== undefined) setPayload.beneficiary = dto.beneficiary;
    if (dto.paymentMethod !== undefined)
      setPayload.paymentMethod = dto.paymentMethod;
    if (dto.category !== undefined) setPayload.category = dto.category;
    if (dto.subcategory !== undefined) setPayload.subcategory = dto.subcategory;
    if (dto.industry !== undefined) setPayload.industry = dto.industry;
    if (dto.risks !== undefined) setPayload.risks = dto.risks;
    if (dto.riskFactors !== undefined)
      setPayload.riskFactors = this.normalizeStringArray(dto.riskFactors);
    if (dto.disclosures !== undefined)
      setPayload.disclosures = this.normalizeStringArray(dto.disclosures);
    if (dto.tags !== undefined) setPayload.tags = dto.tags;
    if (dto.videoUrls !== undefined) setPayload.videoUrls = dto.videoUrls;
    if (dto.galleryImages !== undefined)
      setPayload.galleryImages = this.normalizeStringArray(dto.galleryImages);
    if (dto.socialLinks !== undefined) setPayload.socialLinks = dto.socialLinks;
    if (dto.website !== undefined) setPayload.website = dto.website;
    if (dto.targetAmount !== undefined)
      setPayload.targetAmount = dto.targetAmount;
    if (dto.currency !== undefined) setPayload.currency = dto.currency;
    if (dto.fundingStartDate !== undefined)
      setPayload.fundingStartDate = dto.fundingStartDate;
    if (dto.fundingEndDate !== undefined)
      setPayload.fundingEndDate = dto.fundingEndDate;
    if (dto.attachments !== undefined) setPayload.attachments = dto.attachments;
    if (dto.useOfFunds !== undefined)
      setPayload.useOfFunds = this.normalizeUseOfFundsArray(dto.useOfFunds);
    if (dto.verificationBadges !== undefined)
      setPayload.verificationBadges = this.normalizeStringArray(
        dto.verificationBadges,
      );
    if (dto.highlights !== undefined)
      setPayload.highlights = this.normalizeStringArray(dto.highlights);

    const shouldRefreshAgreements =
      dto.agreements !== undefined ||
      dto.roiAgreements !== undefined ||
      dto.charityAgreements !== undefined ||
      dto.category !== undefined ||
      dto.industry !== undefined ||
      dto.type !== undefined;

    if (shouldRefreshAgreements) {
      const updatedType = inferredType ?? currentType;
      const agreementsPayload = await this.resolveAgreementsWithTemplates(
        updatedType,
        {
          agreements: this.normalizeAgreementArray(
            dto.agreements ?? (project.agreements as AgreementRuleDto[]),
          ),
          roiAgreements: this.normalizeAgreementArray(
            dto.roiAgreements ?? (project.roiAgreements as AgreementRuleDto[]),
          ),
          charityAgreements: this.normalizeAgreementArray(
            dto.charityAgreements ??
              (project.charityAgreements as AgreementRuleDto[]),
          ),
          category: dto.category ?? project.category,
          industry: dto.industry ?? project.industry,
        },
      );
      setPayload.agreements = agreementsPayload;
      setPayload.roiAgreements =
        updatedType === ProjectType.ROI ? agreementsPayload : [];
      setPayload.charityAgreements =
        updatedType === ProjectType.CHARITY ? agreementsPayload : [];
    }

    if (dto.requiresAgreement !== undefined)
      setPayload.requiresAgreement = dto.requiresAgreement;

    await this.projectsRepo.updateById(projectId, { $set: setPayload });

    if (dto.milestones) {
      await this.milestonesRepo.deleteByProject(projectId);
      if (dto.milestones.length > 0) {
        const milestonesPayload = dto.milestones.map((m) => ({
          title: m.title,
          description: m.description,
          dueDate: m.dueDate,
          payoutPercentage: m.payoutPercentage ?? 0,
          status: MilestoneStatus.PLANNED,
          proofLinks: m.proofLinks ?? [],
        }));
        await this.milestonesRepo.createMany(projectId, milestonesPayload);
      }
    }

    return this.getProjectWithMilestones(projectId);
  }

  async submitProject(projectId: string, creatorId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.creatorId !== creatorId) {
      throw new ForbiddenException('You can only submit your own projects');
    }
    if (
      ![ProjectStatus.DRAFT, ProjectStatus.CHANGES_REQUESTED].includes(
        project.status,
      )
    ) {
      throw new BadRequestException(
        'Only draft or change-requested projects can be submitted',
      );
    }

    await this.ensureCreatorEligibleForSubmission(creatorId);

    const updated = await this.projectsRepo.setStatus(
      projectId,
      ProjectStatus.PENDING_REVIEW,
      null,
    );
    if (!updated) throw new NotFoundException('Project not found');
    return this.getProjectWithMilestones(projectId);
  }

  async listMyProjects(creatorId: string) {
    return this.projectsRepo.findByCreator(creatorId);
  }

  async listPublicProjects(query: QueryProjectsDto) {
    const filter: Record<string, unknown> = {
      status: {
        $in: query.statuses?.length ? query.statuses : PUBLIC_STATUSES,
      },
    };
    if (query.category) {
      filter.category = query.category;
    }
    if (query.industry) {
      filter.industry = query.industry;
    }
    if (query.type) {
      filter.projectType = query.type;
    }
    if (query.country) {
      filter.country = query.country;
    }
    if (query.tags?.length) {
      filter.tags = { $in: query.tags };
    }
    if (query.search) {
      filter.$text = { $search: query.search };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [projects, total] = await Promise.all([
      this.projectsRepo.query(filter, pageSize, skip),
      this.projectsRepo.count(filter),
    ]);
    const projectsWithProgress = projects.map((proj) =>
      this.withProgress(proj),
    );
    return { projects: projectsWithProgress, total, page, pageSize };
  }

  async getProjectPublic(id: string) {
    this.ensureValidObjectId(id);
    const project = await this.projectsRepo.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (!PUBLIC_STATUSES.includes(project.status)) {
      throw new NotFoundException('Project not available');
    }
    return this.getProjectWithMilestones(id);
  }

  async getMilestonesPublic(projectId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (!PUBLIC_STATUSES.includes(project.status)) {
      throw new NotFoundException('Project not available');
    }
    return this.milestonesRepo.findByProject(projectId);
  }

  async listPendingProjects() {
    return this.projectsRepo.query(
      { status: ProjectStatus.PENDING_REVIEW },
      100,
      0,
    );
  }

  async addVerificationLog(projectId: string, dto: CreateVerificationLogDto) {
    this.ensureValidObjectId(projectId);
    const update = await this.projectsRepo.updateById(projectId, {
      $push: {
        verificationLogs: {
          performedBy: dto.performedBy,
          role: dto.role,
          summary: dto.summary,
          decision: dto.decision,
          evidenceUrls: dto.evidenceUrls ?? [],
          attachments: dto.attachments ?? [],
          createdAt: new Date(),
        },
      },
      $set: { lastVerifiedAt: new Date() },
    });
    if (!update) throw new NotFoundException('Project not found');
    return update;
  }

  async listVerificationLogs(projectId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    return Array.isArray(project.verificationLogs)
      ? (project.verificationLogs as CreateVerificationLogDto[])
      : [];
  }

  async decide(projectId: string, dto: ProjectDecisionDto) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== ProjectStatus.PENDING_REVIEW) {
      throw new BadRequestException('Project is not pending review');
    }
    if (
      ![
        ProjectStatus.APPROVED,
        ProjectStatus.REJECTED,
        ProjectStatus.CHANGES_REQUESTED,
      ].includes(dto.finalStatus)
    ) {
      throw new BadRequestException(
        'Final status must be APPROVED, REJECTED, or CHANGES_REQUESTED',
      );
    }

    if (dto.finalStatus === ProjectStatus.APPROVED) {
      this.ensureVerificationLogExists(project.verificationLogs);
      await this.ensureCreatorEligibleForSubmission(project.creatorId);
    }

    const updated = await this.projectsRepo.setStatus(
      projectId,
      dto.finalStatus,
      dto.reason,
    );
    if (!updated) throw new NotFoundException('Project not found');
    return updated;
  }

  async getProjectWithMilestones(projectId: string) {
    const [project, milestones] = await Promise.all([
      this.projectsRepo.findById(projectId),
      this.milestonesRepo.findByProject(projectId),
    ]);
    if (!project) throw new NotFoundException('Project not found');
    return { project: this.withProgress(project), milestones };
  }

  private normalizeProjectType(type: unknown): ProjectType | undefined {
    if (type === ProjectType.ROI || type === ProjectType.CHARITY) {
      return type;
    }
    return undefined;
  }

  private readProjectType(project: {
    projectType?: unknown;
    type?: unknown;
  }): ProjectType | undefined {
    const t = this.normalizeProjectType(project.projectType);
    if (t) return t;
    return this.normalizeProjectType(project.type);
  }

  private normalizeCategory(value: unknown): CharityCategory | undefined {
    if (typeof value !== 'string') return undefined;
    return Object.values(CharityCategory).includes(value as CharityCategory)
      ? (value as CharityCategory)
      : undefined;
  }

  private normalizeSubcategory(value: unknown): CharitySubcategory | undefined {
    if (typeof value !== 'string') return undefined;
    return Object.values(CharitySubcategory).includes(
      value as CharitySubcategory,
    )
      ? (value as CharitySubcategory)
      : undefined;
  }

  private normalizeIndustry(value: unknown): ROIIndustry | undefined {
    if (typeof value !== 'string') return undefined;
    return Object.values(ROIIndustry).includes(value as ROIIndustry)
      ? (value as ROIIndustry)
      : undefined;
  }

  private resolveAgreements(
    type: ProjectType | undefined,
    dto: {
      agreements?: AgreementRuleDto[];
      roiAgreements?: AgreementRuleDto[];
      charityAgreements?: AgreementRuleDto[];
    },
  ): AgreementRuleDto[] {
    if (type === ProjectType.ROI) {
      const roi = dto.roiAgreements;
      if (roi && roi.length) return roi;
      return dto.agreements ?? [];
    }
    if (type === ProjectType.CHARITY) {
      const charity = dto.charityAgreements;
      if (charity && charity.length) return charity;
      return dto.agreements ?? [];
    }
    return dto.agreements ?? [];
  }

  private async resolveAgreementsWithTemplates(
    type: ProjectType | undefined,
    dto: {
      agreements?: AgreementRuleDto[];
      roiAgreements?: AgreementRuleDto[];
      charityAgreements?: AgreementRuleDto[];
      category?: string;
      industry?: string;
    },
  ): Promise<AgreementRuleDto[]> {
    const base = this.resolveAgreements(type, dto);
    if (!type) return base;

    const templates: AgreementTemplateDocument[] =
      await this.agreementTemplatesService.findApplicable(
        type,
        dto.category,
        dto.industry,
      );

    const templateAgreements: AgreementRuleDto[] = templates.map((t) => ({
      title: t.title,
      description: t.description,
      requiresAcceptance: t.requiresAcceptance,
      templateId: String(t._id),
      templateVersion: t.version,
    }));

    // Merge template agreements with user-provided, preferring templates on duplicate templateId/title
    const merged = [...templateAgreements];
    for (const item of base) {
      const duplicate =
        item.templateId &&
        merged.some((m) => m.templateId && m.templateId === item.templateId);
      const duplicateTitle = merged.some((m) => m.title === item.title);
      if (duplicate || duplicateTitle) continue;
      merged.push(item);
    }
    return merged;
  }

  private normalizeAgreementArray(value: unknown): AgreementRuleDto[] {
    return Array.isArray(value) ? (value as AgreementRuleDto[]) : [];
  }

  private normalizeStringArray(value: unknown): string[] {
    return Array.isArray(value) ? (value as string[]) : [];
  }

  private normalizeUseOfFundsArray(value: unknown): UseOfFundsDto[] {
    return Array.isArray(value) ? (value as UseOfFundsDto[]) : [];
  }

  private ensureValidObjectId(id: string) {
    if (!Types.ObjectId.isValid(id)) {
      throw new NotFoundException('Project not found');
    }
  }

  private validateProjectType(
    dto: Partial<CreateProjectDto>,
    options: { requireType?: boolean } = {},
  ) {
    const projectType = dto.type ?? (dto as any).projectType;
    if (options.requireType && !projectType) {
      throw new BadRequestException('Project type is required');
    }
    if (!projectType) return;
    if (projectType === ProjectType.CHARITY && !dto.category) {
      throw new BadRequestException('Charity projects must include a category');
    }
    if (projectType === ProjectType.ROI && !dto.industry) {
      throw new BadRequestException('ROI projects must include an industry');
    }
    if (projectType === ProjectType.CHARITY && dto.verificationBadges) {
      const required = dto.attachments?.some((a) => a.isRequired);
      if (!required) {
        throw new BadRequestException(
          'Charity projects with verification badges must include required attachments',
        );
      }
    }
  }

  private withProgress(project: ProjectDocument) {
    const obj = project.toObject();
    const target = obj.targetAmount || 0;
    const raised = obj.raisedAmount || 0;
    const progressPct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;
    return {
      ...obj,
      progress: {
        raisedAmount: raised,
        targetAmount: target,
        percentage: progressPct,
        backerCount: obj.backerCount ?? 0,
      },
    };
  }

  private ensureVerificationLogExists(
    logs: CreateVerificationLogDto[] | undefined,
  ) {
    if (!logs || logs.length === 0) {
      throw new BadRequestException(
        'Verification log is required before approval',
      );
    }
  }

  async getProjectOwnerView(projectId: string, ownerId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.creatorId !== ownerId) {
      throw new ForbiddenException('You can only view your own project');
    }
    return this.getProjectWithMilestones(projectId);
  }

  private async ensureCreatorEligibleForSubmission(creatorId: string) {
    const creator = await this.usersRepo.findById(creatorId);
    if (!creator) {
      throw new NotFoundException('Creator not found');
    }
    if (creator.isBlocked === true || creator.isActive === false) {
      throw new ForbiddenException('Creator account is not active');
    }
    const kycStatus =
      (creator.kyc && creator.kyc.status) || creator.kycStatus || KYCStatus.NOT_VERIFIED;
    if (kycStatus !== KYCStatus.VERIFIED) {
      throw new ForbiddenException(
        'Complete and verify KYC before submitting a project',
      );
    }
    const creatorVerificationStatus =
      creator.creatorVerification?.status ?? CreatorVerificationStatus.NOT_SUBMITTED;
    if (creatorVerificationStatus !== CreatorVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Creator verification must be VERIFIED before submitting a project',
      );
    }
  }
}
