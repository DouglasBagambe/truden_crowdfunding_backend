import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
import { MintStatus } from '../schemas/investment.schema';
import { CreateInvestmentDto } from '../dto/create-investment.dto';
import { UpdateInvestmentStatusDto } from '../dto/update-investment-status.dto';
import { FilterInvestmentsDto } from '../dto/filter-investments.dto';
import {
  InvestmentStatus,
  InvestmentView,
} from '../interfaces/investment.interface';
import { AuthService } from '../../auth/auth.service';
import { ProjectsService } from '../../projects/projects.service';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import type { JwtPayload } from '../../../common/interfaces/user.interface';
import { InvestmentNFTService } from './investment-nft.service';

// ─── NOTE ──────────────────────────────────────────────────────────────────────
// Blockchain / custodial-wallet / NFT code has been moved to the
// `blockchain/nfts-future` branch. This service now uses a pure fiat flow,
// mirroring the charity-donation system. Real investment records are created
// automatically by PaymentInvestmentListener after a successful DPO/Flutterwave
// payment (see listeners/payment-investment.listener.ts).
// ──────────────────────────────────────────────────────────────────────────────

interface AuthUserView {
  id: string;
  email?: string;
  role: UserRole[];
  isActive: boolean;
  lastLogin?: Date;
  kycStatus: KYCStatus;
}

@Injectable()
export class InvestmentsService {
  private readonly logger = new Logger(InvestmentsService.name);

  constructor(
    @InjectModel(Investment.name)
    private readonly investmentModel: Model<InvestmentDocument>,
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
    private readonly investmentNFTService: InvestmentNFTService,
  ) { }

  // ─── Helpers ────────────────────────────────────────────────────────────────

  private parseObjectId(id: string, fieldName: string): Types.ObjectId {
    if (!Types.ObjectId.isValid(id)) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return new Types.ObjectId(id);
  }

  private ensureInvestorRole(currentUser: JwtPayload) {
    const roles = currentUser.roles ?? [];
    if (!roles.includes(UserRole.INVESTOR)) {
      throw new ForbiddenException('Only investors can perform this action');
    }
  }

  private ensureAdminRole(currentUser: JwtPayload) {
    const roles = currentUser.roles ?? [];
    if (!roles.includes(UserRole.ADMIN)) {
      throw new ForbiddenException('Only admins can perform this action');
    }
  }

  private async loadAuthUser(userId: string): Promise<AuthUserView> {
    const profile = (await this.authService.getProfile(userId)) as unknown as AuthUserView;
    return profile;
  }

  private async safeLoadAuthUser(userId: string): Promise<AuthUserView | null> {
    try {
      return await this.loadAuthUser(userId);
    } catch {
      return null;
    }
  }

  // ─── Read API ────────────────────────────────────────────────────────────────

  async getInvestmentById(id: string, currentUser: JwtPayload): Promise<InvestmentView> {
    const investment = await this.investmentModel
      .findById(this.parseObjectId(id, 'id'))
      .exec();

    if (!investment) throw new NotFoundException('Investment not found');

    this.assertCanViewInvestment(investment, currentUser);

    const investorProfile = await this.safeLoadAuthUser(String(investment.investorId));
    return this.toView(investment, { investorKyc: investorProfile?.kycStatus });
  }

  async getMyInvestments(currentUser: JwtPayload): Promise<InvestmentView[]> {
    const userId = currentUser.sub;
    if (!userId) throw new BadRequestException('Missing user id in token');
    return this.getInvestmentsByUser(userId, currentUser);
  }

  async getInvestmentsByUser(userId: string, currentUser: JwtPayload): Promise<InvestmentView[]> {
    const isSelf = currentUser.sub === userId;
    const isAdmin = (currentUser.roles ?? []).includes(UserRole.ADMIN);
    if (!isSelf && !isAdmin) {
      throw new ForbiddenException('Not allowed to view investments for this user');
    }

    const investorObjectId = this.parseObjectId(userId, 'userId');
    const investments = await this.investmentModel
      .find({ investorId: investorObjectId })
      .sort({ createdAt: -1 })
      .populate('projectId')
      .exec();

    const investorProfile = await this.safeLoadAuthUser(userId);
    const mappedInvestments = investments.map((investment: any) => {
      const project = investment.projectId;
      return this.toView(investment, {
        investorKyc: investorProfile?.kycStatus,
        projectTitle: project?.title || project?.name,
        projectCategory: project?.category,
        projectType: project?.projectType || project?.type,
        projectCreatorId: project?.creatorId?.toString(),
      });
    });

    try {
      const donations = await this.projectsService.getDonationsByUser(userId);
      mappedInvestments.push(...donations);
    } catch (e) {
      // Safe fallback if donations fetch fails
    }

    return mappedInvestments.sort((a, b) => (new Date(b.createdAt).getTime()) - (new Date(a.createdAt).getTime()));
  }

  async getInvestmentsByProject(projectId: string, currentUser: JwtPayload): Promise<InvestmentView[]> {
    const roles = currentUser.roles ?? [];
    const canView = roles.includes(UserRole.ADMIN) || roles.includes(UserRole.INNOVATOR);
    if (!canView) {
      throw new ForbiddenException('Only admins and innovators can view project investors');
    }

    const projectObjectId = this.parseObjectId(projectId, 'projectId');
    const investments = await this.investmentModel
      .find({ projectId: projectObjectId })
      .sort({ createdAt: -1 })
      .exec();

    return investments.map((investment) => this.toView(investment));
  }

  async listInvestments(
    filterDto: FilterInvestmentsDto,
    currentUser: JwtPayload,
  ): Promise<{ items: InvestmentView[]; total: number }> {
    this.ensureAdminRole(currentUser);

    const filter: Record<string, unknown> = {};
    if (filterDto.userId) filter.investorId = this.parseObjectId(filterDto.userId, 'userId');
    if (filterDto.projectId) filter.projectId = this.parseObjectId(filterDto.projectId, 'projectId');
    if (filterDto.status) filter.status = filterDto.status;

    const limit = filterDto.limit ?? 25;
    const skip = filterDto.skip ?? 0;

    const [items, total] = await Promise.all([
      this.investmentModel.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).exec(),
      this.investmentModel.countDocuments(filter).exec(),
    ]);

    return { items: items.map((i) => this.toView(i)), total };
  }

  // ─── Mutations ───────────────────────────────────────────────────────────────

  /**
   * Direct (test/admin) investment creation — bypasses payment flow.
   * Production investments are created by PaymentInvestmentListener after
   * a successful DPO/Flutterwave payment.
   */
  async createInvestment(dto: CreateInvestmentDto, currentUser: JwtPayload): Promise<InvestmentView> {
    const testMode =
      String(this.configService.get('INVESTMENTS_TEST_MODE') ?? '').toLowerCase() === 'true';
    const allowDirectCreate =
      testMode &&
      ['development', 'test'].includes(
        String(this.configService.get('NODE_ENV') ?? '').toLowerCase(),
      );

    if (!allowDirectCreate) {
      throw new BadRequestException(
        'Direct investment creation is disabled. Use the DPO checkout flow.',
      );
    }

    this.ensureInvestorRole(currentUser);

    const kycBypass =
      String(this.configService.get('KYC_BYPASS') ?? '').toLowerCase() === 'true';

    const investorId = currentUser.sub;
    if (!investorId) throw new BadRequestException('Missing investor id in token');

    const amountNumber = Number(dto.amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const investorProfile = await this.loadAuthUser(investorId);
    if (!investorProfile.isActive) throw new ForbiddenException('Investor account is inactive');

    // Enforce KYC in production
    if (!kycBypass && !testMode && investorProfile.kycStatus !== KYCStatus.VERIFIED) {
      throw new ForbiddenException(
        investorProfile.kycStatus === KYCStatus.PENDING
          ? 'Your KYC is still under review. Please wait.'
          : 'You must complete identity verification (KYC) before investing.',
      );
    }

    const projectObjectId = this.parseObjectId(dto.projectId, 'projectId');
    const investorObjectId = this.parseObjectId(investorId, 'investorId');

    // Verify project is open for investment
    if (!testMode && !kycBypass) {
      await this.projectsService.ensureProjectIsOpenForInvestment(dto.projectId);
    }

    const investment = await this.investmentModel.create({
      projectId: projectObjectId,
      investorId: investorObjectId,
      amount: amountNumber,
      currency: dto.currency || 'UGX',
      txHash: null,
      status: InvestmentStatus.Active,
      notes: dto.notes,
    });

    await this.projectsService.incrementFunding(dto.projectId, amountNumber);

    return this.toView(investment, { investorKyc: investorProfile.kycStatus });
  }

  async updateStatus(
    id: string,
    dto: UpdateInvestmentStatusDto,
    currentUser: JwtPayload,
  ): Promise<InvestmentView> {
    this.ensureAdminRole(currentUser);

    const investment = await this.investmentModel
      .findById(this.parseObjectId(id, 'id'))
      .exec();

    if (!investment) throw new NotFoundException('Investment not found');

    if (!this.isValidTransition(investment.status, dto.status)) {
      throw new BadRequestException('Invalid investment status transition');
    }

    investment.status = dto.status;
    await investment.save();

    return this.toView(investment);
  }

  // ─── Private helpers ─────────────────────────────────────────────────────────

  private isValidTransition(from: InvestmentStatus, to: InvestmentStatus): boolean {
    const transitions: Record<InvestmentStatus, InvestmentStatus[]> = {
      [InvestmentStatus.Pending]: [InvestmentStatus.Active, InvestmentStatus.Refunded],
      [InvestmentStatus.Active]: [InvestmentStatus.Completed, InvestmentStatus.Refunded],
      [InvestmentStatus.Completed]: [],
      [InvestmentStatus.Refunded]: [],
    };
    return (transitions[from] ?? []).includes(to);
  }

  private assertCanViewInvestment(investment: InvestmentDocument, currentUser: JwtPayload) {
    const isOwner = currentUser.sub === String(investment.investorId);
    const isAdmin = (currentUser.roles ?? []).includes(UserRole.ADMIN);
    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Not allowed to view this investment');
    }
  }

  private toView(
    investment: InvestmentDocument,
    options?: {
      investorKyc?: KYCStatus;
      projectTitle?: string;
      projectCategory?: string;
      projectType?: string;
      projectCreatorId?: string;
    },
  ): InvestmentView {
    const createdAt = (investment as any).createdAt ?? new Date();
    const updatedAt = (investment as any).updatedAt ?? createdAt;
    const projectDoc = investment.projectId as any;
    const projectIdString = projectDoc?._id
      ? projectDoc._id.toString()
      : String(investment.projectId);
    const investorIdString = (investment.investorId as any)?._id
      ? (investment.investorId as any)._id.toString()
      : String(investment.investorId);

    return {
      id: investment._id ? investment._id.toString() : (investment as any).id,
      projectId: projectIdString,
      investorId: investorIdString,
      amount: Number(investment.amount),
      currency: (investment as any).currency ?? 'UGX',
      txHash: investment.txHash ?? null,
      walletAddress: (investment as any).walletAddress ?? null,
      nftProjectId: (investment as any).nftProjectId ?? null,
      nftTokenAmount: (investment as any).nftTokenAmount ?? null,
      nftTxHash: (investment as any).nftTxHash ?? null,
      nftMetadataUri: (investment as any).nftMetadataUri ?? null,
      nftMinted: (investment as any).nftMinted ?? false,
      listed: (investment as any).listed ?? false,
      nft: {
        projectId: (investment as any).nftProjectId ?? null,
        tokenAmount: (investment as any).nftTokenAmount ?? null,
        txHash: (investment as any).nftTxHash ?? null,
        metadataUri: (investment as any).nftMetadataUri ?? null,
        minted: (investment as any).nftMinted ?? false,
        listed: (investment as any).listed ?? false,
      },
      status: investment.status,
      createdAt,
      updatedAt,
      project: {
        id: projectIdString,
        title: options?.projectTitle || projectDoc?.title || projectDoc?.name,
        category: options?.projectCategory || projectDoc?.category,
        type: options?.projectType || projectDoc?.projectType || projectDoc?.type,
        creatorId: options?.projectCreatorId || projectDoc?.creatorId?.toString(),
      },
      investor: {
        id: investorIdString,
        kycStatus: options?.investorKyc,
        walletAddress: (investment as any).walletAddress ?? null,
      },
    };
  }

  /**
   * Admin: retry NFT minting for a single investment whose mintStatus is FAILED or PENDING.
   * Fetches the investment, validates the project is provisioned, attempts mint, persists result.
   */
  async retryFailedNftMint(
    investmentId: string,
  ): Promise<{
    investmentId: string;
    result: 'MINTED' | 'SKIPPED' | 'FAILED';
    reason?: string;
    nftTxHash?: string;
  }> {
    if (!Types.ObjectId.isValid(investmentId)) {
      throw new BadRequestException('Invalid investmentId');
    }

    const investment = await this.investmentModel.findById(investmentId).exec();
    if (!investment) throw new NotFoundException('Investment not found');

    // Only retry FAILED or PENDING mints — skip already MINTED or BYPASSED
    const currentMintStatus = (investment as any).mintStatus as MintStatus;
    if (currentMintStatus === MintStatus.MINTED) {
      return { investmentId, result: 'SKIPPED', reason: 'NFT already minted' };
    }
    if (currentMintStatus === MintStatus.BYPASSED) {
      return { investmentId, result: 'SKIPPED', reason: 'Investment in bypass mode — remove bypass flag to enable minting' };
    }

    const walletAddress = (investment as any).walletAddress as string | null;
    if (!walletAddress) {
      return {
        investmentId,
        result: 'FAILED',
        reason: 'No wallet address on investment — investor must connect wallet first',
      };
    }

    const projectId = String(investment.projectId);
    const project = await this.projectsService.ensureProjectExists(projectId);
    const projectOnchainId = String((project as any).projectOnchainId || '').trim();

    if (!projectOnchainId || projectOnchainId === '0') {
      await this.investmentModel.findByIdAndUpdate(investmentId, {
        mintStatus: MintStatus.FAILED,
        mintError: 'Project not provisioned on-chain — run provision-onchain repair first',
      });
      return {
        investmentId,
        result: 'FAILED',
        reason: 'Project has no on-chain ID. Run POST /admin/projects/:id/provision-onchain first.',
      };
    }

    try {
      const mintResult = await this.investmentNFTService.mintForUser(
        walletAddress,
        projectOnchainId,
        Number(investment.amount),
        investmentId,
      );

      await this.investmentModel.findByIdAndUpdate(investmentId, {
        nftProjectId: mintResult.tokenId,
        nftTokenAmount: mintResult.tokenAmount,
        nftTxHash: mintResult.txHash,
        nftMinted: true,
        mintStatus: MintStatus.MINTED,
        mintError: null,
      });

      this.logger.log(
        `NFT mint retry succeeded for investment ${investmentId}: txHash=${mintResult.txHash}`,
      );

      return { investmentId, result: 'MINTED', nftTxHash: mintResult.txHash };
    } catch (err: unknown) {
      const errMsg = err instanceof Error ? err.message : String(err);
      await this.investmentModel.findByIdAndUpdate(investmentId, {
        mintStatus: MintStatus.FAILED,
        mintError: errMsg,
      });
      this.logger.error(`NFT mint retry failed for investment ${investmentId}: ${errMsg}`);
      return { investmentId, result: 'FAILED', reason: errMsg };
    }
  }

  /**
   * Admin: scan all investments with mintStatus=FAILED or mintStatus=PENDING that have
   * a walletAddress, and retry NFT minting for each one.
   * Idempotent — already-MINTED investments are skipped automatically.
   */
  async retryAllFailedNftMints(): Promise<{
    total: number;
    minted: number;
    skipped: number;
    failed: number;
    results: Array<{
      investmentId: string;
      result: 'MINTED' | 'SKIPPED' | 'FAILED';
      reason?: string;
      nftTxHash?: string;
    }>;
  }> {
    const candidates = await this.investmentModel
      .find({
        mintStatus: { $in: [MintStatus.FAILED, MintStatus.PENDING] },
        walletAddress: { $ne: null, $exists: true },
        nftMinted: false,
      })
      .limit(500)
      .exec();

    let minted = 0;
    let skipped = 0;
    let failed = 0;
    const results: Array<{
      investmentId: string;
      result: 'MINTED' | 'SKIPPED' | 'FAILED';
      reason?: string;
      nftTxHash?: string;
    }> = [];

    for (const inv of candidates) {
      const id = String(inv._id);
      const r = await this.retryFailedNftMint(id);
      results.push(r);
      if (r.result === 'MINTED') minted++;
      else if (r.result === 'SKIPPED') skipped++;
      else failed++;
    }

    this.logger.log(
      `NFT mint batch retry: total=${candidates.length} minted=${minted} skipped=${skipped} failed=${failed}`,
    );

    return { total: candidates.length, minted, skipped, failed, results };
  }

  async repairDatabase() {
    const allowRepair =
      String(this.configService.get('ALLOW_DB_REPAIR') ?? '').toLowerCase() === 'true';
    const isProduction =
      String(this.configService.get('NODE_ENV') ?? '').toLowerCase() === 'production';

    if (!allowRepair || isProduction) {
      throw new ForbiddenException('Database repair endpoint is disabled in this environment');
    }

    const db = this.investmentModel.db;
    let fixedDonations = 0;
    let fixedWallets = 0;

    // 1. Fix Charity Donations missing userId
    const donations = await db.collection('charity_donations').find({ userId: { $exists: false } }).toArray();
    for (const d of donations) {
      if (d.donorName) {
        let u = await db.collection('users').findOne({ email: d.donorName });
        if (!u) u = await db.collection('users').findOne({ 'profile.displayName': d.donorName });
        if (u) {
          await db.collection('charity_donations').updateOne({ _id: d._id }, { $set: { userId: u._id } });
          fixedDonations++;
        }
      }
    }

    // 2. Accurately recalculate Wallets based on sum of project raisedAmounts per type
    const usersCursor = await db.collection('users').find().toArray();

    for (const user of usersCursor) {
      const creatorId = user._id;

      // Calculate total raised exactly from projects where this user is the creator
      const projects = await db.collection('projects').find({
        creatorId: { $in: [creatorId, creatorId.toString()] }
      }).toArray();
      if (projects.length === 0) continue;

      let expectedCharity = 0;
      let expectedRoi = 0;

      for (const p of projects) {
        const type = (p.projectType || '').toUpperCase();
        const amt = p.raisedAmount || 0;
        if (type === 'CHARITY') expectedCharity += amt;
        else if (type === 'ROI') expectedRoi += amt;
        else expectedCharity += amt; // Fallback
      }

      if (expectedCharity > 0 || expectedRoi > 0 || projects.length > 0) {
        const wallet = await db.collection('wallets').findOne({
          userId: { $in: [creatorId, creatorId.toString()] }
        });
        if (wallet) {
          // Always overwrite — don't skip on equality, data may be stale
          await db.collection('wallets').updateOne(
            { _id: wallet._id },
            {
              $set: {
                'fiatBalance.UGX': expectedCharity,
                'roiBalance.UGX': expectedRoi
              }
            }
          );
          fixedWallets++;
        } else if (expectedCharity > 0 || expectedRoi > 0) {
          // No wallet exists — create one now
          await db.collection('wallets').insertOne({
            userId: creatorId,
            fiatBalance: { UGX: expectedCharity, USD: 0 },
            roiBalance: { UGX: expectedRoi, USD: 0 },
            cryptoBalance: { ETH: 0, USDC: 0 },
            totalBalanceUSD: 0,
            withdrawalMethods: [],
            createdAt: new Date(),
            updatedAt: new Date(),
          });
          fixedWallets++;
        }
      }
    }

    return { success: true, fixedDonations, fixedWallets, message: "Database accurately synchronized separated balances!" };
  }
}
