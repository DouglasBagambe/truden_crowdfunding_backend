import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  ForbiddenException,
} from '@nestjs/common';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { MilestoneStatus } from '../../common/enums/milestone-status.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { CreateReviewDto } from './dto/create-review.dto';
import { ProjectDecisionDto } from './dto/decision.dto';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { ProjectReviewsRepository } from './repositories/project-reviews.repository';
import { ProjectDocument } from './schemas/project.schema';
import { ProjectType } from '../../common/enums/project-type.enum';
import { AgreementRuleDto } from './dto/agreement-rule.dto';
import { CharityCategory } from '../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../common/enums/charity-subcategory.enum';
import { ROIIndustry } from '../../common/enums/roi-industry.enum';
import { UseOfFundsDto } from './dto/use-of-funds.dto';

const PUBLIC_STATUSES: ProjectStatus[] = [
  ProjectStatus.APPROVED,
  ProjectStatus.FUNDING,
  ProjectStatus.FUNDED,
  ProjectStatus.FUNDING_FAILED,
];

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projectsRepo: ProjectsRepository,
    private readonly milestonesRepo: MilestonesRepository,
    private readonly reviewsRepo: ProjectReviewsRepository,
  ) {}

  async createProject(creatorId: string, dto: CreateProjectDto) {
    if (dto.status && dto.status !== ProjectStatus.DRAFT) {
      throw new BadRequestException('Projects can only be created as DRAFT');
    }

    this.validateProjectType(dto, { requireType: true });
    const agreementsPayload: AgreementRuleDto[] = this.resolveAgreements(
      dto.type,
      {
        agreements: this.normalizeAgreementArray(dto.agreements),
        roiAgreements: this.normalizeAgreementArray(dto.roiAgreements),
        charityAgreements: this.normalizeAgreementArray(dto.charityAgreements),
      },
    );

    const project = await this.projectsRepo.create({
      creatorId,
      type: dto.type,
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
      roiAgreements: dto.type === ProjectType.ROI ? agreementsPayload : [],
      charityAgreements:
        dto.type === ProjectType.CHARITY ? agreementsPayload : [],
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
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const currentType = this.normalizeProjectType(project.type);
    if (project.creatorId !== creatorId) {
      throw new ForbiddenException('You can only edit your own projects');
    }
    if (
      ![ProjectStatus.DRAFT, ProjectStatus.PENDING_REVIEW].includes(
        project.status,
      )
    ) {
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
    if (inferredType !== undefined) setPayload.type = inferredType;
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

    if (
      dto.agreements !== undefined ||
      dto.roiAgreements !== undefined ||
      dto.charityAgreements !== undefined
    ) {
      const updatedType = inferredType ?? currentType;
      const agreementsPayload = this.resolveAgreements(updatedType, {
        agreements: this.normalizeAgreementArray(dto.agreements),
        roiAgreements: this.normalizeAgreementArray(dto.roiAgreements),
        charityAgreements: this.normalizeAgreementArray(dto.charityAgreements),
      });
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
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.creatorId !== creatorId) {
      throw new ForbiddenException('You can only submit your own projects');
    }
    if (project.status !== ProjectStatus.DRAFT) {
      throw new BadRequestException('Only DRAFT projects can be submitted');
    }

    const updated = await this.projectsRepo.setStatus(
      projectId,
      ProjectStatus.PENDING_REVIEW,
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
      filter.type = query.type;
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
    return { projects, total, page, pageSize };
  }

  async getProjectPublic(id: string) {
    const project = await this.projectsRepo.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    if (!PUBLIC_STATUSES.includes(project.status)) {
      throw new NotFoundException('Project not available');
    }
    return this.getProjectWithMilestones(id);
  }

  async getMilestonesPublic(projectId: string) {
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

  async createReview(
    projectId: string,
    reviewerId: string,
    dto: CreateReviewDto,
  ) {
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== ProjectStatus.PENDING_REVIEW) {
      throw new BadRequestException('Project is not pending review');
    }

    const existing = await this.reviewsRepo.findExisting(projectId, reviewerId);
    if (existing) {
      throw new ConflictException('Review already submitted by this reviewer');
    }

    return this.reviewsRepo.create({
      projectId,
      reviewerId,
      score: dto.score,
      comments: dto.comments,
      recommendation: dto.recommendation,
    });
  }

  async decide(projectId: string, dto: ProjectDecisionDto) {
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.status !== ProjectStatus.PENDING_REVIEW) {
      throw new BadRequestException('Project is not pending review');
    }
    if (
      ![ProjectStatus.APPROVED, ProjectStatus.REJECTED].includes(
        dto.finalStatus,
      )
    ) {
      throw new BadRequestException(
        'Final status must be APPROVED or REJECTED',
      );
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
    return { project, milestones };
  }

  private normalizeProjectType(type: unknown): ProjectType | undefined {
    if (type === ProjectType.ROI || type === ProjectType.CHARITY) {
      return type;
    }
    return undefined;
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
      return dto.roiAgreements ?? dto.agreements ?? [];
    }
    if (type === ProjectType.CHARITY) {
      return dto.charityAgreements ?? dto.agreements ?? [];
    }
    return dto.agreements ?? [];
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

  private validateProjectType(
    dto: Partial<CreateProjectDto>,
    options: { requireType?: boolean } = {},
  ) {
    if (options.requireType && !dto.type) {
      throw new BadRequestException('Project type is required');
    }
    if (!dto.type) return;
    if (dto.type === ProjectType.CHARITY && !dto.category) {
      throw new BadRequestException('Charity projects must include a category');
    }
    if (dto.type === ProjectType.ROI && !dto.industry) {
      throw new BadRequestException('ROI projects must include an industry');
    }
    if (dto.type === ProjectType.CHARITY && dto.verificationBadges) {
      const required = dto.attachments?.some((a) => a.isRequired);
      if (!required) {
        throw new BadRequestException(
          'Charity projects with verification badges must include required attachments',
        );
      }
    }
  }
}
