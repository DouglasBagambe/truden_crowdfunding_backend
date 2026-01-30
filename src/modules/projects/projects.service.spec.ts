import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { ProjectType } from '../../common/enums/project-type.enum';
import { MilestoneStatus } from '../../common/enums/milestone-status.enum';
import { CreateVerificationLogDto } from './dto/create-verification-log.dto';
import { KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';

const mockProjectId = '507f1f77bcf86cd799439011';

const createService = () => {
  const projectsRepo = {
    create: jest.fn(),
    findById: jest.fn(),
    updateById: jest.fn(),
    setStatus: jest.fn(),
    findByCreator: jest.fn(),
    query: jest.fn(),
    count: jest.fn(),
  };
  const milestonesRepo = {
    createMany: jest.fn(),
    deleteByProject: jest.fn(),
    findByProject: jest.fn(),
  };

  const usersRepo = {
    findById: jest.fn(),
  };

  const agreementTemplatesService = {
    findApplicable: jest.fn().mockResolvedValue([]),
  };

  const attachmentRequirementsService = {
    findApplicable: jest.fn().mockResolvedValue([]),
  };

  const attachmentFilesRepo = {
    create: jest.fn(),
    findById: jest.fn(),
  };

  const service = new ProjectsService(
    projectsRepo as any,
    milestonesRepo as any,
    usersRepo as any,
    agreementTemplatesService as any,
    attachmentRequirementsService as any,
    attachmentFilesRepo as any,
  );

  return {
    service,
    projectsRepo,
    milestonesRepo,
    usersRepo,
    agreementTemplatesService,
    attachmentRequirementsService,
    attachmentFilesRepo,
  };
};

describe('ProjectsService', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates ROI project with defaults and persists agreements/media fields', async () => {
    const { service, projectsRepo, milestonesRepo } = createService();
    const dto = {
      projectType: ProjectType.ROI,
      name: 'Tech Academy',
      summary: 'Upskilling engineers',
      story: 'Detailed story',
      country: 'Kenya',
      beneficiary: 'Youth engineers',
      paymentMethod: 'mpesa',
      industry: 'education',
      risks: 'Execution risks',
      targetAmount: 1000,
      currency: 'USD',
      fundingStartDate: new Date('2025-01-01'),
      fundingEndDate: new Date('2025-02-01'),
      tags: ['education', 'tech'],
      videoUrls: ['https://example.com/video'],
      socialLinks: [{ platform: 'twitter', url: 'https://twitter.com/x' }],
      website: 'https://example.com',
      attachments: [
        { title: 'proof', url: 'https://example.com/doc', isRequired: true },
      ],
      agreements: [{ title: 'Terms', requiresAcceptance: true }],
    };

    projectsRepo.create.mockResolvedValue({ id: mockProjectId });
    const result = { project: { id: mockProjectId }, milestones: [] };
    jest
      .spyOn(service, 'getProjectWithMilestones')
      .mockResolvedValue(result as any);

    const response = await service.createProject('user-1', dto as any);

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: ProjectType.ROI,
        name: 'Tech Academy',
        summary: 'Upskilling engineers',
        story: 'Detailed story',
        country: 'Kenya',
        beneficiary: 'Youth engineers',
        paymentMethod: 'mpesa',
        industry: 'education',
        risks: 'Execution risks',
        targetAmount: 1000,
        currency: 'USD',
        fundingStartDate: dto.fundingStartDate,
        fundingEndDate: dto.fundingEndDate,
        tags: dto.tags,
        videoUrls: dto.videoUrls,
        socialLinks: dto.socialLinks,
        website: dto.website,
        attachments: expect.arrayContaining([
          expect.objectContaining({
            title: 'proof',
            url: 'https://example.com/doc',
            isRequired: true,
          }),
        ]),
        agreements: expect.arrayContaining([
          expect.objectContaining({
            title: 'Terms',
            requiresAcceptance: true,
          }),
        ]),
        roiAgreements: expect.arrayContaining([
          expect.objectContaining({
            title: 'Terms',
            requiresAcceptance: true,
          }),
        ]),
        requiresAgreement: true,
        status: ProjectStatus.DRAFT,
      }),
    );
    expect(milestonesRepo.createMany).not.toHaveBeenCalled();
    expect(response).toEqual(result);
  });

  it('creates charity project with milestones and enforces category', async () => {
    const { service, projectsRepo, milestonesRepo } = createService();
    const dto = {
      type: ProjectType.CHARITY,
      name: 'School Support',
      summary: 'Help a school',
      story: 'Full story',
      country: 'Uganda',
      beneficiary: 'Students',
      paymentMethod: 'bank',
      category: 'school',
      subcategory: 'education',
      targetAmount: 2000,
      currency: 'UGX',
      milestones: [
        { title: 'Phase 1', description: 'Buy books', payoutPercentage: 50 },
        { title: 'Phase 2', description: 'Build desks', payoutPercentage: 50 },
      ],
    };

    projectsRepo.create.mockResolvedValue({ id: mockProjectId });
    const result = { project: { id: mockProjectId }, milestones: [] };
    jest
      .spyOn(service, 'getProjectWithMilestones')
      .mockResolvedValue(result as any);

    await service.createProject('user-1', dto as any);

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: ProjectType.CHARITY,
        category: 'school',
        subcategory: 'education',
      }),
    );
    expect(milestonesRepo.createMany).toHaveBeenCalledWith(
      mockProjectId,
      expect.arrayContaining([
        expect.objectContaining({
          title: 'Phase 1',
          status: MilestoneStatus.PLANNED,
        }),
      ]),
    );
  });

  it('rejects charity projects without category', async () => {
    const { service } = createService();
    const dto = {
      type: ProjectType.CHARITY,
      name: 'Charity',
      summary: 'Summary',
      story: 'Story',
      country: 'KE',
      beneficiary: 'People',
      paymentMethod: 'mpesa',
      targetAmount: 10,
      currency: 'KES',
    };

    await expect(
      service.createProject('user', dto as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ROI projects without industry', async () => {
    const { service } = createService();
    const dto = {
      type: ProjectType.ROI,
      name: 'ROI',
      summary: 'Summary',
      story: 'Story',
      country: 'KE',
      beneficiary: 'People',
      paymentMethod: 'mpesa',
      targetAmount: 10,
      currency: 'KES',
    };

    await expect(
      service.createProject('user', dto as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents updating project not owned by user', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      id: mockProjectId,
      creatorId: 'owner-1',
      status: ProjectStatus.DRAFT,
    });

    await expect(
      service.updateProject(mockProjectId, 'owner-2', {
        summary: 'new',
      } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('enforces public filters and search for listPublicProjects', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.query.mockResolvedValue([]);
    projectsRepo.count.mockResolvedValue(0);

    await service.listPublicProjects({
      type: ProjectType.CHARITY,
      category: 'school',
      country: 'Kenya',
      tags: ['health'],
      search: 'water',
      page: 2,
      pageSize: 5,
    } as any);

    expect(projectsRepo.query).toHaveBeenCalledWith(
      expect.objectContaining({
        status: expect.any(Object),
        projectType: ProjectType.CHARITY,
        category: 'school',
        country: 'Kenya',
        tags: { $in: ['health'] },
        $text: { $search: 'water' },
      }),
      5,
      5,
    );
  });

  it('blocks access to non-public project', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({ status: ProjectStatus.DRAFT });

    await expect(
      service.getProjectPublic(mockProjectId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('requires verification log before approval', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      status: ProjectStatus.PENDING_REVIEW,
      verificationLogs: [],
      attachments: [],
    });

    await expect(
      service.decide(mockProjectId, {
        finalStatus: ProjectStatus.APPROVED,
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('allows approval with verification log present', async () => {
    const { service, projectsRepo, usersRepo } = createService();
    const logs: CreateVerificationLogDto[] = [
      { performedBy: 'agent', summary: 'checked', decision: 'approve' },
    ] as any;
    projectsRepo.findById.mockResolvedValue({
      status: ProjectStatus.PENDING_REVIEW,
      verificationLogs: logs,
      attachments: [],
      creatorId: 'creator-1',
    });
    usersRepo.findById.mockResolvedValue({
      isBlocked: false,
      isActive: true,
      kyc: { status: KYCStatus.VERIFIED },
      creatorVerification: { status: CreatorVerificationStatus.VERIFIED },
    });
    projectsRepo.setStatus.mockResolvedValue(true);
    await service.decide(mockProjectId, {
      finalStatus: ProjectStatus.APPROVED,
    } as any);
    expect(projectsRepo.setStatus).toHaveBeenCalledWith(
      mockProjectId,
      ProjectStatus.APPROVED,
      undefined,
    );
  });
});
