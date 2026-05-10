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
import { OnchainProvisioningStatus } from './schemas/project.schema';

const mockProjectId = '507f1f77bcf86cd799439011';
const mockCreatorId = '507f1f77bcf86cd799439012';

// ─────────────────────────────────────────────────────────────────────────────
// Test factory
// ─────────────────────────────────────────────────────────────────────────────

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
  const configService = {
    get: jest.fn(),
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
    createProjectNFT: jest.fn(),
    mintInvestmentTokens: jest.fn(),
    getDiagnostics: jest.fn().mockReturnValue({
      chainId: 84532,
      rpcUrl: 'https://example-rpc.test',
      nftAddress: '0x0000000000000000000000000000000000000001',
    }),
  };

  const service = new ProjectsService(
    projectsRepo as any,
    milestonesRepo as any,
    charityDonationsRepo as any,
    usersRepo as any,
    configService as any,
    agreementTemplatesService as any,
    attachmentRequirementsService as any,
    attachmentFilesRepo as any,
    viemNftClient as any,
    investmentModel as any,
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
    jest.spyOn(service, 'getProjectWithMilestones').mockResolvedValue(result as any);

    const response = await service.createProject(mockCreatorId, dto as any);

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        projectType: ProjectType.ROI,
        name: 'Tech Academy',
        status: ProjectStatus.PENDING_REVIEW,
      }),
    );
    expect(milestonesRepo.createMany).not.toHaveBeenCalled();
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
    jest.spyOn(service, 'getProjectWithMilestones').mockResolvedValue(result as any);

    await service.createProject(mockCreatorId, dto as any);

    expect(projectsRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({ projectType: ProjectType.CHARITY, category: 'school' }),
    );
    expect(milestonesRepo.createMany).toHaveBeenCalledWith(
      mockProjectId,
      expect.arrayContaining([expect.objectContaining({ title: 'Phase 1', status: MilestoneStatus.PLANNED })]),
    );
  });

  it('rejects charity projects without category', async () => {
    const { service } = createService();
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.CHARITY, name: 'X', summary: 'S', story: 'S',
        country: 'KE', beneficiary: 'P', paymentMethod: 'mpesa',
        targetAmount: 10, currency: 'KES',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('rejects ROI projects without industry', async () => {
    const { service } = createService();
    await expect(
      service.createProject(mockCreatorId, {
        type: ProjectType.ROI, name: 'X', summary: 'S', story: 'S',
        country: 'KE', beneficiary: 'P', paymentMethod: 'mpesa',
        targetAmount: 10, currency: 'KES',
      } as any),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('prevents updating project not owned by user', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      id: mockProjectId,
      creatorId: '507f1f77bcf86cd799439013',
      status: ProjectStatus.DRAFT,
    });
    await expect(
      service.updateProject(mockProjectId, '507f1f77bcf86cd799439014', { summary: 'new' } as any),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('blocks access to non-public project (e.g. REJECTED)', async () => {
    const { service, projectsRepo } = createService();
    projectsRepo.findById.mockResolvedValue({
      status: ProjectStatus.REJECTED,
      projectType: ProjectType.CHARITY,
    });
    await expect(service.getProjectPublic(mockProjectId)).rejects.toBeInstanceOf(NotFoundException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: ROI approval provisioning
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — ROI approval provisioning', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ROI approval success: provisions on-chain then sets status=FUNDING', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    const project = roiProjectStub();
    projectsRepo.findById.mockResolvedValue(project);
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockResolvedValue({ hash: '0xhash', receipt: {} });
    projectsRepo.updateById.mockResolvedValue({ ...project, status: ProjectStatus.FUNDING });

    await service.decide(mockProjectId, { finalStatus: ProjectStatus.APPROVED } as any);

    // Verifies PENDING was written before provisioning attempt
    expect(projectsRepo.updateById).toHaveBeenCalledWith(
      mockProjectId,
      expect.objectContaining({
        $set: expect.objectContaining({ onchainProvisioningStatus: OnchainProvisioningStatus.PENDING }),
      }),
    );

    // Verifies createProjectNFT was called
    expect(viemNftClient.createProjectNFT).toHaveBeenCalledWith(
      expect.objectContaining({ creator: creatorWithWallet().primaryWallet }),
    );

    // Final status write must include FUNDING
    const lastCall = projectsRepo.updateById.mock.calls[projectsRepo.updateById.mock.calls.length - 1];
    expect(lastCall[1].$set).toMatchObject({ status: ProjectStatus.FUNDING });
  });

  it('ROI approval failure: persists FAILED state, does NOT set FUNDING, re-throws', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue(roiProjectStub());
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockRejectedValue(new Error('RPC timeout'));
    projectsRepo.updateById.mockResolvedValue({});

    await expect(
      service.decide(mockProjectId, { finalStatus: ProjectStatus.APPROVED } as any),
    ).rejects.toBeInstanceOf(BadRequestException);

    // FAILED state must have been written
    expect(projectsRepo.updateById).toHaveBeenCalledWith(
      mockProjectId,
      expect.objectContaining({
        $set: expect.objectContaining({
          onchainProvisioningStatus: OnchainProvisioningStatus.FAILED,
          onchainProvisioningError: expect.stringContaining('RPC timeout'),
        }),
      }),
    );

    // FUNDING must NOT have been set
    for (const call of projectsRepo.updateById.mock.calls) {
      expect(call[1]?.$set?.status).not.toBe(ProjectStatus.FUNDING);
    }
  });

  it('charity approval is unaffected by provisioning logic', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue({
      _id: mockProjectId,
      projectType: ProjectType.CHARITY,
      status: ProjectStatus.PENDING_REVIEW,
      creatorId: mockCreatorId,
      attachments: [],
      toObject: jest.fn().mockReturnThis(),
    });
    usersRepo.findById.mockResolvedValue({ email: 'a@b.com' });
    projectsRepo.updateById.mockResolvedValue({});

    await service.decide(mockProjectId, { finalStatus: ProjectStatus.APPROVED } as any);

    // createProjectNFT must NOT be called for charity
    expect(viemNftClient.createProjectNFT).not.toHaveBeenCalled();
    expect(projectsRepo.updateById).toHaveBeenCalledWith(
      mockProjectId,
      expect.objectContaining({ $set: expect.objectContaining({ status: ProjectStatus.APPROVED }) }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: ensureProjectProvisionedOnChain (idempotency)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — ensureProjectProvisionedOnChain', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns existing id without calling contract when already provisioned', async () => {
    const { service, projectsRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ projectOnchainId: '123456789', onchainProvisioningStatus: OnchainProvisioningStatus.READY }),
    );
    projectsRepo.updateById.mockResolvedValue({});

    const result = await service.ensureProjectProvisionedOnChain(mockProjectId);

    expect(result.projectOnchainId).toBe('123456789');
    expect(viemNftClient.createProjectNFT).not.toHaveBeenCalled();
  });

  it('throws BadRequest when creator has no wallet', async () => {
    const { service, projectsRepo, usersRepo } = createService();

    projectsRepo.findById.mockResolvedValue(roiProjectStub());
    usersRepo.findById.mockResolvedValue({ ...creatorWithWallet(), primaryWallet: undefined, linkedWallets: [] });

    await expect(
      service.ensureProjectProvisionedOnChain(mockProjectId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('throws BadRequest when project is not ROI', async () => {
    const { service, projectsRepo } = createService();

    projectsRepo.findById.mockResolvedValue({
      _id: mockProjectId,
      projectType: ProjectType.CHARITY,
      status: ProjectStatus.FUNDING,
    });

    await expect(
      service.ensureProjectProvisionedOnChain(mockProjectId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: checkout provisioning gate
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — ROI checkout provisioning gate', () => {
  beforeEach(() => jest.clearAllMocks());

  it('strict mode (default): rejects ROI checkout when projectOnchainId is missing', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ status: ProjectStatus.FUNDING, projectOnchainId: undefined }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'true';
      return undefined;
    });

    await expect(
      service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).rejects.toThrow(/not yet been provisioned/);
  });

  it('strict mode: gives precise FAILED error when provisioning previously failed', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({
        status: ProjectStatus.APPROVED,
        projectOnchainId: undefined,
        onchainProvisioningStatus: OnchainProvisioningStatus.FAILED,
        onchainProvisioningError: 'Gas estimating failed',
      }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'true';
      return undefined;
    });

    await expect(
      service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).rejects.toThrow(/provisioning previously failed/);
  });

  it('bypass mode: allows ROI checkout without projectOnchainId', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ status: ProjectStatus.FUNDING, projectOnchainId: undefined }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'false';
      return undefined;
    });

    const result = await service.ensureProjectIsOpenForInvestment(mockProjectId);
    expect(result).toBeDefined();
  });

  it('strict mode: allows checkout when projectOnchainId is valid', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ status: ProjectStatus.FUNDING, projectOnchainId: '987654321' }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'true';
      return undefined;
    });

    const result = await service.ensureProjectIsOpenForInvestment(mockProjectId);
    expect(result).toBeDefined();
  });

  it('legacy APPROVED ROI projects without onchainId are blocked in strict mode', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ status: ProjectStatus.APPROVED, projectOnchainId: undefined }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'true';
      return undefined;
    });

    await expect(
      service.ensureProjectIsOpenForInvestment(mockProjectId),
    ).rejects.toBeInstanceOf(BadRequestException);
  });

  it('legacy APPROVED ROI projects are allowed in bypass mode', async () => {
    const { service, projectsRepo, configService } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ status: ProjectStatus.APPROVED, projectOnchainId: undefined }),
    );
    configService.get.mockImplementation((key: string) => {
      if (key === 'ROI_REQUIRE_ONCHAIN_PROVISIONING') return 'false';
      return undefined;
    });

    const result = await service.ensureProjectIsOpenForInvestment(mockProjectId);
    expect(result).toBeDefined();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: repairRoiProjectProvisioning (single repair)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — repairRoiProjectProvisioning', () => {
  beforeEach(() => jest.clearAllMocks());

  it('repairs a legacy APPROVED ROI project: provisions + promotes to FUNDING', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue(roiProjectStub({ status: ProjectStatus.APPROVED }));
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockResolvedValue({ hash: '0xhash', receipt: {} });
    projectsRepo.updateById.mockResolvedValue({});

    const result = await service.repairRoiProjectProvisioning(mockProjectId);

    expect(result.result).toBe('PROVISIONED');
    expect(result.projectOnchainId).toBeDefined();

    // The project was APPROVED so it should have been promoted to FUNDING
    expect(projectsRepo.updateById).toHaveBeenCalledWith(
      mockProjectId,
      expect.objectContaining({
        $set: expect.objectContaining({ status: ProjectStatus.FUNDING }),
      }),
    );
  });

  it('returns ALREADY_PROVISIONED without calling contract when id already set', async () => {
    const { service, projectsRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue(
      roiProjectStub({ projectOnchainId: '99887766', onchainProvisioningStatus: OnchainProvisioningStatus.READY }),
    );
    projectsRepo.updateById.mockResolvedValue({});

    const result = await service.repairRoiProjectProvisioning(mockProjectId);

    expect(result.result).toBe('ALREADY_PROVISIONED');
    expect(viemNftClient.createProjectNFT).not.toHaveBeenCalled();
  });

  it('returns FAILED and persists error when contract call throws', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    projectsRepo.findById.mockResolvedValue(roiProjectStub());
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockRejectedValue(new Error('Nonce too low'));
    projectsRepo.updateById.mockResolvedValue({});

    const result = await service.repairRoiProjectProvisioning(mockProjectId);

    expect(result.result).toBe('FAILED');
    expect(result.error).toContain('Nonce too low');

    expect(projectsRepo.updateById).toHaveBeenCalledWith(
      mockProjectId,
      expect.objectContaining({
        $set: expect.objectContaining({
          onchainProvisioningStatus: OnchainProvisioningStatus.FAILED,
          onchainProvisioningError: expect.stringContaining('Nonce too low'),
        }),
      }),
    );
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// Suite: backfillRoiProvisioning (batch scan)
// ─────────────────────────────────────────────────────────────────────────────

describe('ProjectsService — backfillRoiProvisioning', () => {
  beforeEach(() => jest.clearAllMocks());

  it('skips already-provisioned projects and processes unprovisioned ones', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    const alreadyProvisioned = roiProjectStub({
      _id: '507f1f77bcf86cd799439020',
      id: '507f1f77bcf86cd799439020',
      projectOnchainId: '111222333',
      onchainProvisioningStatus: OnchainProvisioningStatus.READY,
    });
    const needsProvisioning = roiProjectStub({
      _id: '507f1f77bcf86cd799439021',
      id: '507f1f77bcf86cd799439021',
      projectOnchainId: undefined,
    });

    // query returns both candidates (repo query is called once for batch scan)
    projectsRepo.query.mockResolvedValue([alreadyProvisioned, needsProvisioning]);

    // For the repair of the unprovisioned project:
    projectsRepo.findById.mockImplementation((id: string) => {
      if (id === '507f1f77bcf86cd799439020') return Promise.resolve(alreadyProvisioned);
      if (id === '507f1f77bcf86cd799439021') return Promise.resolve(needsProvisioning);
      return Promise.resolve(null);
    });
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockResolvedValue({ hash: '0xhash', receipt: {} });
    projectsRepo.updateById.mockResolvedValue({});

    const report = await service.backfillRoiProvisioning();

    // alreadyProvisioned has valid projectOnchainId so the batch skips it inline
    expect(report.skipped).toBe(1);
    expect(report.provisioned).toBe(1);
    expect(report.failed).toBe(0);
    expect(report.total).toBe(2);
  });

  it('records failures without crashing the batch', async () => {
    const { service, projectsRepo, usersRepo, viemNftClient } = createService();

    const failingProject = roiProjectStub({
      _id: '507f1f77bcf86cd799439030',
      id: '507f1f77bcf86cd799439030',
      projectOnchainId: undefined,
    });

    projectsRepo.query.mockResolvedValue([failingProject]);
    projectsRepo.findById.mockResolvedValue(failingProject);
    usersRepo.findById.mockResolvedValue(creatorWithWallet());
    viemNftClient.createProjectNFT.mockRejectedValue(new Error('Contract reverted'));
    projectsRepo.updateById.mockResolvedValue({});

    const report = await service.backfillRoiProvisioning();

    expect(report.failed).toBe(1);
    expect(report.provisioned).toBe(0);
    expect(report.results[0].result).toBe('FAILED');
    expect(report.results[0].error).toContain('Contract reverted');
  });

  it('returns empty report when no candidates exist', async () => {
    const { service, projectsRepo } = createService();

    projectsRepo.query.mockResolvedValue([]);

    const report = await service.backfillRoiProvisioning();

    expect(report.total).toBe(0);
    expect(report.skipped).toBe(0);
    expect(report.provisioned).toBe(0);
    expect(report.failed).toBe(0);
    expect(report.results).toHaveLength(0);
  });
});
