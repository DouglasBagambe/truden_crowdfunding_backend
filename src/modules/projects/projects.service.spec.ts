import {
  BadRequestException,
  ForbiddenException,
  NotFoundException,
} from '@nestjs/common';
import { ProjectsService } from './projects.service';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { ProjectType } from '../../common/enums/project-type.enum';
import { CharityCategory } from '../../common/enums/charity-category.enum';
import { CharitySubcategory } from '../../common/enums/charity-subcategory.enum';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import { MilestoneStatus } from '../../common/enums/milestone-status.enum';
import { KYCStatus } from '../../common/enums/role.enum';
import { CreatorVerificationStatus } from '../../common/enums/creator-verification-status.enum';
import { OnchainProvisioningStatus } from './schemas/project.schema';

type ProjectEmailSender = {
  sendProjectDecisionEmail: (
    email: string,
    creator: string,
    name: string,
    decision: ProjectStatus,
    type?: ProjectType,
    reason?: string,
  ) => Promise<void>;
};

const mockProjectId = '507f1f77bcf86cd799439011';
const mockCreatorId = '507f1f77bcf86cd799439012';

describe('Charity Wallet eligibility without milestones', () => {
  const verified = {
    emailVerifiedAt: new Date(),
    kycStatus: KYCStatus.VERIFIED,
    creatorVerification: { status: CreatorVerificationStatus.VERIFIED },
  };
  it('allows the approved charity owner without looking up milestones', async () => {
    const { service, projectsRepo, usersRepo, milestonesRepo } =
      createService();
    projectsRepo.findById.mockResolvedValue({
      type: ProjectType.CHARITY,
      creatorId: mockCreatorId,
      status: ProjectStatus.APPROVED,
      currency: 'UGX',
    });
    usersRepo.findById.mockResolvedValue(verified);
    expect(
      await service.getCharityWalletTransferEligibility(
        mockProjectId,
        mockCreatorId,
      ),
    ).toEqual({ creatorId: mockCreatorId, currency: 'UGX' });
    expect(milestonesRepo.findByProject).not.toHaveBeenCalled();
  });
  it.each([
    { creatorId: '507f1f77bcf86cd799439014' },
    { status: ProjectStatus.PENDING_REVIEW },
    { type: ProjectType.ROI },
  ])(
    'rejects campaign ownership, approval, or type violations %#',
    async (override) => {
      const { service, projectsRepo, usersRepo } = createService();
      projectsRepo.findById.mockResolvedValue({
        type: ProjectType.CHARITY,
        creatorId: mockCreatorId,
        status: ProjectStatus.APPROVED,
        currency: 'UGX',
        ...override,
      });
      usersRepo.findById.mockResolvedValue(verified);
      await expect(
        service.getCharityWalletTransferEligibility(
          mockProjectId,
          mockCreatorId,
        ),
      ).rejects.toThrow();
    },
  );
  it.each([
    { emailVerifiedAt: undefined },
    { kycStatus: KYCStatus.PENDING },
    { creatorVerification: { status: CreatorVerificationStatus.PENDING } },
    { isBlocked: true },
    { isActive: false },
  ])('rejects ineligible creators %#', async (override) => {
    const { service, projectsRepo, usersRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      type: ProjectType.CHARITY,
      creatorId: mockCreatorId,
      status: ProjectStatus.APPROVED,
      currency: 'UGX',
    });
    usersRepo.findById.mockResolvedValue({ ...verified, ...override });
    await expect(
      service.getCharityWalletTransferEligibility(mockProjectId, mockCreatorId),
    ).rejects.toThrow();
  });
});

type ProjectsServiceDependencies = ConstructorParameters<
  typeof ProjectsService
>;
type ProjectWithMilestones = Awaited<
  ReturnType<ProjectsService['getProjectWithMilestones']>
>;
// ─────────────────────────────────────────────────────────────────────────────
// Test factory
// ─────────────────────────────────────────────────────────────────────────────

const createService = () => {
  const projectsRepo = {
    resetRevertedProvisioning: jest.fn().mockResolvedValue({}),
    reserveProvisioningPlan: jest.fn(),
    reserveProvisioningTransaction: jest.fn().mockResolvedValue({}),
    confirmProvisioning: jest.fn(),
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
    findByIdForProject: jest.fn(),
    submitForReview: jest.fn(),
    review: jest.fn(),
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
  const configService = {
    get: jest.fn((key: string) =>
      key === 'INVESTMENTS_ENABLED' ? 'true' : undefined,
    ),
  };
  const charityDonationsRepo = {
    listByProject: jest.fn().mockResolvedValue([]),
    create: jest.fn(),
    findByUserId: jest.fn().mockResolvedValue([]),
  };
  const investmentModel = {
    create: jest.fn(),
  };
  const viemNftClient = {
    creatorNonce: jest.fn().mockResolvedValue(7),
    prepareCampaign: jest.fn().mockResolvedValue({
      to: '0x0000000000000000000000000000000000000001',
      data: '0x1234',
      account: creatorWithWallet().primaryWallet,
    }),
    verifyCampaignCreation: jest.fn().mockResolvedValue('0'),
    verifyRevertedCreation: jest.fn().mockResolvedValue(undefined),
    getRuntimeConfig: jest.fn().mockReturnValue({
      escrow: '0x0000000000000000000000000000000000000001',
    }),
    getCampaign: jest.fn().mockResolvedValue({ state: 0 }),
    createProjectNFT: jest.fn(),
    mintInvestmentTokens: jest.fn(),
    getDiagnostics: jest.fn().mockReturnValue({
      chainId: 84532,
      rpcUrl: 'https://example-rpc.test',
      nftAddress: '0x0000000000000000000000000000000000000001',
    }),
  };
  const notifications = {
    create: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ProjectsService(
    projectsRepo as unknown as ProjectsServiceDependencies[0],
    milestonesRepo as unknown as ProjectsServiceDependencies[1],
    charityDonationsRepo as unknown as ProjectsServiceDependencies[2],
    usersRepo as unknown as ProjectsServiceDependencies[3],
    configService as unknown as ProjectsServiceDependencies[4],
    agreementTemplatesService as unknown as ProjectsServiceDependencies[5],
    attachmentRequirementsService as unknown as ProjectsServiceDependencies[6],
    attachmentFilesRepo as unknown as ProjectsServiceDependencies[7],
    viemNftClient as unknown as ProjectsServiceDependencies[8],
    notifications as unknown as ProjectsServiceDependencies[9],
    investmentModel as unknown as ProjectsServiceDependencies[10],
  );

  return {
    service,
    projectsRepo,
    milestonesRepo,
    usersRepo,
    configService,
    agreementTemplatesService,
    attachmentRequirementsService,
    attachmentFilesRepo,
    viemNftClient,
    notifications,
  };
};

// Helper: a minimal ROI project document stub
const roiProjectStub = (overrides: Record<string, unknown> = {}) => ({
  _id: mockProjectId,
  id: mockProjectId,
  projectType: ProjectType.ROI,
  status: ProjectStatus.APPROVED,
  targetAmount: 1_000_000,
  creatorId: mockCreatorId,
  name: 'Test ROI Project',
  industry: 'technology',
  projectOnchainId: undefined,
  onchainProvisioningStatus: OnchainProvisioningStatus.NOT_STARTED,
  onchainProvisioningError: undefined,
  onchainProvisionedAt: undefined,
  toObject: jest.fn().mockReturnThis(),
  ...overrides,
});

describe('ProjectsService charity release eligibility', () => {
  const charityProject = () =>
    roiProjectStub({
      projectType: ProjectType.CHARITY,
      currency: 'UGX',
      status: ProjectStatus.APPROVED,
    });
  const approvedMilestone = () => ({
    _id: '507f1f77bcf86cd799439013',
    projectId: mockProjectId,
    status: MilestoneStatus.APPROVED,
    payoutPercentage: 100,
  });

  it('permits only the active, verified campaign creator for an approved charity milestone', async () => {
    const { service, projectsRepo, milestonesRepo, usersRepo } =
      createService();
    projectsRepo.findById.mockResolvedValue(charityProject());
    milestonesRepo.findByIdForProject.mockResolvedValue(approvedMilestone());
    milestonesRepo.findByProject.mockResolvedValue([approvedMilestone()]);
    usersRepo.findById.mockResolvedValue(creatorWithWallet());

    await expect(
      service.getCharityMilestoneReleaseEligibility({
        projectId: mockProjectId,
        milestoneId: '507f1f77bcf86cd799439013',
        requesterId: mockCreatorId,
        isAdmin: false,
      }),
    ).resolves.toEqual({
      creatorId: mockCreatorId,
      currency: 'UGX',
      payoutPercentage: 100,
    });
  });

  it('rejects an unauthorized requester before any ledger release can be created', async () => {
    const { service, projectsRepo, milestonesRepo } = createService();
    projectsRepo.findById.mockResolvedValue(charityProject());
    milestonesRepo.findByIdForProject.mockResolvedValue(approvedMilestone());
    milestonesRepo.findByProject.mockResolvedValue([approvedMilestone()]);

    await expect(
      service.getCharityMilestoneReleaseEligibility({
        projectId: mockProjectId,
        milestoneId: '507f1f77bcf86cd799439013',
        requesterId: '507f1f77bcf86cd799439014',
        isAdmin: false,
      }),
    ).rejects.toThrow(ForbiddenException);
  });

  it('rejects milestones without an approved whole-percent allocation', async () => {
    const { service, projectsRepo, milestonesRepo, usersRepo } =
      createService();
    projectsRepo.findById.mockResolvedValue(charityProject());
    milestonesRepo.findByIdForProject.mockResolvedValue({
      ...approvedMilestone(),
      payoutPercentage: 0,
    });
    milestonesRepo.findByProject.mockResolvedValue([
      { ...approvedMilestone(), payoutPercentage: 0 },
    ]);
    usersRepo.findById.mockResolvedValue(creatorWithWallet());

    await expect(
      service.getCharityMilestoneReleaseEligibility({
        projectId: mockProjectId,
        milestoneId: '507f1f77bcf86cd799439013',
        requesterId: mockCreatorId,
        isAdmin: false,
      }),
    ).rejects.toThrow('whole values from 1 to 100');
  });

  it('rejects a charity payout schedule whose allocations do not total 100 percent', async () => {
    const { service, projectsRepo, milestonesRepo, usersRepo } =
      createService();
    projectsRepo.findById.mockResolvedValue(charityProject());
    milestonesRepo.findByIdForProject.mockResolvedValue(approvedMilestone());
    milestonesRepo.findByProject.mockResolvedValue([
      approvedMilestone(),
      {
        ...approvedMilestone(),
        _id: '507f1f77bcf86cd799439014',
        payoutPercentage: 60,
      },
    ]);
    usersRepo.findById.mockResolvedValue(creatorWithWallet());

    await expect(
      service.getCharityMilestoneReleaseEligibility({
        projectId: mockProjectId,
        milestoneId: '507f1f77bcf86cd799439013',
        requesterId: mockCreatorId,
        isAdmin: false,
      }),
    ).rejects.toThrow('total exactly 100');
  });
});

// Helper: a creator with a linked wallet
const creatorWithWallet = () => ({
  _id: mockCreatorId,
  email: 'creator@example.com',
  primaryWallet: '0xabc123def456abc123def456abc123def456abc1',
  linkedWallets: [],
  isBlocked: false,
  isActive: true,
  kyc: { status: KYCStatus.VERIFIED },
  creatorVerification: { status: CreatorVerificationStatus.VERIFIED },
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: existing CRUD tests (unchanged behaviour)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — existing CRUD', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates ROI project with defaults and persists agreements/media fields', async () => {
    const {
      service,
      projectsRepo,
      milestonesRepo,
      usersRepo,
      configService,
      notifications,
    } = createService();
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    configService.get.mockImplementation((key: string) =>
      key === 'INVESTMENTS_ENABLED'
        ? 'true'
        : key === 'ROI_ALLOWED_USER_IDS'
          ? mockCreatorId
          : undefined,
    );
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
      fundingStartDate: '2099-01-01T00:00:00.000Z',
      fundingEndDate: '2099-02-01T23:59:59.999Z',
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
      .mockResolvedValue(result as unknown as ProjectWithMilestones);

    const response = await service.createProject(
      mockCreatorId,
      dto as unknown as CreateProjectDto,
    );

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: ProjectType.ROI,
        name: 'Tech Academy',
        status: ProjectStatus.PENDING_REVIEW,
        fundingStartDate: new Date('2099-01-01T00:00:00.000Z'),
        fundingEndDate: new Date('2099-02-01T23:59:59.999Z'),
      }),
    );
    expect(milestonesRepo.createMany).not.toHaveBeenCalled();
    expect(notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({
        recipientId: mockCreatorId,
        category: 'campaign',
        title: 'Campaign submitted for review',
      }),
    );
    expect(response).toEqual(result);
  });

  it('creates charity project with milestones', async () => {
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
      .mockResolvedValue(result as unknown as ProjectWithMilestones);

    await service.createProject(
      mockCreatorId,
      dto as unknown as CreateProjectDto,
    );

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: ProjectType.CHARITY,
        category: 'school',
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

  it('rejects a past campaign end date before persistence', async () => {
    const { service, projectsRepo } = createService();

    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.CHARITY,
        name: 'Community water project',
        summary: 'A clean water project for the community',
        story: 'A detailed community water project story.',
        country: 'Uganda',
        beneficiary: 'Community households',
        paymentMethod: 'Mobile Money',
        category: CharityCategory.COMMUNITY_GROUP,
        subcategory: CharitySubcategory.OUTREACH,
        targetAmount: 100000,
        currency: 'UGX',
        fundingEndDate: '2020-01-01T23:59:59.999Z',
      }),
    ).rejects.toThrow('fundingEndDate must be in the future');

    expect(projectsRepo.create).not.toHaveBeenCalled();
  });

  it('rejects charity projects without category', async () => {
    const { service } = createService();
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.CHARITY,
        name: 'X',
        summary: 'S',
        story: 'S',
        country: 'KE',
        beneficiary: 'P',
        paymentMethod: 'mpesa',
        targetAmount: 10,
        currency: 'KES',
      } as unknown as CreateProjectDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ROI projects without industry', async () => {
    const { service } = createService();
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.ROI,
        name: 'X',
        summary: 'S',
        story: 'S',
        country: 'KE',
        beneficiary: 'P',
        paymentMethod: 'mpesa',
        targetAmount: 10,
        currency: 'KES',
      } as unknown as CreateProjectDto),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('denies ROI creation when the backend policy does not allow the creator', async () => {
    const { service } = createService();
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.ROI,
        name: 'X',
        summary: 'S',
        story: 'S',
        country: 'KE',
        beneficiary: 'P',
        paymentMethod: 'mpesa',
        industry: 'technology',
        targetAmount: 10,
        currency: 'KES',
      } as unknown as CreateProjectDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('denies ROI creation when KYC or creator verification is incomplete', async () => {
    const { service, usersRepo, configService } = createService();
    usersRepo.findById.mockResolvedValue({
      ...creatorWithWallet(),
      kyc: { status: KYCStatus.PENDING },
    });
    configService.get.mockImplementation((key: string) =>
      key === 'INVESTMENTS_ENABLED'
        ? 'true'
        : key === 'ROI_ALLOWED_USER_IDS'
          ? mockCreatorId
          : undefined,
    );
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.ROI,
        name: 'X',
        summary: 'S',
        story: 'S',
        country: 'KE',
        beneficiary: 'P',
        paymentMethod: 'mpesa',
        industry: 'technology',
        targetAmount: 10,
        currency: 'KES',
      } as unknown as CreateProjectDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('prevents updating project not owned by user', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      id: mockProjectId,
      creatorId: '507f1f77bcf86cd799439013',
      status: ProjectStatus.DRAFT,
    });
    await expect(
      service.updateProject(mockProjectId, '507f1f77bcf86cd799439014', {
        summary: 'new',
      } as unknown as UpdateProjectDto),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks access to non-public project (e.g. REJECTED)', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      status: ProjectStatus.REJECTED,
      projectType: ProjectType.CHARITY,
    });
    await expect(
      service.getProjectPublic(mockProjectId),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: ROI approval provisioning
// ─────────────────────────────────────────────────────────────────────────────

describe('Creator-signed KEIBO provisioning', () => {
  function fixture() {
    const context = createService();
    const project = roiProjectStub({
      currency: 'USDC',
      provisioningNonce: 7,
      provisioningCreator: creatorWithWallet().primaryWallet,
      provisioningEscrow: '0x0000000000000000000000000000000000000001',
      provisioningCalldata: '0x1234',
      fundingEndDate: new Date(Date.now() + 86400000),
      status: ProjectStatus.APPROVED,
      onchainProvisioningStatus: OnchainProvisioningStatus.AWAITING_CREATOR,
    });
    context.projectsRepo.findById.mockResolvedValue(project);
    context.usersRepo.findById.mockResolvedValue(creatorWithWallet());
    context.configService.get.mockImplementation((key: string) =>
      key === 'INVESTMENTS_ENABLED'
        ? 'true'
        : key === 'ROI_ALLOWED_USER_IDS'
          ? mockCreatorId
          : key === 'USDC_TOKEN_ADDRESS'
            ? '0x0000000000000000000000000000000000000002'
            : undefined,
    );
    context.milestonesRepo.findByProject.mockResolvedValue([
      { payoutPercentage: 100 },
    ]);
    context.projectsRepo.updateById.mockResolvedValue(project);
    return { ...context, project };
  }
  it('approval waits for the creator; no legacy NFT call or funding-success notification', async () => {
    const c = fixture();
    await c.service.decide(mockProjectId, {
      finalStatus: ProjectStatus.APPROVED,
    });
    expect(c.viemNftClient.createProjectNFT).not.toHaveBeenCalled();
    expect(c.viemNftClient.prepareCampaign).not.toHaveBeenCalled();
    const updates = c.projectsRepo.updateById.mock.calls as unknown as [
      string,
      { $set: Record<string, unknown> },
    ][];
    expect(
      updates.some(
        ([id, update]) =>
          id === mockProjectId &&
          update.$set.status === ProjectStatus.APPROVED &&
          update.$set.onchainProvisioningStatus ===
            OnchainProvisioningStatus.AWAITING_CREATOR,
      ),
    ).toBe(true);
    expect(c.notifications.create).not.toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Campaign approved' }),
    );
  });
  it('prepares creator-owned calldata with USDC units and exact milestones', async () => {
    const c = fixture();
    await c.service.prepareCreatorCampaign(mockProjectId, mockCreatorId);
    expect(c.viemNftClient.prepareCampaign).toHaveBeenCalledWith(
      expect.objectContaining({
        cap: 1000000000000n,
        milestoneAmounts: [1000000000000n],
        creator: creatorWithWallet().primaryWallet,
      }),
    );
    expect(c.viemNftClient.createProjectNFT).not.toHaveBeenCalled();
  });
  it('rejects a non-owner before preparing any chain operation', async () => {
    const c = fixture();
    await expect(
      c.service.prepareCreatorCampaign(
        mockProjectId,
        '507f1f77bcf86cd799439013',
      ),
    ).rejects.toBeInstanceOf(ForbiddenException);
    expect(c.viemNftClient.prepareCampaign).not.toHaveBeenCalled();
  });
  it('never converts a fiat target into USDC without an authoritative conversion', async () => {
    const c = fixture();
    c.project.currency = 'UGX';
    await expect(
      c.service.prepareCreatorCampaign(mockProjectId, mockCreatorId),
    ).rejects.toThrow('USDC-denominated');
  });
  it('confirms campaign zero and notifies only after atomic FUNDING transition; retry is idempotent', async () => {
    const c = fixture();
    const email = jest
      .spyOn(
        c.service as unknown as ProjectEmailSender,
        'sendProjectDecisionEmail',
      )
      .mockResolvedValue(undefined);
    const hash = `0x${'a'.repeat(64)}` as const;
    const funded = {
      ...c.project,
      status: ProjectStatus.FUNDING,
      projectOnchainId: '0',
      provisioningTransactionHash: hash,
      provisioningEscrow: '0x0000000000000000000000000000000000000001',
      onchainProvisioningStatus: OnchainProvisioningStatus.READY,
    };
    c.projectsRepo.confirmProvisioning.mockResolvedValue(funded);
    expect(
      await c.service.confirmCreatorCampaign(
        mockProjectId,
        mockCreatorId,
        hash,
      ),
    ).toBe(funded);
    expect(c.notifications.create).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
    expect(c.notifications.create).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Campaign approved' }),
    );
    c.projectsRepo.findById.mockResolvedValue(funded);
    await c.service.confirmCreatorCampaign(mockProjectId, mockCreatorId, hash);
    expect(c.viemNftClient.verifyCampaignCreation).toHaveBeenCalledTimes(1);
    expect(c.notifications.create).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledTimes(1);
    expect(email).toHaveBeenCalledWith(
      creatorWithWallet().email,
      expect.any(String),
      c.project.name,
      ProjectStatus.FUNDING,
      ProjectType.ROI,
    );
    expect(c.viemNftClient.createProjectNFT).not.toHaveBeenCalled();
  });
  it('failed confirmation preserves diagnostics and cannot notify success', async () => {
    const c = fixture();
    c.viemNftClient.verifyCampaignCreation.mockRejectedValue(
      new Error('invalid chain receipt'),
    );
    await expect(
      c.service.confirmCreatorCampaign(
        mockProjectId,
        mockCreatorId,
        `0x${'a'.repeat(64)}`,
      ),
    ).rejects.toThrow('invalid chain receipt');
    expect(c.projectsRepo.confirmProvisioning).not.toHaveBeenCalled();
    expect(c.notifications.create).not.toHaveBeenCalled();
    expect(c.projectsRepo.updateById).toHaveBeenCalledWith(mockProjectId, {
      $set: { onchainProvisioningError: 'invalid chain receipt' },
    });
  });
  it.each([
    ProjectStatus.PENDING_REVIEW,
    ProjectStatus.APPROVED,
    ProjectStatus.FUNDED,
    ProjectStatus.CLOSED,
    ProjectStatus.FUNDING_FAILED,
  ])('rejects investment in %s even with an on-chain ID', async (status) => {
    const c = fixture();
    c.project.status = status;
    await expect(
      c.service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).rejects.toThrow('not accepting investments');
  });
  it('FUNDING requires READY evidence; chain campaign zero is valid', async () => {
    const c = fixture();
    Object.assign(c.project, {
      status: ProjectStatus.FUNDING,
      projectOnchainId: '0',
      provisioningTransactionHash: '0xhash',
      provisioningEscrow: '0xescrow',
      onchainProvisioningStatus: OnchainProvisioningStatus.READY,
    });
    await expect(
      c.service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).resolves.toBe(c.project);
    c.project.onchainProvisioningStatus = OnchainProvisioningStatus.FAILED;
    await expect(
      c.service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).rejects.toThrow('confirmed KEIBO');
  });
  it('requires verified investor KYC and acceptance of current project terms', async () => {
    const c = fixture();
    Object.assign(c.project, {
      status: ProjectStatus.FUNDING,
      projectOnchainId: '0',
      provisioningTransactionHash: '0xhash',
      provisioningEscrow: '0xescrow',
      onchainProvisioningStatus: OnchainProvisioningStatus.READY,
      roiAgreements: [{ title: 'Risk terms', requiresAcceptance: true }],
    });
    await expect(
      c.service.requireInvestorForCampaign(mockProjectId, mockCreatorId),
    ).rejects.toThrow('Accept the current');
    await expect(
      c.service.requireInvestorForCampaign(mockProjectId, mockCreatorId, [
        'campaign:0:Risk terms',
      ]),
    ).resolves.toMatchObject({
      agreementSnapshot: [
        { title: 'Risk terms', acceptanceKey: 'campaign:0:Risk terms' },
      ],
    });
    c.usersRepo.findById.mockResolvedValue({
      ...creatorWithWallet(),
      kyc: { status: KYCStatus.PENDING },
    });
    await expect(
      c.service.requireInvestorForCampaign(mockProjectId, mockCreatorId, [
        'campaign:0:Risk terms',
      ]),
    ).rejects.toThrow('Verified KYC');
  });

  it('reuses the reserved nonce after refresh and asks for the original hash once mined', async () => {
    const c = fixture();
    c.viemNftClient.creatorNonce.mockResolvedValue(8);
    const prepared = await c.service.prepareCreatorCampaign(
      mockProjectId,
      mockCreatorId,
    );
    expect(prepared).toMatchObject({ nonce: 7, requiresTransactionHash: true });
    expect(c.projectsRepo.reserveProvisioningPlan).not.toHaveBeenCalled();
  });
  it('only releases a reserved nonce after verified revert evidence', async () => {
    const c = fixture();
    const hash = `0x${'a'.repeat(64)}` as const;
    await expect(
      c.service.retryRevertedCreatorCampaign(
        mockProjectId,
        mockCreatorId,
        hash,
      ),
    ).resolves.toEqual({ retryAllowed: true });
    expect(c.projectsRepo.resetRevertedProvisioning).toHaveBeenCalledWith(
      mockProjectId,
      7,
    );
    c.projectsRepo.resetRevertedProvisioning.mockClear();
    c.viemNftClient.verifyRevertedCreation.mockRejectedValue(
      new Error('not reverted'),
    );
    await expect(
      c.service.retryRevertedCreatorCampaign(
        mockProjectId,
        mockCreatorId,
        hash,
      ),
    ).rejects.toThrow('not reverted');
    expect(c.projectsRepo.resetRevertedProvisioning).not.toHaveBeenCalled();
  });

  it.each([ProjectStatus.REJECTED, ProjectStatus.CHANGES_REQUESTED])(
    'keeps %s notifications and never invokes legacy provisioning',
    async (finalStatus) => {
      const c = fixture();
      await c.service.decide(mockProjectId, {
        finalStatus,
        reason: 'Fixture review reason',
      });
      expect(c.notifications.create).toHaveBeenCalledWith(
        expect.objectContaining({
          title:
            finalStatus === ProjectStatus.REJECTED
              ? 'Campaign not approved'
              : 'Campaign requires changes',
        }),
      );
      expect(c.viemNftClient.createProjectNFT).not.toHaveBeenCalled();
      expect(c.viemNftClient.prepareCampaign).not.toHaveBeenCalled();
    },
  );

  it('repair never creates a legacy NFT or invents creator signing authority', async () => {
    const c = fixture();
    expect(
      (await c.service.repairRoiProjectProvisioning(mockProjectId)).result,
    ).toBe('FAILED');
    expect(c.viemNftClient.createProjectNFT).not.toHaveBeenCalled();
  });
});

describe('Public project query regressions', () => {
  it.each(['Test', 'Tes', 'tes', 'no-result', '.*'])(
    'matches a literal partial title safely: %s',
    async (search) => {
      const { service, projectsRepo } = createService();
      projectsRepo.query.mockResolvedValue([]);
      projectsRepo.count.mockResolvedValue(0);
      await service.listPublicProjects({ search });
      const calls = projectsRepo.query.mock.calls as unknown as Array<
        [{ name: { $regex: string; $options: string } }]
      >;
      const filter = calls[0][0] as {
        name: { $regex: string; $options: string };
      };
      const regex = new RegExp(filter.name.$regex, filter.name.$options);
      expect(regex.test('Test campaign')).toBe(
        ['Test', 'Tes', 'tes'].includes(search),
      );
    },
  );
  it.each([
    ['newest', { createdAt: -1, _id: -1 }],
    ['funded', { raisedAmount: -1, _id: -1 }],
    ['ending', { fundingEndDate: 1, _id: 1 }],
  ] as const)(
    'uses deterministic %s sorting and real pagination',
    async (sort, expected) => {
      const { service, projectsRepo } = createService();
      projectsRepo.query.mockResolvedValue([]);
      projectsRepo.count.mockResolvedValue(25);
      const result = await service.listPublicProjects({
        sort: sort as import('./dto/query-projects.dto').ProjectSort,
        page: 2,
        pageSize: 12,
      });
      expect(projectsRepo.query).toHaveBeenCalledWith(
        expect.any(Object),
        12,
        12,
        expected,
      );
      expect(result).toMatchObject({ total: 25, page: 2, pageSize: 12 });
    },
  );
  it('removes private fields from both public creator representations without mutating source', async () => {
    const { service, projectsRepo } = createService();
    const creator = {
      _id: mockCreatorId,
      email: 'private@example.test',
      profile: { firstName: 'Creator', homeAddress: 'private address' },
    };
    const project = {
      targetAmount: 100,
      raisedAmount: 0,
      toObject: () => ({ creatorId: creator, name: 'Test' }),
    };
    projectsRepo.query.mockResolvedValue([project]);
    projectsRepo.count.mockResolvedValue(1);
    const result = await service.listPublicProjects({});
    expect(JSON.stringify(result)).not.toContain('private@example.test');
    expect(JSON.stringify(result)).not.toContain('private address');
    expect(result.projects[0]).toMatchObject({
      creatorId: { firstName: 'Creator' },
      creator: { firstName: 'Creator' },
    });
    expect(creator.email).toBe('private@example.test');
  });
});

describe('Charity milestone evidence and review boundaries', () => {
  const milestoneId = '507f1f77bcf86cd799439013';
  const setup = () => {
    const c = createService();
    c.projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ projectType: ProjectType.CHARITY, currency: 'UGX' }),
    );
    c.milestonesRepo.findByIdForProject.mockResolvedValue({
      status: MilestoneStatus.IN_REVIEW,
      proofLinks: ['https://keibo.test/proof'],
      payoutPercentage: 100,
    });
    c.milestonesRepo.findByProject.mockResolvedValue([
      { payoutPercentage: 100 },
    ]);
    c.usersRepo.findById.mockResolvedValue(creatorWithWallet());
    return c;
  };
  it('denies another creator before saving evidence', async () => {
    const c = setup();
    await expect(
      c.service.submitCharityMilestone(
        mockProjectId,
        milestoneId,
        '507f1f77bcf86cd799439014',
        ['https://keibo.test/proof'],
      ),
    ).rejects.toThrow(ForbiddenException);
    expect(c.milestonesRepo.submitForReview).not.toHaveBeenCalled();
  });
  it('requires a verified creator and an atomic transition into review', async () => {
    const c = setup();
    c.milestonesRepo.submitForReview.mockResolvedValue({
      status: MilestoneStatus.IN_REVIEW,
    });
    await expect(
      c.service.submitCharityMilestone(
        mockProjectId,
        milestoneId,
        mockCreatorId,
        ['https://keibo.test/proof'],
      ),
    ).resolves.toMatchObject({ status: MilestoneStatus.IN_REVIEW });
    c.usersRepo.findById.mockResolvedValue({
      ...creatorWithWallet(),
      kycStatus: KYCStatus.PENDING,
      kyc: { status: KYCStatus.PENDING },
    });
    await expect(
      c.service.submitCharityMilestone(
        mockProjectId,
        milestoneId,
        mockCreatorId,
        ['https://keibo.test/proof'],
      ),
    ).rejects.toThrow();
    expect(c.milestonesRepo.submitForReview).toHaveBeenCalledTimes(1);
  });
  it('refuses approval without submitted evidence', async () => {
    const c = setup();
    c.milestonesRepo.findByIdForProject.mockResolvedValue({ proofLinks: [] });
    await expect(
      c.service.reviewCharityMilestone(
        mockProjectId,
        milestoneId,
        mockCreatorId,
        'APPROVED',
        'Evidence reviewed for test milestone',
      ),
    ).rejects.toThrow('Creator evidence is required');
    expect(c.milestonesRepo.review).not.toHaveBeenCalled();
  });
  it('records reviewer identity/reason and refuses stale approval', async () => {
    const c = setup();
    c.milestonesRepo.review.mockResolvedValue({
      status: MilestoneStatus.APPROVED,
    });
    await expect(
      c.service.reviewCharityMilestone(
        mockProjectId,
        milestoneId,
        mockCreatorId,
        'APPROVED',
        'Evidence reviewed for test milestone',
      ),
    ).resolves.toMatchObject({ status: MilestoneStatus.APPROVED });
    expect(c.milestonesRepo.review).toHaveBeenCalledWith(
      mockProjectId,
      milestoneId,
      MilestoneStatus.APPROVED,
      mockCreatorId,
      'Evidence reviewed for test milestone',
    );
    c.milestonesRepo.review.mockResolvedValue(null);
    await expect(
      c.service.reviewCharityMilestone(
        mockProjectId,
        milestoneId,
        mockCreatorId,
        'APPROVED',
        'Evidence reviewed for test milestone',
      ),
    ).rejects.toThrow('awaiting review');
  });
});

describe('Charity launch blocks investment campaign mutations', () => {
  it('blocks an old ROI campaign update or approval while retaining its stored code/data', async () => {
    const c = createService();
    c.configService.get.mockReturnValue('false');
    c.projectsRepo.findById.mockResolvedValue(roiProjectStub());
    await expect(
      c.service.updateProject(mockProjectId, mockCreatorId, {
        name: 'Hidden ROI change',
      } as UpdateProjectDto),
    ).rejects.toThrow('Investments are unavailable');
    await expect(
      c.service.decide(mockProjectId, { finalStatus: ProjectStatus.APPROVED }),
    ).rejects.toThrow('Investments are unavailable');
    expect(c.projectsRepo.updateById).not.toHaveBeenCalled();
    expect(c.projectsRepo.setStatus).not.toHaveBeenCalled();
  });
});
