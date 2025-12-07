import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { ConfigService } from '@nestjs/config';
import { Model, Types } from 'mongoose';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Abi,
  type Address,
  type Chain,
  type Hash,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { Investment, InvestmentDocument } from '../schemas/investment.schema';
import { CreateInvestmentDto } from '../dto/create-investment.dto';
import { UpdateInvestmentStatusDto } from '../dto/update-investment-status.dto';
import { FilterInvestmentsDto } from '../dto/filter-investments.dto';
import {
  InvestmentStatus,
  InvestmentView,
} from '../interfaces/investment.interface';
import { AuthService } from '../../auth/auth.service';
import { EscrowService } from '../../escrow/services/escrow.service';
import { ProjectsService } from '../../projects/projects.service';
import { EscrowCurrency, FundingSource } from '../../escrow/types';
import type { DepositDto } from '../../escrow/dto/deposit.dto';
import { KYCStatus, UserRole } from '../../../common/enums/role.enum';
import type { JwtPayload } from '../../../common/interfaces/user.interface';

interface AuthUserView {
  id: string;
  email?: string;
  walletAddress?: string;
  role: UserRole[];
  isActive: boolean;
  lastLogin?: Date;
  kycStatus: KYCStatus;
}

const ESCROW_ABI = [
  {
    type: 'function',
    name: 'deposit',
    stateMutability: 'payable',
    inputs: [
      { name: 'projectId', type: 'string' },
      { name: 'investor', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'projectId', type: 'string' }],
    outputs: [],
  },
] as const satisfies Abi;

const INVESTMENT_NFT_ABI = [
  {
    type: 'function',
    name: 'mintNFT',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'to', type: 'address' },
      { name: 'projectId', type: 'string' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: 'tokenId', type: 'uint256' }],
  },
] as const satisfies Abi;

type Hex = `0x${string}`;

@Injectable()
export class InvestmentsService {
  constructor(
    @InjectModel(Investment.name)
    private readonly investmentModel: Model<InvestmentDocument>,
    private readonly authService: AuthService,
    private readonly escrowService: EscrowService,
    private readonly projectsService: ProjectsService,
    private readonly configService: ConfigService,
  ) {}

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

  async createInvestment(
    dto: CreateInvestmentDto,
    currentUser: JwtPayload,
  ): Promise<InvestmentView> {
    this.ensureInvestorRole(currentUser);

    const investorId = currentUser.sub;
    if (!investorId) {
      throw new BadRequestException('Missing investor id in token');
    }

    const amountNumber = Number(dto.amount);
    if (!Number.isFinite(amountNumber) || amountNumber <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    const investorProfile = await this.loadAuthUser(investorId);
    if (!investorProfile.isActive) {
      throw new ForbiddenException('Investor account is inactive');
    }

    if (investorProfile.kycStatus !== KYCStatus.VERIFIED) {
      throw new ForbiddenException('Investor KYC is not verified');
    }

    const walletAddress =
      investorProfile.walletAddress ?? currentUser.walletAddress;
    if (!walletAddress) {
      throw new BadRequestException('Investor wallet address is required');
    }

    const projectObjectId = this.parseObjectId(dto.projectId, 'projectId');
    const investorObjectId = this.parseObjectId(investorId, 'investorId');

    await this.ensureProjectIsOpen(dto.projectId);

    const txHash = await this.simulateEscrowDeposit(
      dto.projectOnchainId ?? dto.projectId,
      walletAddress,
      amountNumber,
    );

    const nftId = await this.simulateMintInvestmentNft(
      walletAddress,
      dto.projectId,
      amountNumber,
    );

    const depositDto: DepositDto = {
      projectId: dto.projectId,
      amount: dto.amount,
      currency: EscrowCurrency.ETH,
      source: FundingSource.ONCHAIN,
      txHash: txHash ?? undefined,
      metadata: {
        investorWallet: walletAddress,
      },
    };

    await this.escrowService.createDeposit(depositDto, investorId);

    const investment = await this.investmentModel.create({
      projectId: projectObjectId,
      investorId: investorObjectId,
      amount: amountNumber,
      nftId,
      txHash,
      status: InvestmentStatus.Pending,
    });

    await this.incrementProjectRaised(dto.projectId, amountNumber);

    return this.toView(investment, {
      investorWallet: walletAddress,
      investorKyc: investorProfile.kycStatus,
      nftMetadata: null,
    });
  }

  async getInvestmentById(
    id: string,
    currentUser: JwtPayload,
  ): Promise<InvestmentView> {
    const investment = await this.investmentModel
      .findById(this.parseObjectId(id, 'id'))
      .exec();

    if (!investment) {
      throw new NotFoundException('Investment not found');
    }

    this.assertCanViewInvestment(investment, currentUser);

    const investorProfile = await this.safeLoadAuthUser(
      String(investment.investorId),
    );

    return this.toView(investment, {
      investorWallet: investorProfile?.walletAddress,
      investorKyc: investorProfile?.kycStatus,
      nftMetadata: null,
    });
  }

  async getInvestmentsByUser(
    userId: string,
    currentUser: JwtPayload,
  ): Promise<InvestmentView[]> {
    const isSelf = currentUser.sub === userId;
    const isAdmin = (currentUser.roles ?? []).includes(UserRole.ADMIN);

    if (!isSelf && !isAdmin) {
      throw new ForbiddenException(
        'Not allowed to view investments for this user',
      );
    }

    const investorObjectId = this.parseObjectId(userId, 'userId');

    const investments = await this.investmentModel
      .find({ investorId: investorObjectId })
      .sort({ createdAt: -1 })
      .exec();

    const investorProfile = await this.safeLoadAuthUser(userId);

    return investments.map((investment) =>
      this.toView(investment, {
        investorWallet: investorProfile?.walletAddress,
        investorKyc: investorProfile?.kycStatus,
        nftMetadata: null,
      }),
    );
  }

  async getInvestmentsByProject(
    projectId: string,
    currentUser: JwtPayload,
  ): Promise<InvestmentView[]> {
    const roles = currentUser.roles ?? [];
    const canViewProject =
      roles.includes(UserRole.ADMIN) || roles.includes(UserRole.INNOVATOR);

    if (!canViewProject) {
      throw new ForbiddenException(
        'Only admins and innovators can view project investors',
      );
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

    if (filterDto.userId) {
      filter.investorId = this.parseObjectId(filterDto.userId, 'userId');
    }

    if (filterDto.projectId) {
      filter.projectId = this.parseObjectId(filterDto.projectId, 'projectId');
    }

    if (filterDto.status) {
      filter.status = filterDto.status;
    }

    const limit = filterDto.limit ?? 25;
    const skip = filterDto.skip ?? 0;

    const [items, total] = await Promise.all([
      this.investmentModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .exec(),
      this.investmentModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((investment) => this.toView(investment)),
      total,
    };
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

    if (!investment) {
      throw new NotFoundException('Investment not found');
    }

    const fromStatus = investment.status;
    const toStatus = dto.status;

    if (!this.isValidTransition(fromStatus, toStatus)) {
      throw new BadRequestException('Invalid investment status transition');
    }

    investment.status = toStatus;
    await investment.save();

    if (toStatus === InvestmentStatus.Refunded) {
      await this.simulateEscrowRefund(investment);
    }

    return this.toView(investment);
  }

  private isValidTransition(
    from: InvestmentStatus,
    to: InvestmentStatus,
  ): boolean {
    const transitions: Record<InvestmentStatus, InvestmentStatus[]> = {
      [InvestmentStatus.Pending]: [
        InvestmentStatus.Active,
        InvestmentStatus.Refunded,
      ],
      [InvestmentStatus.Active]: [
        InvestmentStatus.Completed,
        InvestmentStatus.Refunded,
      ],
      [InvestmentStatus.Completed]: [],
      [InvestmentStatus.Refunded]: [],
    };

    const allowedTargets = transitions[from] ?? [];
    return allowedTargets.includes(to);
  }

  private assertCanViewInvestment(
    investment: InvestmentDocument,
    currentUser: JwtPayload,
  ) {
    const isOwner = currentUser.sub === String(investment.investorId);
    const isAdmin = (currentUser.roles ?? []).includes(UserRole.ADMIN);

    if (!isOwner && !isAdmin) {
      throw new ForbiddenException('Not allowed to view this investment');
    }
  }

  private async ensureProjectIsOpen(projectId: string): Promise<void> {
    if (!Types.ObjectId.isValid(projectId)) {
      throw new BadRequestException('Invalid projectId');
    }

    await this.projectsService.ensureProjectIsOpenForInvestment(projectId);
  }

  private async incrementProjectRaised(
    projectId: string,
    amount: number,
  ): Promise<void> {
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid amount');
    }

    await this.projectsService.incrementFunding(projectId, amount);
  }

  private getBlockchainClients() {
    const blockchain = this.configService.get<{
      rpcUrl?: string;
      chainId?: number;
      contracts?: { escrow?: string; nft?: string };
      adminPrivateKey?: string;
    }>('blockchain');

    if (!blockchain?.rpcUrl || !blockchain.chainId) {
      throw new BadRequestException('Blockchain RPC configuration is missing');
    }

    if (!blockchain.adminPrivateKey) {
      throw new BadRequestException(
        'Blockchain admin private key is not configured',
      );
    }

    const chain: Chain = {
      id: blockchain.chainId,
      name: 'CrowdfundingChain',
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: {
        default: { http: [blockchain.rpcUrl] },
        public: { http: [blockchain.rpcUrl] },
      },
    };

    const rawKey = blockchain.adminPrivateKey.trim();
    const normalizedKey = (rawKey.startsWith('0x')
      ? rawKey
      : `0x${rawKey}`) as Hex;

    const account = privateKeyToAccount(normalizedKey);

    const publicClient = createPublicClient({
      chain,
      transport: http(blockchain.rpcUrl),
    });

    const walletClient = createWalletClient({
      chain,
      transport: http(blockchain.rpcUrl),
      account,
    });

    return { blockchain, publicClient, walletClient };
  }

  private async simulateEscrowDeposit(
    projectOnchainId: string,
    investorWallet: string,
    amount: number,
  ): Promise<string | null> {
    const { blockchain, publicClient, walletClient } =
      this.getBlockchainClients();

    if (!blockchain.contracts?.escrow) {
      throw new BadRequestException('Escrow contract address is not configured');
    }

    const value = BigInt(Math.floor(amount * 1e18));

    const hash: Hash = await walletClient.writeContract({
      address: blockchain.contracts.escrow as Address,
      abi: ESCROW_ABI,
      functionName: 'deposit',
      args: [projectOnchainId, investorWallet as Address, value],
      value,
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return hash;
  }

  private async simulateEscrowRefund(
    investment: InvestmentDocument,
  ): Promise<void> {
    const { blockchain, publicClient, walletClient } =
      this.getBlockchainClients();

    if (!blockchain.contracts?.escrow) {
      throw new BadRequestException('Escrow contract address is not configured');
    }

    const hash: Hash = await walletClient.writeContract({
      address: blockchain.contracts.escrow as Address,
      abi: ESCROW_ABI,
      functionName: 'refund',
      args: [investment.projectId.toHexString()],
    });

    await publicClient.waitForTransactionReceipt({ hash });
  }

  private async simulateMintInvestmentNft(
    walletAddress: string,
    projectId: string,
    amount: number,
  ): Promise<string | null> {
    const { blockchain, publicClient, walletClient } =
      this.getBlockchainClients();

    if (!blockchain.contracts?.nft) {
      return null;
    }

    const hash: Hash = await walletClient.writeContract({
      address: blockchain.contracts.nft as Address,
      abi: INVESTMENT_NFT_ABI,
      functionName: 'mintNFT',
      args: [
        walletAddress as Address,
        projectId,
        BigInt(Math.floor(amount * 1e18)),
      ],
    });

    await publicClient.waitForTransactionReceipt({ hash });

    return hash;
  }

  private async safeLoadAuthUser(
    userId: string,
  ): Promise<AuthUserView | null> {
    try {
      const profile = (await this.authService.getProfile(userId)) as unknown as AuthUserView;
      return profile;
    } catch {
      return null;
    }
  }

  private toView(
    investment: InvestmentDocument,
    options?: {
      investorWallet?: string;
      investorKyc?: KYCStatus;
      projectTitle?: string;
      projectCategory?: string;
      projectCreatorId?: string;
      nftMetadata?: Record<string, unknown> | null;
    },
  ): InvestmentView {
    const createdAt =
      (investment as InvestmentDocument & { createdAt?: Date }).createdAt ??
      new Date();
    const updatedAt =
      (investment as InvestmentDocument & { updatedAt?: Date }).updatedAt ??
      createdAt;

    return {
      id: investment._id.toHexString(),
      projectId: investment.projectId.toHexString(),
      investorId: investment.investorId.toHexString(),
      amount: investment.amount,
      txHash: investment.txHash ?? null,
      nftId: investment.nftId ?? null,
      status: investment.status,
      createdAt,
      updatedAt,
      project: {
        id: investment.projectId.toHexString(),
        title: options?.projectTitle,
        category: options?.projectCategory,
        creatorId: options?.projectCreatorId,
      },
      investor: {
        id: investment.investorId.toHexString(),
        walletAddress: options?.investorWallet,
        kycStatus: options?.investorKyc,
      },
      nft: {
        id: investment.nftId ?? null,
        metadata: options?.nftMetadata ?? null,
      },
    };
  }
}
