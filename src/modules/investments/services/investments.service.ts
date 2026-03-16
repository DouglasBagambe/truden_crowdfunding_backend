import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
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
  constructor(
    @InjectModel(Investment.name)
    private readonly investmentModel: Model<InvestmentDocument>,
    private readonly authService: AuthService,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
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
    this.ensureInvestorRole(currentUser);
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
    return investments.map((investment: any) => {
      const project = investment.projectId;
      return this.toView(investment, {
        investorKyc: investorProfile?.kycStatus,
        projectTitle: project?.title || project?.name,
        projectCategory: project?.category,
        projectType: project?.projectType || project?.type,
        projectCreatorId: project?.creatorId?.toString(),
      });
    });
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
    this.ensureInvestorRole(currentUser);

    const kycBypass =
      String(this.configService.get('KYC_BYPASS') ?? '').toLowerCase() === 'true';
    const testMode =
      String(this.configService.get('INVESTMENTS_TEST_MODE') ?? '').toLowerCase() === 'true';

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
      // NFT fields intentionally absent — see blockchain/nfts-future branch
      nftId: null,
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
      },
    };
  }
}
