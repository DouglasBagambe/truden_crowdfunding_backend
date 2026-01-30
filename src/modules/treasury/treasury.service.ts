import {
  BadRequestException,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types, type FilterQuery } from 'mongoose';
import type { JwtPayload } from '../../common/interfaces/user.interface';
import { UserRole } from '../../common/enums/role.enum';
import {
  TreasuryTransaction,
  TreasuryTransactionDocument,
} from './schemas/treasury-transaction.schema';
import {
  TreasuryWallet,
  TreasuryWalletDocument,
} from './schemas/treasury-wallet.schema';
import { CreateTreasuryTransactionDto } from './dto/create-treasury-transaction.dto';
import { FilterTreasuryDto } from './dto/filter-treasury.dto';
import {
  DistributeFundsDto,
  DistributionTargetDto,
} from './dto/distribute-funds.dto';
import {
  TreasuryBalanceView,
  TreasurySummaryView,
  TreasuryTransactionType,
  TreasuryTransactionView,
} from './interfaces/treasury-transaction.interface';
import { ViemTreasuryClient } from './helpers/viem-treasury-client';

@Injectable()
export class TreasuryService {
  constructor
  (
    @InjectModel(TreasuryTransaction.name)
    private readonly transactionModel: Model<TreasuryTransactionDocument>,
    @InjectModel(TreasuryWallet.name)
    private readonly walletModel: Model<TreasuryWalletDocument>,
    private readonly viemTreasuryClient: ViemTreasuryClient,
  ) {}

  async recordFee(
    dto: CreateTreasuryTransactionDto,
    currentUser?: JwtPayload,
  ): Promise<TreasuryTransactionView> {
    const amountNumber = this.parseAmount(dto.amount, 'amount');

    const metadata: Record<string, any> = {
      ...(dto.metadata ?? {}),
    };

    if (dto.projectId) metadata.projectId = dto.projectId;
    if (dto.investorId) metadata.investorId = dto.investorId;
    if (dto.nftId) metadata.nftId = dto.nftId;
    if (dto.txHash) metadata.sourceTx = dto.txHash;

    const initiatedById = currentUser?.sub
      ? new Types.ObjectId(currentUser.sub)
      : undefined;

    const transaction = await this.transactionModel.create({
      type: TreasuryTransactionType.FEE,
      amount: amountNumber,
      txHash: dto.txHash,
      initiatedBy: initiatedById,
      metadata,
    });

    await this.updateWalletBalance({
      totalDelta: amountNumber,
      availableDelta: amountNumber,
    });

    return this.toView(transaction);
  }

  async recordDonation(
    dto: CreateTreasuryTransactionDto,
    currentUser?: JwtPayload,
  ): Promise<TreasuryTransactionView> {
    const amountNumber = this.parseAmount(dto.amount, 'amount');

    const initiatedById = currentUser?.sub
      ? new Types.ObjectId(currentUser.sub)
      : undefined;

    const transaction = await this.transactionModel.create({
      type: TreasuryTransactionType.DONATION,
      amount: amountNumber,
      txHash: dto.txHash,
      initiatedBy: initiatedById,
      metadata: dto.metadata ?? {},
    });

    await this.updateWalletBalance({
      totalDelta: amountNumber,
      availableDelta: amountNumber,
    });

    return this.toView(transaction);
  }

  async withdraw(
    dto: CreateTreasuryTransactionDto,
    currentUser: JwtPayload,
  ): Promise<TreasuryTransactionView> {
    this.ensureAdmin(currentUser);

    const amountNumber = this.parseAmount(dto.amount, 'amount');

    const walletMetadata = dto.metadata ?? {};
    const toWallet =
      typeof walletMetadata.toWallet === 'string'
        ? (walletMetadata.toWallet as string)
        : undefined;

    let txHash = dto.txHash;

    if (!txHash && toWallet) {
      const amountWei = BigInt(Math.floor(amountNumber * 1e18));
      const { hash } = await this.viemTreasuryClient.adminWithdraw({
        to: toWallet,
        amount: amountWei,
      });
      txHash = hash;
    }

    await this.updateWalletBalance({
      totalDelta: -amountNumber,
      availableDelta: -amountNumber,
    });

    const transaction = await this.transactionModel.create({
      type: TreasuryTransactionType.WITHDRAWAL,
      amount: amountNumber,
      txHash,
      initiatedBy: new Types.ObjectId(currentUser.sub),
      metadata: dto.metadata ?? {},
    });

    return this.toView(transaction);
  }

  async distributeFunds(
    dto: DistributeFundsDto,
    currentUser: JwtPayload,
  ): Promise<TreasuryTransactionView> {
    this.ensureAdmin(currentUser);

    if (!dto.recipients || dto.recipients.length === 0) {
      throw new BadRequestException('At least one recipient is required');
    }

    const parsedRecipients = dto.recipients.map((r) =>
      this.parseDistributionTarget(r),
    );

    const totalAmount = parsedRecipients.reduce(
      (sum, r) => sum + r.amountNumber,
      0,
    );

    if (totalAmount <= 0) {
      throw new BadRequestException('Total distribution amount must be positive');
    }

    const onchainRecipients = parsedRecipients.filter(
      (r) => !!r.walletAddress,
    );

    let txHash = dto.txHash;

    if (!txHash && onchainRecipients.length > 0) {
      const addresses = onchainRecipients.map((r) => r.walletAddress as string);
      const amountsWei = onchainRecipients.map((r) =>
        BigInt(Math.floor(r.amountNumber * 1e18)),
      );
      const { hash } = await this.viemTreasuryClient.distributeFunds({
        recipients: addresses,
        amounts: amountsWei,
      });
      txHash = hash;
    }

    await this.updateWalletBalance({
      availableDelta: -totalAmount,
    });

    const metadata: Record<string, any> = {
      ...(dto.metadata ?? {}),
      description: dto.description,
      recipients: parsedRecipients.map((r) => ({
        recipientId: r.recipientId,
        amount: r.amountNumber,
        walletAddress: r.walletAddress,
        metadata: r.metadata,
      })),
    };

    const transaction = await this.transactionModel.create({
      type: TreasuryTransactionType.DISTRIBUTION,
      amount: totalAmount,
      txHash,
      initiatedBy: new Types.ObjectId(currentUser.sub),
      metadata,
    });

    return this.toView(transaction);
  }

  async getTransactions(query: FilterTreasuryDto) {
    const filter: FilterQuery<TreasuryTransactionDocument> = {};

    if (query.type) {
      filter.type = query.type;
    }

    if (query.fromDate || query.toDate) {
      const createdAt: Record<string, Date> = {};
      if (query.fromDate) createdAt.$gte = new Date(query.fromDate);
      if (query.toDate) createdAt.$lte = new Date(query.toDate);
      filter.createdAt = createdAt as any;
    }

    if (query.minAmount || query.maxAmount) {
      const amountFilter: Record<string, number> = {};
      if (typeof query.minAmount === 'number') {
        amountFilter.$gte = query.minAmount;
      }
      if (typeof query.maxAmount === 'number') {
        amountFilter.$lte = query.maxAmount;
      }
      filter.amount = amountFilter as any;
    }

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 25;
    const skip = (page - 1) * pageSize;

    const [items, total] = await Promise.all([
      this.transactionModel
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(pageSize)
        .exec(),
      this.transactionModel.countDocuments(filter).exec(),
    ]);

    return {
      items: items.map((tx) => this.toView(tx)),
      total,
      page,
      pageSize,
    };
  }

  async getBalance(): Promise<TreasuryBalanceView> {
    const wallet = await this.getOrCreateWallet();
    return {
      totalBalance: wallet.totalBalance,
      availableBalance: wallet.availableBalance,
      reservedBalance: wallet.reservedBalance,
    };
  }

  async getSummary(): Promise<TreasurySummaryView> {
    const perType = await this.transactionModel.aggregate<{
      _id: TreasuryTransactionType;
      total: number;
    }>([
      {
        $group: {
          _id: '$type',
          total: { $sum: '$amount' },
        },
      },
    ]);

    const feesCollected =
      perType.find((x) => x._id === TreasuryTransactionType.FEE)?.total ?? 0;
    const donations =
      perType.find((x) => x._id === TreasuryTransactionType.DONATION)?.total ?? 0;
    const totalDistributions =
      perType.find((x) => x._id === TreasuryTransactionType.DISTRIBUTION)?.total ??
      0;

    const monthlyRaw = await this.transactionModel.aggregate<{
      _id: { year: number; month: number };
      fees: number;
      donations: number;
      distributions: number;
    }>([
      {
        $group: {
          _id: {
            year: { $year: '$createdAt' },
            month: { $month: '$createdAt' },
          },
          fees: {
            $sum: {
              $cond: [{ $eq: ['$type', TreasuryTransactionType.FEE] }, '$amount', 0],
            },
          },
          donations: {
            $sum: {
              $cond: [
                { $eq: ['$type', TreasuryTransactionType.DONATION] },
                '$amount',
                0,
              ],
            },
          },
          distributions: {
            $sum: {
              $cond: [
                { $eq: ['$type', TreasuryTransactionType.DISTRIBUTION] },
                '$amount',
                0,
              ],
            },
          },
        },
      },
      { $sort: { '_id.year': 1, '_id.month': 1 } },
    ]);

    const monthly = monthlyRaw.map((m) => ({
      month: `${m._id.year}-${String(m._id.month).padStart(2, '0')}`,
      fees: m.fees,
      donations: m.donations,
      distributions: m.distributions,
    }));

    return {
      feesCollected,
      donations,
      totalDistributions,
      monthly,
    };
  }

  async syncTreasuryEvents(): Promise<{ processed: number }> {
    const logs = await this.viemTreasuryClient.getFeeCapturedLogs();
    void logs;
    const count = Array.isArray(logs) ? logs.length : 0;
    return { processed: count };
  }

  async handleEscrowFeeEvent(params: {
    amount: bigint;
    projectId: string;
    investorId?: string;
    txHash: string;
  }): Promise<TreasuryTransactionView> {
    const amount = Number(params.amount) / 1e18;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid fee amount from event');
    }

    const dto: CreateTreasuryTransactionDto = {
      amount: amount.toString(),
      txHash: params.txHash,
      projectId: params.projectId,
      investorId: params.investorId,
    };

    return this.recordFee(dto);
  }

  async handleNFTFeeEvent(params: {
    amount: bigint;
    projectId?: string;
    nftId?: string;
    txHash: string;
  }): Promise<TreasuryTransactionView> {
    const amount = Number(params.amount) / 1e18;
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new BadRequestException('Invalid fee amount from event');
    }

    const dto: CreateTreasuryTransactionDto = {
      amount: amount.toString(),
      txHash: params.txHash,
      projectId: params.projectId,
      nftId: params.nftId,
    };

    return this.recordFee(dto);
  }

  private ensureAdmin(currentUser: JwtPayload) {
    const roles = currentUser.roles ?? [];
    if (
      !roles.includes(UserRole.ADMIN) &&
      !roles.includes(UserRole.SUPERADMIN) &&
      !roles.includes(UserRole.TREASURY)
    ) {
      throw new ForbiddenException('Only admins can perform this action');
    }
  }

  private parseAmount(value: string, fieldName: string): number {
    const num = Number(value);
    if (!Number.isFinite(num) || num <= 0) {
      throw new BadRequestException(`Invalid ${fieldName}`);
    }
    return num;
  }

  private parseDistributionTarget(target: DistributionTargetDto) {
    const amountNumber = this.parseAmount(target.amount, 'amount');
    return {
      recipientId: target.recipientId,
      amountNumber,
      walletAddress: target.walletAddress,
      metadata: target.metadata ?? {},
    };
  }

  private async getOrCreateWallet(): Promise<TreasuryWalletDocument> {
    const wallet = await this.walletModel
      .findOneAndUpdate(
        {},
        {
          $setOnInsert: {
            totalBalance: 0,
            availableBalance: 0,
            reservedBalance: 0,
            updatedAt: new Date(),
          },
        },
        { new: true, upsert: true },
      )
      .exec();

    return wallet;
  }

  private async updateWalletBalance(params: {
    totalDelta?: number;
    availableDelta?: number;
    reservedDelta?: number;
  }): Promise<TreasuryWalletDocument> {
    const wallet = await this.getOrCreateWallet();

    const totalDelta = params.totalDelta ?? 0;
    const availableDelta = params.availableDelta ?? 0;
    const reservedDelta = params.reservedDelta ?? 0;

    const newTotal = wallet.totalBalance + totalDelta;
    const newAvailable = wallet.availableBalance + availableDelta;
    const newReserved = wallet.reservedBalance + reservedDelta;

    if (newTotal < 0 || newAvailable < 0 || newReserved < 0) {
      throw new BadRequestException('Insufficient treasury balance');
    }

    wallet.totalBalance = newTotal;
    wallet.availableBalance = newAvailable;
    wallet.reservedBalance = newReserved;
    wallet.updatedAt = new Date();

    await wallet.save();

    return wallet;
  }

  private toView(
    doc: TreasuryTransactionDocument,
  ): TreasuryTransactionView {
    const createdAt =
      (doc as TreasuryTransactionDocument & { createdAt?: Date }).createdAt ??
      new Date();

    return {
      id: doc._id.toHexString(),
      type: doc.type,
      amount: doc.amount,
      txHash: doc.txHash,
      initiatedBy: doc.initiatedBy ? String(doc.initiatedBy) : null,
      metadata: doc.metadata ?? null,
      createdAt,
    };
  }
}
