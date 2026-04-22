import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import sgMail from '@sendgrid/mail';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { InjectModel } from '@nestjs/mongoose';
import { Investment, InvestmentDocument } from '../investments/schemas/investment.schema';
import { InvestmentStatus } from '../investments/interfaces/investment.interface';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { QueryProjectsDto } from './dto/query-projects.dto';
import { ProjectDecisionDto } from './dto/decision.dto';
import { ProjectsRepository } from './repositories/projects.repository';
import { MilestonesRepository } from './repositories/milestones.repository';
import { CharityDonationsRepository } from './repositories/charity-donations.repository';
import type { ProjectDocument } from './schemas/project.schema';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { MilestoneStatus } from '../../common/enums/milestone-status.enum';
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
import { AttachmentRequirementsService } from './services/attachment-requirements.service';
import { AttachmentRequirementDocument } from './schemas/attachment-requirement.schema';
import { RequestAttachmentDto } from './dto/request-attachment.dto';
import { AttachmentFilesRepository } from './repositories/attachment-files.repository';
import { UploadAttachmentDto } from './dto/upload-attachment.dto';
import { StreamableFile } from '@nestjs/common';
import { hasBackendRoiAccess } from '../../common/utils/roi-access.util';
import { ViemNftClient } from '../nfts/helpers/viem-nft-client';
import { OnchainProvisioningStatus } from './schemas/project.schema';
import type { Address } from 'viem';
type MulterFile = Express.Multer.File;

const PUBLIC_STATUSES = [
  ProjectStatus.APPROVED,
  ProjectStatus.FUNDING,
  ProjectStatus.FUNDED,
  ProjectStatus.FUNDING_FAILED,
] as const satisfies ProjectStatus[];

const OWNER_EDITABLE_STATUSES = [
  ProjectStatus.DRAFT,
  ProjectStatus.PENDING_REVIEW,
  ProjectStatus.CHANGES_REQUESTED,
  ProjectStatus.APPROVED,
] as const satisfies ProjectStatus[];

@Injectable()
export class ProjectsService {
  private readonly logger = new Logger(ProjectsService.name);

  constructor(
    private readonly projectsRepo: ProjectsRepository,
    private readonly milestonesRepo: MilestonesRepository,
    private readonly charityDonationsRepo: CharityDonationsRepository,
    private readonly usersRepo: UsersRepository,
    private readonly configService: ConfigService,
    private readonly agreementTemplatesService: AgreementTemplatesService,
    private readonly attachmentRequirementsService: AttachmentRequirementsService,
    private readonly attachmentFilesRepo: AttachmentFilesRepository,
    private readonly viemNftClient: ViemNftClient,
    @InjectModel(Investment.name)
    private readonly investmentModel: Model<InvestmentDocument>,
  ) { }

  async findByOnchainId(projectOnchainId: string) {
    return this.projectsRepo.findByOnchainId(projectOnchainId);
  }

  async listRoiProjectsWithOnchainId() {
    return this.projectsRepo.listRoiProjectsWithOnchainId();
  }

  async createProject(creatorId: string, dto: CreateProjectDto) {
    const projectType: ProjectType | undefined =
      (dto.type ?? (dto as any).projectType ?? (dto.category ? ProjectType.CHARITY : (dto.industry ? ProjectType.ROI : undefined)));

    this.validateProjectType(
      { ...dto, type: projectType },
      { requireType: true },
    );
    const agreementsPayload: AgreementRuleDto[] =
      await this.resolveAgreementsWithTemplates(projectType, {
        agreements: dto.agreements,
        roiAgreements: dto.roiAgreements,
        charityAgreements: dto.charityAgreements,
        category: dto.category,
        industry: dto.industry,
      });

    const attachmentsPayload = await this.applyAttachmentRequirementsAsync(
      projectType,
      dto.category,
      dto.subcategory,
      dto.industry,
      this.normalizeAttachmentArray(dto.attachments ?? []),
    );

    const risksValue: string | undefined =
      this.toOptionalString(dto.risks) ?? this.toOptionalString(dto.challenges);

    const project = await this.projectsRepo.create({
      creatorId: new Types.ObjectId(creatorId),
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
      risks: risksValue,
      status: ProjectStatus.PENDING_REVIEW,
      targetAmount: dto.targetAmount,
      currency: dto.currency,
      fundingStartDate: dto.fundingStartDate,
      fundingEndDate: dto.fundingEndDate,
      tags: dto.tags ?? [],
      videoUrls: dto.videoUrls ?? [],
      socialLinks: dto.socialLinks ?? [],
      website: dto.website,
      imageUrl: dto.imageUrl,
      attachments: attachmentsPayload,
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
        description: m.description?.trim() || m.title,
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
    const isOwnerEditable = OWNER_EDITABLE_STATUSES.some(
      (status) => status === project.status,
    );
    if (!isOwnerEditable) {
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
    if (dto.risks !== undefined || dto.challenges !== undefined) {
      const risksUpdate =
        this.toOptionalString(dto.risks) ??
        this.toOptionalString(dto.challenges) ??
        this.toOptionalString(project.risks);
      setPayload.risks = risksUpdate;
    }
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
    if (dto.imageUrl !== undefined) setPayload.imageUrl = dto.imageUrl;
    if (dto.targetAmount !== undefined)
      setPayload.targetAmount = dto.targetAmount;
    if (dto.currency !== undefined) setPayload.currency = dto.currency;
    if (dto.fundingStartDate !== undefined)
      setPayload.fundingStartDate = dto.fundingStartDate;
    if (dto.fundingEndDate !== undefined)
      setPayload.fundingEndDate = dto.fundingEndDate;
    if (dto.attachments !== undefined)
      setPayload.attachments = this.normalizeAttachmentArray(dto.attachments);
    if (dto.useOfFunds !== undefined)
      setPayload.useOfFunds = this.normalizeUseOfFundsArray(dto.useOfFunds);
    if (dto.verificationBadges !== undefined)
      setPayload.verificationBadges = this.normalizeStringArray(
        dto.verificationBadges,
      );
    if (dto.highlights !== undefined)
      setPayload.highlights = this.normalizeStringArray(dto.highlights);

    const shouldRefreshAgreements =
      dto.category !== undefined ||
      dto.subcategory !== undefined ||
      dto.industry !== undefined ||
      dto.type !== undefined;

    if (shouldRefreshAgreements) {
      const updatedType = inferredType ?? currentType;
      const agreementsPayload = await this.resolveAgreementsWithTemplates(
        updatedType,
        {
          agreements: [],
          roiAgreements: [],
          charityAgreements: [],
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

    if (
      dto.attachments !== undefined ||
      dto.category !== undefined ||
      dto.subcategory !== undefined ||
      dto.industry !== undefined ||
      dto.type !== undefined
    ) {
      const updatedType = inferredType ?? currentType;
      const normalizedAttachments = this.normalizeAttachmentArray(
        dto.attachments ??
        (project.attachments as Array<{
          title: string;
          url?: string;
          fileId?: string;
          type?: string;
          isRequired?: boolean;
          templateId?: string;
          templateVersion?: number;
          requestedBy?: string;
          requestedAt?: Date;
        }>),
      );
      setPayload.attachments = await this.applyAttachmentRequirementsAsync(
        updatedType,
        dto.category ?? project.category,
        dto.subcategory ?? project.subcategory,
        dto.industry ?? project.industry,
        normalizedAttachments,
      );
    }

    if (dto.requiresAgreement !== undefined)
      setPayload.requiresAgreement = dto.requiresAgreement;

    await this.projectsRepo.updateById(projectId, { $set: setPayload });

    if (dto.milestones) {
      await this.milestonesRepo.deleteByProject(projectId);
      if (dto.milestones.length > 0) {
        const milestonesPayload = dto.milestones.map((m) => ({
          title: m.title,
          description: m.description?.trim() || m.title,
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

  async listCharityDonationsPublic(projectId: string, limit = 50) {
    const project = await this.ensureProjectExists(projectId);
    const projectType = this.readProjectType(project);
    if (projectType !== ProjectType.CHARITY) {
      throw new BadRequestException('Donations are only supported for charity projects');
    }
    const isPublic = PUBLIC_STATUSES.some((status) => status === project.status);
    if (!isPublic) {
      throw new NotFoundException('Project not available');
    }
    const safeLimit = Math.max(1, Math.min(100, Number(limit) || 50));

    // Fetch from CharityDonationsRepository
    const items = await this.charityDonationsRepo.listByProject(projectId, safeLimit);
    return items.map((d) => ({
      id: String((d as any)._id),
      donorName: d.donorName || 'Anonymous',
      amount: d.amount,
      message: d.message ?? null,
      createdAt: (d as any).createdAt ?? null,
    }));
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
    await this.ensureRequiredAttachments(
      this.normalizeProjectType(project.projectType),
      project.category,
      project.subcategory,
      project.industry,
      project.attachments ?? [],
    );

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

  async listPublicProjects(query: QueryProjectsDto, userId?: string) {
    const statuses: ProjectStatus[] = query.statuses?.length
      ? [...query.statuses]
      : PUBLIC_STATUSES;

    const filter: Record<string, unknown> = {
      status: {
        $in: statuses,
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
    if (!hasBackendRoiAccess(userId, this.configService)) {
      filter.projectType = ProjectType.CHARITY;
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [projects, total] = await Promise.all([
      this.projectsRepo.query(filter, pageSize, skip),
      this.projectsRepo.count(filter),
    ]);
    const projectsWithProgress = projects.map((proj) =>
      this.stripCreatorEmail(this.withProgress(proj)),
    );
    return { projects: projectsWithProgress, total, page, pageSize };
  }

  async getProjectPublic(id: string, userId?: string) {
    this.ensureValidObjectId(id);
    const project = await this.projectsRepo.findById(id);
    if (!project) throw new NotFoundException('Project not found');
    const projectType = this.normalizeProjectType(this.readProjectType(project));
    const canSeeRoi = hasBackendRoiAccess(userId, this.configService);
    if (projectType === ProjectType.ROI && !canSeeRoi) {
      throw new NotFoundException('Project not found');
    }
    const isViewable = PUBLIC_STATUSES.some((status) => status === project.status);
    if (!isViewable) {
      throw new NotFoundException('Project not available');
    }
    const result = await this.getProjectWithMilestones(id);
    return {
      ...result,
      project: this.stripCreatorEmail(result.project),
    };
  }

  async getMilestonesPublic(projectId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    const isPublic = PUBLIC_STATUSES.some(
      (status) => status === project.status,
    );
    if (!isPublic) {
      throw new NotFoundException('Project not available');
    }
    return this.milestonesRepo.findByProject(projectId);
  }

  async listAllProjectsForAdmin() {
    return this.projectsRepo.query({}, 500, 0);
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

    let finalStatus = dto.finalStatus;
    const extraSet: Record<string, unknown> = {};

    if (
      dto.finalStatus === ProjectStatus.APPROVED &&
      this.readProjectType(project) === ProjectType.ROI
    ) {
      // Mark provisioning as PENDING immediately so admin can see it in-flight
      await this.projectsRepo.updateById(projectId, {
        $set: { onchainProvisioningStatus: OnchainProvisioningStatus.PENDING },
      });

      try {
        const { projectOnchainId } = await this.ensureProjectProvisionedOnChain(projectId);
        finalStatus = ProjectStatus.FUNDING;
        extraSet.projectOnchainId = projectOnchainId;
      } catch (provisionErr: unknown) {
        const errMsg =
          provisionErr instanceof Error
            ? provisionErr.message
            : String(provisionErr);
        this.logger.error(
          `ROI on-chain provisioning failed for project ${projectId}: ${errMsg}`,
        );
        // Persist failure state — project stays APPROVED (visible to admin) but not FUNDING
        await this.projectsRepo.updateById(projectId, {
          $set: {
            onchainProvisioningStatus: OnchainProvisioningStatus.FAILED,
            onchainProvisioningError: errMsg,
          },
        });
        // Re-throw so the HTTP response reflects the failure to the admin
        throw new BadRequestException(
          `Project approved but on-chain provisioning failed: ${errMsg}. ` +
          'Run the backfill repair to retry provisioning.',
        );
      }
    }

    const updated = await this.projectsRepo.updateById(projectId, {
      $set: {
        status: finalStatus,
        ...(dto.reason !== undefined ? { decisionReason: dto.reason } : {}),
        ...extraSet,
      },
    });
    if (!updated) throw new NotFoundException('Project not found');

    // Send email notification to creator on Rejection or Approval
    try {
      const creator = await this.usersRepo.findById(project.creatorId.toString());
      if (creator?.email) {
        await this.sendProjectDecisionEmail(
          creator.email,
          (creator as any).firstName || (creator as any).lastName || creator.email,
          project.name,
          finalStatus,
          this.readProjectType(project),
          dto.reason,
        );
      }
    } catch (emailErr) {
      // Non-fatal: log but don't block
      new Logger('ProjectsService').warn(`Failed to send decision email: ${emailErr}`);
    }

    return updated;
  }

  private async sendProjectDecisionEmail(
    email: string,
    creatorName: string,
    projectName: string,
    decision: ProjectStatus,
    projectType?: ProjectType,
    reason?: string,
  ) {
    const apiKey = this.configService.get<string>('SENDGRID_API_KEY');
    const from = this.configService.get<string>('EMAIL_FROM');
    if (!apiKey || !from) return;
    sgMail.setApiKey(apiKey);

    const isApproved = decision === ProjectStatus.APPROVED;
    const isFunding = decision === ProjectStatus.FUNDING;
    const isRejected = decision === ProjectStatus.REJECTED;
    const isChangesRequested = decision === ProjectStatus.CHANGES_REQUESTED;

    const subject = isApproved || isFunding
      ? `Your campaign "${projectName}" has been approved!`
      : isRejected
        ? `Update on your campaign "${projectName}"`
        : `Changes requested for "${projectName}"`;

    const isPositive = isApproved || isFunding;
    const statusColour = isPositive ? '#10b981' : isRejected ? '#ef4444' : '#f59e0b';
    const statusLabel = isPositive ? 'Approved' : isRejected ? 'Rejected' : 'Changes Requested';
    const bodyMessage = isPositive
      ? projectType === ProjectType.ROI
        ? `Great news! Your ROI campaign <strong>${projectName}</strong> has been reviewed, approved, and is now <strong>open for investment</strong>.`
        : `Great news! Your campaign <strong>${projectName}</strong> has been reviewed and <strong>approved</strong>. It is now visible to the public and ready to receive donations.`
      : isRejected
        ? `After careful review, your campaign <strong>${projectName}</strong> could not be approved at this time.`
        : `Our review team has reviewed your campaign <strong>${projectName}</strong> and requires some changes before it can be approved.`;

    const html = `
      <div style="font-family: Arial, sans-serif; max-width: 560px; margin: 0 auto; padding: 24px; background: #f7f9fb; border: 1px solid #e5e8ec; border-radius: 12px;">
        <div style="text-align: center; margin-bottom: 16px;">
          <div style="font-size: 20px; font-weight: 700; color: #0f1f38;">Keibo</div>
          <div style="font-size: 13px; color: #607087;">Crowdfunding Platform</div>
        </div>
        <div style="background: #ffffff; padding: 20px; border-radius: 10px; border: 1px solid #eef1f5;">
          <div style="display:inline-block; background:${statusColour}20; color:${statusColour}; font-size:12px; font-weight:700; text-transform:uppercase; letter-spacing:1px; padding:4px 12px; border-radius:20px; margin-bottom:16px;">${statusLabel}</div>
          <h2 style="margin: 0 0 12px; color: #0f1f38;">Campaign Review Update</h2>
          <p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">Hi ${creatorName},</p>
          <p style="margin: 0 0 12px; color: #304054; line-height: 1.6;">${bodyMessage}</p>
          ${reason ? `<div style="margin: 16px 0; padding: 14px 16px; background: #f7f9fb; border-left: 4px solid ${statusColour}; border-radius: 4px;"><p style="margin:0; font-size:13px; color:#304054; line-height:1.6;"><strong>Reason:</strong><br>${reason}</p></div>` : ''}
          <p style="margin: 16px 0 0; color: #8a97ab; font-size: 12px;">Log in to your Keibo dashboard to view your campaign status and take action.</p>
        </div>
      </div>
    `;

    await sgMail.send({
      to: email,
      from,
      subject,
      text: `${bodyMessage}${reason ? `\n\nReason: ${reason}` : ''}`,
      html,
    });
  }

  async getProjectWithMilestones(projectId: string) {
    const [project, milestones] = await Promise.all([
      this.projectsRepo.findById(projectId),
      this.milestonesRepo.findByProject(projectId),
    ]);
    if (!project) throw new NotFoundException('Project not found');

    // Manually resolve creator since legacy projects store creatorId as string (not ObjectId)
    // so Mongoose populate() silently fails on them
    const creatorIdStr = project.creatorId?.toString();
    let creatorData: { _id: any; firstName?: string; lastName?: string; email?: string } | undefined;
    if (creatorIdStr) {
      try {
        const creatorUser = await this.usersRepo.findById(creatorIdStr);
        if (creatorUser) {
          creatorData = {
            _id: (creatorUser as any)._id,
            firstName: (creatorUser as any).profile?.firstName || (creatorUser as any).firstName,
            lastName: (creatorUser as any).profile?.lastName || (creatorUser as any).lastName,
            email: creatorUser.email,
          };
        }
      } catch { /* non-fatal */ }
    }

    return { project: this.withProgress(project, creatorData), milestones };
  }

  async ensureProjectExists(projectId: string): Promise<ProjectDocument> {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async ensureProjectIsOpenForInvestment(projectId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const projectType = this.normalizeProjectType(this.readProjectType(project));
    if (projectType !== ProjectType.ROI) {
      throw new BadRequestException('Investments are only supported for ROI projects');
    }

    const investmentsTestMode =
      String(this.configService.get('INVESTMENTS_TEST_MODE') ?? '').toLowerCase() === 'true';
    const kycBypass =
      String(this.configService.get('KYC_BYPASS') ?? '').toLowerCase() === 'true';

    if (!investmentsTestMode && !kycBypass) {
      const openInvestmentStatuses: ProjectStatus[] = [
        ProjectStatus.FUNDING,
        // Legacy ROI approvals stored as APPROVED before provisioning was added.
        ProjectStatus.APPROVED,
      ];
      if (!openInvestmentStatuses.includes(project.status)) {
        throw new BadRequestException('Project is not accepting investments');
      }
    }

    const target = project.targetAmount || 0;
    if (target <= 0) {
      throw new BadRequestException('Project has invalid funding target');
    }

    // ── On-chain provisioning gate ─────────────────────────────────────────────
    // Default: strict (ROI_REQUIRE_ONCHAIN_PROVISIONING=true)
    const requireProvisioning =
      String(this.configService.get('ROI_REQUIRE_ONCHAIN_PROVISIONING') ?? 'true').toLowerCase() !== 'false';

    const projectOnchainId = String((project as any).projectOnchainId || '').trim();
    const isProvisioned = projectOnchainId.length > 0 && projectOnchainId !== '0';

    if (requireProvisioning && !isProvisioned) {
      const provisioningStatus = (project as any).onchainProvisioningStatus as string || 'NOT_STARTED';
      if (provisioningStatus === OnchainProvisioningStatus.FAILED) {
        const reason = (project as any).onchainProvisioningError || 'Unknown provisioning error';
        throw new BadRequestException(
          `ROI project on-chain provisioning previously failed: ${reason}. ` +
          'An admin must run the repair endpoint before investments can proceed.',
        );
      }
      throw new BadRequestException(
        'This ROI project has not yet been provisioned on-chain. ' +
        'It cannot accept investments until provisioning completes.',
      );
    }
    // ──────────────────────────────────────────────────────────────────────────

    return project;
  }

  async ensureProjectCanReceiveDonation(projectId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    const projectType = this.normalizeProjectType(this.readProjectType(project));
    if (projectType !== ProjectType.CHARITY) {
      throw new BadRequestException('Donations are only supported for charity projects');
    }

    const isPublic = PUBLIC_STATUSES.some((status) => status === project.status);
    if (!isPublic) {
      throw new BadRequestException('Project is not available for donations');
    }

    return project;
  }

  /**
   * Idempotent on-chain provisioning for a single ROI project.
   *
   * - Safe to call multiple times (re-uses existing projectOnchainId).
   * - Called at approval time and by the admin repair endpoint / backfill script.
   * - Persists projectOnchainId + provisioningStatus=READY on success.
   * - Callers must persist FAILED state themselves if they catch an error here.
   */
  async ensureProjectProvisionedOnChain(
    projectId: string,
  ): Promise<{ projectOnchainId: string }> {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const projectType = this.normalizeProjectType(this.readProjectType(project));
    if (projectType !== ProjectType.ROI) {
      throw new BadRequestException('Only ROI projects can be provisioned on-chain');
    }

    // ── Already provisioned — idempotency guard ─────────────────────────────
    const existingOnchainId = String((project as any).projectOnchainId || '').trim();
    if (existingOnchainId && existingOnchainId !== '0') {
      // Ensure status field is synced in case it was set before this field existed
      await this.projectsRepo.updateById(projectId, {
        $set: {
          onchainProvisioningStatus: OnchainProvisioningStatus.READY,
          onchainProvisionedAt: (project as any).onchainProvisionedAt ?? new Date(),
        },
        $unset: { onchainProvisioningError: 1 },
      });
      return { projectOnchainId: existingOnchainId };
    }

    // ── Validate creator and wallet ─────────────────────────────────────────
    const creatorId = String(project.creatorId);
    const creator = await this.usersRepo.findById(creatorId);
    if (!creator) {
      this.logger.error(
        `ROI provisioning failed for project ${projectId}: creator ${creatorId} not found`,
      );
      throw new BadRequestException('Project creator not found');
    }

    const linkedWallet = creator.linkedWallets?.find(
      (w): w is string => typeof w === 'string' && w.trim().length > 0,
    );
    const legacyWallet =
      typeof (creator as any).walletAddress === 'string' &&
      (creator as any).walletAddress.trim().length > 0
        ? String((creator as any).walletAddress).trim().toLowerCase()
        : undefined;
    const creatorWallet: string | undefined =
      creator.primaryWallet ||
      linkedWallet ||
      legacyWallet;

    if (!creatorWallet) {
      this.logger.error(
        `ROI provisioning blocked for project ${projectId}: creator ${creatorId} has no linked wallet`,
      );
      throw new BadRequestException(
        'ROI project provisioning requires the creator to have a linked wallet address. ' +
        'Ask the creator to link a wallet before approving.',
      );
    }

    if (!creator.primaryWallet && legacyWallet) {
      await this.usersRepo.updateById(creatorId, {
        $set: { primaryWallet: legacyWallet },
        $addToSet: { linkedWallets: legacyWallet },
      });
      this.logger.log(
        `ROI provisioning recovered legacy wallet for creator ${creatorId}: ${legacyWallet}`,
      );
    }

    // ── Derive deterministic on-chain ID ────────────────────────────────────
    // Same derivation as the original ensureRoiProjectReadyForFunding so IDs are stable.
    const projectOnchainId = BigInt(`0x${String((project as any)._id)}`).toString();
    const nftDiagnostics = this.viemNftClient.getDiagnostics();
    const targetAmountWei = BigInt(Math.floor(Number(project.targetAmount || 0) * 1e6));

    this.logger.log(
      `ROI provisioning start: project=${projectId}, creator=${creatorId}, wallet=${creatorWallet}, onchainId=${projectOnchainId}, chainId=${nftDiagnostics.chainId}, rpcUrl=${nftDiagnostics.rpcUrl}, nftAddress=${nftDiagnostics.nftAddress}, targetAmount=${project.targetAmount}, targetAmountWei=${targetAmountWei.toString()}`,
    );

    // ── Call contract ───────────────────────────────────────────────────────
    try {
      const { hash, receipt } = await this.viemNftClient.createProjectNFT({
        projectOnchainId: BigInt(projectOnchainId),
        creator: creatorWallet as Address,
        targetAmountWei,
        paymentToken: '0x0000000000000000000000000000000000000000' as Address,
      });

      this.logger.log(
        `ROI provisioning contract write succeeded: project=${projectId}, txHash=${hash}, receiptStatus=${receipt.status}, block=${receipt.blockNumber?.toString?.() ?? 'unknown'}`,
      );
    } catch (error: unknown) {
      const err = error instanceof Error ? error : new Error(String(error));
      this.logger.error(
        `ROI provisioning contract write failed: project=${projectId}, creator=${creatorId}, wallet=${creatorWallet}, onchainId=${projectOnchainId}, chainId=${nftDiagnostics.chainId}, nftAddress=${nftDiagnostics.nftAddress}, error=${err.message}`,
        err.stack,
      );
      throw error;
    }

    // ── Persist success ─────────────────────────────────────────────────────
    const now = new Date();
    await this.projectsRepo.updateById(projectId, {
      $set: {
        projectOnchainId,
        onchainProvisioningStatus: OnchainProvisioningStatus.READY,
        onchainProvisionedAt: now,
      },
      $unset: { onchainProvisioningError: 1 },
    });

    this.logger.log(
      `ROI project ${projectId} provisioned on-chain: onchainId=${projectOnchainId}`,
    );

    return { projectOnchainId };
  }

  /**
   * Admin repair for a single ROI project.
   * Wraps ensureProjectProvisionedOnChain with explicit FAILED state persistence
   * so failures are always observable in the DB rather than only in logs.
   */
  async repairRoiProjectProvisioning(
    projectId: string,
  ): Promise<{
    projectId: string;
    result: 'ALREADY_PROVISIONED' | 'PROVISIONED' | 'FAILED';
    projectOnchainId?: string;
    error?: string;
  }> {
    // Capture pre-repair state BEFORE calling ensureProjectProvisionedOnChain,
    // which updates the DB, so we can distinguish ALREADY_PROVISIONED from
    // freshly PROVISIONED based on the original state rather than the post-update DB.
    const preRepairProject = await this.projectsRepo.findById(projectId);
    const preRepairOnchainId = String((preRepairProject as any)?.projectOnchainId || '').trim();
    const wasAlreadyProvisioned = preRepairOnchainId.length > 0 && preRepairOnchainId !== '0';

    try {
      const { projectOnchainId } = await this.ensureProjectProvisionedOnChain(projectId);
      // Re-fetch to get current status after provisioning may have changed it
      const postRepairProject = await this.projectsRepo.findById(projectId);
      // Promote APPROVED → FUNDING now that provisioning succeeded
      if (postRepairProject?.status === ProjectStatus.APPROVED) {
        await this.projectsRepo.updateById(projectId, {
          $set: { status: ProjectStatus.FUNDING, projectOnchainId },
        });
      }
      return {
        projectId,
        result: wasAlreadyProvisioned ? 'ALREADY_PROVISIONED' : 'PROVISIONED',
        projectOnchainId,
      };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.projectsRepo.updateById(projectId, {
        $set: {
          onchainProvisioningStatus: OnchainProvisioningStatus.FAILED,
          onchainProvisioningError: errMsg,
        },
      });
      this.logger.error(`Repair failed for ROI project ${projectId}: ${errMsg}`);
      return { projectId, result: 'FAILED', error: errMsg };
    }
  }

  /**
   * Batch backfill: scans ROI projects in APPROVED or FUNDING status with a
   * missing or invalid projectOnchainId and attempts to provision each one.
   * Idempotent — already-provisioned projects are skipped without modification.
   */
  async backfillRoiProvisioning(): Promise<{
    total: number;
    skipped: number;
    provisioned: number;
    failed: number;
    results: Array<{
      projectId: string;
      name: string;
      result: 'SKIPPED' | 'PROVISIONED' | 'FAILED';
      projectOnchainId?: string;
      error?: string;
    }>;
  }> {
    const candidates = await this.projectsRepo.query(
      {
        projectType: ProjectType.ROI,
        status: { $in: [ProjectStatus.APPROVED, ProjectStatus.FUNDING] },
        $or: [
          { projectOnchainId: { $exists: false } },
          { projectOnchainId: null },
          { projectOnchainId: '' },
          { projectOnchainId: '0' },
        ],
      },
      500,
      0,
    );

    const results: Array<{
      projectId: string;
      name: string;
      result: 'SKIPPED' | 'PROVISIONED' | 'FAILED';
      projectOnchainId?: string;
      error?: string;
    }> = [];

    let skipped = 0;
    let provisioned = 0;
    let failed = 0;

    for (const project of candidates) {
      const pid = String(project._id || project.id);
      const name = String((project as any).name || pid);

      // Double-check: skip if the freshly-fetched record already has a valid ID
      const freshOnchainId = String((project as any).projectOnchainId || '').trim();
      if (freshOnchainId && freshOnchainId !== '0') {
        skipped++;
        results.push({ projectId: pid, name, result: 'SKIPPED', projectOnchainId: freshOnchainId });
        continue;
      }

      const repairResult = await this.repairRoiProjectProvisioning(pid);
      if (repairResult.result === 'FAILED') {
        failed++;
        results.push({ projectId: pid, name, result: 'FAILED', error: repairResult.error });
      } else {
        provisioned++;
        results.push({
          projectId: pid,
          name,
          result: 'PROVISIONED',
          projectOnchainId: repairResult.projectOnchainId,
        });
      }
    }

    this.logger.log(
      `ROI backfill complete: total=${candidates.length} skipped=${skipped} provisioned=${provisioned} failed=${failed}`,
    );

    return {
      total: candidates.length,
      skipped,
      provisioned,
      failed,
      results,
    };
  }

  async incrementFunding(projectId: string, amount: number) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    await this.ensureProjectIsOpenForInvestment(projectId);

    await this.projectsRepo.updateById(projectId, {
      $inc: { raisedAmount: amount, backerCount: 1 },
    });
  }

  async incrementCharityDonation(
    projectId: string,
    amount: number,
    userId?: string,
    donorName?: string,
    message?: string,
  ) {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    await this.ensureProjectCanReceiveDonation(projectId);

    const normalizedDonorName = (donorName ?? '').trim() || 'Anonymous';

    await this.projectsRepo.updateById(projectId, {
      $inc: { raisedAmount: amount, backerCount: 1 },
    });

    try {
      await this.charityDonationsRepo.create({
        projectId: new Types.ObjectId(projectId),
        amount,
        donorName: normalizedDonorName,
        message,
        userId: userId ? new Types.ObjectId(userId) : undefined,
      });
    } catch (err) {
      this.logger.error(`Failed to record charity donation for project ${projectId}: ${err}`);
    }

    return this.getProjectWithMilestones(projectId);
  }

  async getDonationsByUser(userId: string) {
    this.ensureValidObjectId(userId);
    const donations = await this.charityDonationsRepo.findByUserId(new Types.ObjectId(userId));
    const populated: any[] = [];
    for (const d of donations) {
      const project = await this.projectsRepo.findById(String(d.projectId));
      if (project) {
        populated.push({
          id: d._id.toString(),
          projectId: project._id.toString(),
          investorId: userId,
          amount: d.amount,
          currency: 'UGX',
          status: 'Active',
          project: {
            id: project._id.toString(),
            title: (project as any).title || project.name,
            name: (project as any).title || project.name,
            category: project.category,
            projectType: project.projectType || (project as any).type,
            type: project.projectType || (project as any).type,
            creatorId: project.creatorId?.toString(),
            imageUrl: project.imageUrl,
          },
          createdAt: (d as any).createdAt,
        });
      }
    }
    return populated;
  }

  async requestAttachment(projectId: string, dto: RequestAttachmentDto) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const normalizedTitle = dto.title.trim();
    const now = new Date();

    const existingIndex = (project.attachments ?? []).findIndex((att) => {
      const titleMatch =
        att.title?.trim().toLowerCase() === normalizedTitle.toLowerCase();
      return titleMatch;
    });

    const payload = {
      title: normalizedTitle,
      description: dto.description,
      url:
        existingIndex >= 0
          ? (project.attachments?.[existingIndex].url ?? '')
          : '',
      isRequired: dto.isRequired ?? true,
      requestedBy: 'admin',
      requestedAt: now,
    };

    if (existingIndex >= 0) {
      project.attachments[existingIndex] = {
        ...project.attachments[existingIndex],
        ...payload,
      };
    } else {
      project.attachments = [...(project.attachments ?? []), payload];
    }

    await this.projectsRepo.updateById(projectId, {
      $set: { attachments: project.attachments },
    });

    return project.attachments;
  }

  async uploadAttachment(
    projectId: string,
    userId: string,
    dto: UploadAttachmentDto,
    file?: MulterFile,
  ) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');
    if (project.creatorId !== userId) {
      throw new ForbiddenException(
        'Only the project owner can upload attachments',
      );
    }
    const fileBuffer = file?.buffer;
    const fileName = file?.originalname;
    const fileMime = file?.mimetype;
    const fileSize = file?.size;
    if (!file || !fileBuffer || !fileName) {
      throw new BadRequestException('File is required');
    }

    const stored = await this.attachmentFilesRepo.create({
      projectId: new Types.ObjectId(projectId),
      filename: fileName,
      mimeType: fileMime,
      size: fileSize,
      data: fileBuffer,
    });

    const normalizedTitle = dto.title.trim();
    const existingAttachments = project.attachments ?? [];
    const existingIndex = existingAttachments.findIndex((att) => {
      const titleMatch =
        att.title?.trim().toLowerCase() === normalizedTitle.toLowerCase();
      return titleMatch;
    });

    const attachment = {
      title: normalizedTitle,
      type: dto.type,
      isRequired: dto.isRequired ?? false,
      fileId: String(stored._id),
      url: '',
    };

    const updatedAttachments = [...existingAttachments];
    if (existingIndex >= 0) {
      updatedAttachments[existingIndex] = {
        ...updatedAttachments[existingIndex],
        ...attachment,
      };
    } else {
      updatedAttachments.push(attachment);
    }
    await this.projectsRepo.updateById(projectId, {
      $set: { attachments: updatedAttachments },
    });

    return {
      fileId: String(stored._id),
      filename: stored.filename,
      mimeType: stored.mimeType,
      size: stored.size,
    };
  }

  async uploadGenericFile(file?: MulterFile) {
    const fileBuffer = file?.buffer;
    const fileName = file?.originalname;
    const fileMime = file?.mimetype;
    const fileSize = file?.size;

    if (!file || !fileBuffer || !fileName) {
      throw new BadRequestException('File is required');
    }

    const stored = await this.attachmentFilesRepo.create({
      projectId: undefined, // Unlinked
      filename: fileName,
      mimeType: fileMime,
      size: fileSize,
      data: fileBuffer,
    });

    // Provide a full URL that the frontend can use as an image src
    const rawBaseUrl = process.env.BACKEND_URL || process.env.API_URL || 'http://localhost:3000';
    const baseUrl = rawBaseUrl
      .trim()
      .replace(/[,\s]+$/, '')
      .replace(/\/+$/, '')
      .replace(/\/api$/, '');
    return {
      fileId: String(stored._id),
      filename: stored.filename,
      url: `${baseUrl}/api/projects/files/${stored._id}`,
    };
  }

  async downloadGenericFile(fileId: string) {
    const file = await this.attachmentFilesRepo.findById(fileId);
    if (!file) {
      throw new NotFoundException('File not found');
    }

    return new StreamableFile(file.data, {
      disposition: `inline; filename="${file.filename}"`,
      type: file.mimeType ?? 'application/octet-stream',
    });
  }

  async downloadAttachment(projectId: string, fileId: string) {
    this.ensureValidObjectId(projectId);
    const project = await this.projectsRepo.findById(projectId);
    if (!project) throw new NotFoundException('Project not found');

    const file = await this.attachmentFilesRepo.findById(fileId);
    if (!file || String(file.projectId) !== String(projectId)) {
      throw new NotFoundException('Attachment not found');
    }

    return new StreamableFile(file.data, {
      disposition: `attachment; filename="${file.filename}"`,
      type: file.mimeType ?? 'application/octet-stream',
    });
  }

  private ensureRequiredAttachments(
    projectType: ProjectType | undefined,
    category: string | undefined,
    subcategory: string | undefined,
    industry: string | undefined,
    attachments: Array<{
      title: string;
      url?: string;
      fileId?: string;
      templateId?: string;
    }>,
  ) {
    if (!projectType) {
      throw new BadRequestException('Project type is required before submit');
    }
    return this.attachmentRequirementsService
      .findApplicable(projectType, category, subcategory, industry)
      .then((requirements) => {
        const missing = requirements.filter((req) => {
          if (!req.isRequired) return false;
          return !attachments.some((att) => {
            const titleMatch =
              att.title?.trim().toLowerCase() ===
              req.title.trim().toLowerCase();
            const templateMatch =
              att.templateId && String(att.templateId) === String(req._id);
            const hasFile =
              (typeof att.url === 'string' && att.url.trim().length > 0) ||
              (typeof att.fileId === 'string' && att.fileId.trim().length > 0);
            return hasFile && (titleMatch || templateMatch);
          });
        });
        if (missing.length) {
          throw new BadRequestException(
            `Missing required attachments: ${missing
              .map((m) => m.title)
              .join(', ')}`,
          );
        }
      });
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
    const merged: AgreementRuleDto[] = [...templateAgreements];
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

  private async applyAttachmentRequirementsAsync(
    type: ProjectType | undefined,
    category: string | undefined,
    subcategory: string | undefined,
    industry: string | undefined,
    attachments: Array<{
      title: string;
      url?: string;
      fileId?: string;
      type?: string;
      isRequired?: boolean;
      templateId?: string;
      templateVersion?: number;
      requestedBy?: string;
      requestedAt?: Date;
    }>,
  ) {
    if (!type) return attachments;
    const requirements: AttachmentRequirementDocument[] =
      await this.attachmentRequirementsService.findApplicable(
        type,
        category,
        subcategory,
        industry,
      );

    const normalized = [...attachments];
    for (const req of requirements) {
      const existingIndex = normalized.findIndex((att) => {
        const titleMatch =
          att.title?.trim().toLowerCase() === req.title.trim().toLowerCase();
        const templateMatch =
          att.templateId && String(att.templateId) === String(req._id);
        return titleMatch || templateMatch;
      });

      const templateData = {
        templateId: String(req._id),
        templateVersion: req.version,
        isRequired: req.isRequired ?? true,
      };

      if (existingIndex >= 0) {
        normalized[existingIndex] = {
          ...normalized[existingIndex],
          ...templateData,
          title: req.title,
        };
      } else {
        normalized.push({
          title: req.title,
          url: '',
          ...templateData,
        });
      }
    }
    return normalized;
  }

  private normalizeAgreementArray(value: unknown): AgreementRuleDto[] {
    return Array.isArray(value) ? (value as AgreementRuleDto[]) : [];
  }

  private normalizeAttachmentArray(
    value:
      | Array<{
        title: string;
        url?: string;
        fileId?: string;
        type?: string;
        isRequired?: boolean;
        templateId?: string;
        templateVersion?: number;
        requestedBy?: string;
        requestedAt?: Date;
      }>
      | unknown,
  ) {
    if (!Array.isArray(value)) return [];
    return value.map(
      (att: {
        title?: unknown;
        url?: unknown;
        fileId?: unknown;
        type?: unknown;
        isRequired?: unknown;
        templateId?: unknown;
        templateVersion?: unknown;
        requestedBy?: unknown;
        requestedAt?: unknown;
      }) => ({
        title: typeof att.title === 'string' ? att.title : '',
        url: typeof att.url === 'string' ? att.url : undefined,
        fileId: typeof att.fileId === 'string' ? att.fileId : undefined,
        type: typeof att.type === 'string' ? att.type : undefined,
        isRequired:
          typeof att.isRequired === 'boolean' ? att.isRequired : undefined,
        templateId:
          typeof att.templateId === 'string' ? att.templateId : undefined,
        templateVersion:
          typeof att.templateVersion === 'number'
            ? att.templateVersion
            : undefined,
        requestedBy:
          typeof att.requestedBy === 'string' ? att.requestedBy : undefined,
        requestedAt:
          att.requestedAt instanceof Date ? att.requestedAt : undefined,
      }),
    );
  }

  private toOptionalString(value: unknown): string | undefined {
    return typeof value === 'string' ? value : undefined;
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
    const projectType = dto.type;
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

  private withProgress(
    project: ProjectDocument,
    creatorOverride?: { _id: any; firstName?: string; lastName?: string; email?: string },
  ) {
    const obj = project.toObject();
    const target = obj.targetAmount || 0;
    const raised = obj.raisedAmount || 0;
    const progressPct = target > 0 ? Math.min(100, (raised / target) * 100) : 0;

    // Use explicit creatorOverride first, then fall back to populated creatorId
    const rawCreator = obj.creatorId as any;
    const populatedCreator = rawCreator && typeof rawCreator === 'object' && rawCreator.email
      ? {
        _id: rawCreator._id,
        firstName: rawCreator.profile?.firstName || rawCreator.firstName,
        lastName: rawCreator.profile?.lastName || rawCreator.lastName,
        email: rawCreator.email
      }
      : undefined;

    const creator = creatorOverride || populatedCreator;

    return {
      ...obj,
      creator,
      progress: {
        raisedAmount: raised,
        targetAmount: target,
        percentage: progressPct,
        backerCount: obj.backerCount ?? 0,
      },
    };
  }

  private stripCreatorEmail<T extends { creator?: { email?: string } | null }>(
    payload: T,
  ): T {
    if (payload.creator && typeof payload.creator === 'object' && 'email' in payload.creator) {
      delete payload.creator.email;
    }
    return payload;
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
    if (String(project.creatorId) !== ownerId) {
      throw new ForbiddenException('You can only view your own project');
    }
    return this.getProjectWithMilestones(projectId);
  }

  private async ensureCreatorEligible(ownerId: string) {
    const kycBypass =
      String(process.env.KYC_BYPASS ?? '').toLowerCase() === 'true';
    if (kycBypass) {
      return;
    }

    const creator = await this.usersRepo.findById(ownerId);
    if (!creator) {
      throw new NotFoundException('Creator not found');
    }
    if (creator.isBlocked === true || creator.isActive === false) {
      throw new ForbiddenException('Creator account is not active');
    }
    const kycStatus =
      (creator.kyc && creator.kyc.status) ||
      creator.kycStatus ||
      KYCStatus.NOT_VERIFIED;
    if (kycStatus !== KYCStatus.VERIFIED) {
      throw new ForbiddenException(
        'Complete and verify KYC before submitting a project',
      );
    }
    const creatorVerificationStatus =
      creator.creatorVerification?.status ??
      CreatorVerificationStatus.NOT_SUBMITTED;
    if (creatorVerificationStatus !== CreatorVerificationStatus.VERIFIED) {
      throw new ForbiddenException(
        'Creator verification must be VERIFIED before submitting a project',
      );
    }
  }

  private async ensureCreatorEligibleForSubmission(ownerId: string) {
    return this.ensureCreatorEligible(ownerId);
  }
}
