import type { KYCStatus } from '../../../common/enums/role.enum';

export enum InvestmentStatus {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
  Refunded = 'refunded',
}

export interface InvestmentViewInvestor {
  id: string;
  walletAddress?: string;
  kycStatus?: KYCStatus;
}

export interface InvestmentViewProject {
  id: string;
  title?: string;
  category?: string;
  creatorId?: string;
}

export interface InvestmentViewNft {
  id?: string | null;
  metadata?: Record<string, unknown> | null;
}

export interface InvestmentView {
  id: string;
  projectId: string;
  investorId: string;
  amount: number;
  txHash?: string | null;
  nftId?: string | null;
  status: InvestmentStatus;
  createdAt: Date;
  updatedAt: Date;
  project?: InvestmentViewProject;
  investor?: InvestmentViewInvestor;
  nft?: InvestmentViewNft;
}
