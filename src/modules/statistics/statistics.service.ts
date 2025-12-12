import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model, Types } from 'mongoose';
import { Project, ProjectDocument } from '../projects/schemas/project.schema';
import {
  Investment,
  InvestmentDocument,
} from '../investments/schemas/investment.schema';
import { User, UserDocument } from '../users/schemas/user.schema';
import { Deposit, DepositDocument } from '../escrow/schemas/escrow.schema';
import { InvestmentStatus } from '../investments/interfaces/investment.interface';
import { ProjectStatus } from '../../common/enums/project-status.enum';
import { UserRole, KYCStatus } from '../../common/enums/role.enum';
import { TrendsQueryDto } from './dto/trends-query.dto';

interface StatusGroup {
  status: string;
  amount: number;
  count: number;
}

type PortfolioProject = {
  projectId: Types.ObjectId;
  amount: number;
  count: number;
  name?: string;
  status?: string;
  projectType?: string;
  raised?: number;
  target?: number;
};

type TrendPoint = { date: Date; amount: number; count: number };

@Injectable()
export class StatisticsService {
  private readonly contributionStatuses = [
    InvestmentStatus.Active,
    InvestmentStatus.Completed,
  ];

  private readonly allNonRefunded = [
    InvestmentStatus.Pending,
    InvestmentStatus.Active,
    InvestmentStatus.Completed,
  ];

  private readonly publicProjectStatuses = [
    ProjectStatus.APPROVED,
    ProjectStatus.FUNDING,
    ProjectStatus.FUNDED,
    ProjectStatus.FUNDING_FAILED,
  ];

  constructor(
    @InjectModel(Project.name)
    private readonly projectModel: Model<ProjectDocument>,
    @InjectModel(Investment.name)
    private readonly investmentModel: Model<InvestmentDocument>,
    @InjectModel(User.name)
    private readonly userModel: Model<UserDocument>,
    @InjectModel(Deposit.name)
    private readonly depositModel: Model<DepositDocument>,
  ) {}

  async getPublicOverview() {
    const since30d = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

    const investorCountPromise: Promise<number> = this.countUniqueInvestors({
      status: { $in: this.contributionStatuses },
    });

    const [
      totalProjects,
      fullyInvested,
      typeBreakdown,
      categoryBreakdown,
      investmentsByStatus,
      trendingProjects,
    ] = await Promise.all([
      this.projectModel.countDocuments(),
      this.countFullyInvestedProjects(),
      this.aggregateProjectTypeBreakdown(),
      this.aggregateProjectCategoryBreakdown(),
      this.aggregateInvestmentsByStatus({
        status: { $in: this.allNonRefunded },
      }),
      this.trendingProjects(since30d, 5),
    ]);

    const investorCount: number = await investorCountPromise;

    const totalFundsRaised = this.sumStatuses(investmentsByStatus, [
      InvestmentStatus.Active,
      InvestmentStatus.Completed,
      InvestmentStatus.Pending,
    ]);

    return {
      totals: {
        fundsRaised: totalFundsRaised,
        projects: totalProjects,
        fullyInvested,
        investors: investorCount,
      },
      projects: {
        byType: typeBreakdown,
        byCategory: categoryBreakdown,
      },
      investments: {
        byStatus: investmentsByStatus,
      },
      trendingProjects,
    };
  }

  async getUserOverview(userId: string) {
    const investorId = new Types.ObjectId(userId);
    const match = { investorId };

    const uniqueProjectsPromise: Promise<number> =
      this.countUniqueProjects(investorId);

    const [byStatus, uniqueProjects, topProjects, trend]: [
      Record<string, StatusGroup>,
      number,
      PortfolioProject[],
      TrendPoint[],
    ] = await Promise.all([
      this.aggregateInvestmentsByStatus(match),
      uniqueProjectsPromise,
      this.topProjectsForInvestor(investorId, 5),
      this.investmentTrend(match, { days: 30, interval: 'day' }),
    ]);

    const investmentsCount = Object.values(byStatus).reduce<number>(
      (acc, curr: StatusGroup) => acc + curr.count,
      0,
    );

    const totals = {
      pending: this.sumStatuses(byStatus, [InvestmentStatus.Pending]),
      ongoing: this.sumStatuses(byStatus, [InvestmentStatus.Active]),
      past: this.sumStatuses(byStatus, [
        InvestmentStatus.Completed,
        InvestmentStatus.Refunded,
      ]),
      total: this.sumStatuses(byStatus, [
        InvestmentStatus.Pending,
        InvestmentStatus.Active,
        InvestmentStatus.Completed,
      ]),
    };

    return {
      totals: {
        investedAmount: totals.total,
        pendingAmount: totals.pending,
        ongoingAmount: totals.ongoing,
        pastAmount: totals.past,
        investmentsCount,
        uniqueProjects,
      },
      byStatus,
      portfolio: {
        topProjects,
      },
      trend,
    };
  }

  async getAdminOverview() {
    const [
      investmentStatusBreakdown,
      depositBreakdown,
      projectFunnel,
      fullyInvested,
      totals,
      trendingProjects,
    ] = await Promise.all([
      this.aggregateInvestmentsByStatus(),
      this.aggregateDepositsByStatus(),
      this.aggregateProjectFunnel(),
      this.countFullyInvestedProjects(),
      this.aggregateMembers(),
      this.trendingProjects(new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), 5),
    ]);

    const fundsRaised = this.sumStatuses(investmentStatusBreakdown, [
      InvestmentStatus.Active,
      InvestmentStatus.Completed,
      InvestmentStatus.Pending,
    ]);

    return {
      totals: {
        ...totals,
        fundsRaised,
        fullyInvestedProjects: fullyInvested,
      },
      investments: {
        byStatus: investmentStatusBreakdown,
      },
      deposits: depositBreakdown,
      projects: {
        funnel: projectFunnel,
      },
      trendingProjects,
    };
  }

  async getAdminTrends(query: TrendsQueryDto) {
    const match: Record<string, any> = {
      status: { $in: this.allNonRefunded },
    };
    const dateMatch = this.buildDateRangeMatch(query);
    if (Object.keys(dateMatch).length) {
      match.createdAt = dateMatch;
    }

    const interval = query.interval ?? 'day';
    const points = await this.investmentTrend(match, {
      interval,
    });

    const totals = points.reduce(
      (acc, point) => {
        acc.amount += point.amount;
        acc.count += point.count;
        return acc;
      },
      { amount: 0, count: 0 },
    );

    return {
      interval,
      from: query.from ?? null,
      to: query.to ?? null,
      totals,
      points,
    };
  }

  private async aggregateInvestmentsByStatus(
    match: Record<string, any> = {},
  ): Promise<Record<string, StatusGroup>> {
    const rows: Array<StatusGroup> = await this.investmentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: '$status',
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      {
        $project: {
          _id: 0,
          status: '$_id',
          amount: 1,
          count: 1,
        },
      },
    ]);

    return rows.reduce<Record<string, StatusGroup>>((acc, row: StatusGroup) => {
      acc[row.status] = row;
      return acc;
    }, {});
  }

  private async aggregateDepositsByStatus(): Promise<
    Record<string, StatusGroup>
  > {
    const rows: Array<StatusGroup> = await this.depositModel.aggregate([
      {
        $group: {
          _id: '$status',
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $project: { _id: 0, status: '$_id', amount: 1, count: 1 } },
    ]);

    return rows.reduce<Record<string, StatusGroup>>((acc, row: StatusGroup) => {
      acc[row.status] = row;
      return acc;
    }, {});
  }

  private async aggregateProjectTypeBreakdown() {
    const rows: Array<{
      type: string;
      count: number;
      raised: number;
      target: number;
    }> = await this.projectModel.aggregate([
      // { $match: { status: { $in: this.publicProjectStatuses } } },
      {
        $group: {
          _id: '$projectType',
          count: { $sum: 1 },
          raised: { $sum: '$raisedAmount' },
          target: { $sum: '$targetAmount' },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id',
          count: 1,
          raised: 1,
          target: 1,
        },
      },
    ]);

    return rows.reduce<
      Record<
        string,
        { type: string; count: number; raised: number; target: number }
      >
    >((acc, row) => {
      acc[row.type] = row;
      return acc;
    }, {});
  }

  private async aggregateProjectCategoryBreakdown(): Promise<
    Array<{ type: string; category: string; count: number; raised: number }>
  > {
    const rows: Array<{
      type: string;
      category: string;
      count: number;
      raised: number;
    }> = await this.projectModel.aggregate([
      // { $match: { status: { $in: this.publicProjectStatuses } } },
      {
        $group: {
          _id: {
            type: '$projectType',
            category: { $ifNull: ['$category', '$industry'] },
          },
          count: { $sum: 1 },
          raised: { $sum: '$raisedAmount' },
        },
      },
      {
        $project: {
          _id: 0,
          type: '$_id.type',
          category: '$_id.category',
          count: 1,
          raised: 1,
        },
      },
      { $sort: { count: -1 } },
    ]);

    return rows;
  }

  private async aggregateProjectFunnel(): Promise<
    Record<string, { status: string; count: number; raised: number }>
  > {
    const rows: Array<{ status: string; count: number; raised: number }> =
      await this.projectModel.aggregate([
        {
          $group: {
            _id: '$status',
            count: { $sum: 1 },
            raised: { $sum: '$raisedAmount' },
          },
        },
        { $project: { _id: 0, status: '$_id', count: 1, raised: 1 } },
      ]);

    return rows.reduce<
      Record<string, { status: string; count: number; raised: number }>
    >((acc, row) => {
      acc[row.status] = row;
      return acc;
    }, {});
  }

  private async countFullyInvestedProjects() {
    return this.projectModel.countDocuments({
      $or: [
        { status: ProjectStatus.FUNDED },
        { $expr: { $gte: ['$raisedAmount', '$targetAmount'] } },
      ],
    });
  }

  private async countUniqueInvestors(
    match: Record<string, any> = {},
  ): Promise<number> {
    const rows: Array<{ total: number }> = await this.investmentModel.aggregate(
      [
        { $match: match },
        { $group: { _id: '$investorId' } },
        { $count: 'total' },
      ],
    );
    return rows[0]?.total ?? 0;
  }

  private async countUniqueProjects(
    investorId: Types.ObjectId,
  ): Promise<number> {
    const rows: Array<{ total: number }> = await this.investmentModel.aggregate(
      [
        { $match: { investorId } },
        { $group: { _id: '$projectId' } },
        { $count: 'total' },
      ],
    );
    return rows[0]?.total ?? 0;
  }

  private async topProjectsForInvestor(
    investorId: Types.ObjectId,
    limit: number,
  ): Promise<PortfolioProject[]> {
    return (await this.investmentModel
      .aggregate([
        { $match: { investorId } },
        {
          $group: {
            _id: '$projectId',
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'projects',
            localField: '_id',
            foreignField: '_id',
            as: 'project',
          },
        },
        { $unwind: '$project' },
        {
          $project: {
            projectId: '$_id',
            amount: 1,
            count: 1,
            name: '$project.name',
            status: '$project.status',
            projectType: '$project.projectType',
            raised: '$project.raisedAmount',
            target: '$project.targetAmount',
          },
        },
      ])
      .exec()) as PortfolioProject[];
  }

  private async trendingProjects(
    since: Date,
    limit: number,
  ): Promise<PortfolioProject[]> {
    return (await this.investmentModel
      .aggregate([
        {
          $match: {
            status: { $in: this.contributionStatuses },
            createdAt: { $gte: since },
          },
        },
        {
          $group: {
            _id: '$projectId',
            amount: { $sum: '$amount' },
            count: { $sum: 1 },
          },
        },
        { $sort: { amount: -1 } },
        { $limit: limit },
        {
          $lookup: {
            from: 'projects',
            localField: '_id',
            foreignField: '_id',
            as: 'project',
          },
        },
        { $unwind: '$project' },
        {
          $project: {
            projectId: '$_id',
            amount: 1,
            count: 1,
            name: '$project.name',
            status: '$project.status',
            projectType: '$project.projectType',
            raised: '$project.raisedAmount',
            target: '$project.targetAmount',
          },
        },
      ])
      .exec()) as PortfolioProject[];
  }

  private async investmentTrend(
    match: Record<string, any>,
    options: { interval?: 'day' | 'week'; days?: number },
  ): Promise<TrendPoint[]> {
    const interval = options.interval ?? 'day';
    const createdAt =
      typeof match.createdAt === 'object' && match.createdAt !== null
        ? ({ ...match.createdAt } as Record<string, any>)
        : ({} as Record<string, any>);
    if (options.days) {
      createdAt.$gte = new Date(
        Date.now() - options.days * 24 * 60 * 60 * 1000,
      );
    }
    if (Object.keys(createdAt).length) {
      match = { ...match, createdAt };
    }

    const rows: TrendPoint[] = await this.investmentModel.aggregate([
      { $match: match },
      {
        $group: {
          _id: {
            $dateTrunc: {
              date: '$createdAt',
              unit: interval,
            },
          },
          amount: { $sum: '$amount' },
          count: { $sum: 1 },
        },
      },
      { $sort: { _id: 1 } },
      {
        $project: {
          _id: 0,
          date: '$_id',
          amount: 1,
          count: 1,
        },
      },
    ]);

    return rows;
  }

  private async aggregateMembers() {
    const [totalUsers, investors, innovators, admins, verifiedKyc] =
      await Promise.all([
        this.userModel.countDocuments({}),
        this.userModel.countDocuments({ roles: UserRole.INVESTOR }),
        this.userModel.countDocuments({ roles: UserRole.INNOVATOR }),
        this.userModel.countDocuments({ roles: UserRole.ADMIN }),
        this.userModel.countDocuments({ kycStatus: KYCStatus.VERIFIED }),
      ]);

    return {
      totalUsers,
      investors,
      innovators,
      admins,
      verifiedKyc,
    };
  }

  private buildDateRangeMatch(query: TrendsQueryDto) {
    const match: Record<string, any> = {};
    if (query.from) {
      match.$gte = new Date(query.from);
    }
    if (query.to) {
      match.$lt = new Date(query.to);
    }
    return match;
  }

  private sumStatuses(
    byStatus: Record<string, StatusGroup>,
    statuses: InvestmentStatus[],
  ) {
    return statuses.reduce((sum, status) => {
      const key = status as string;
      return sum + (byStatus[key]?.amount ?? 0);
    }, 0);
  }
}
