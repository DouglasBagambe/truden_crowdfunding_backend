import type { KYCStatus } from '../../../common/enums/role.enum';

export enum InvestmentStatus {
  Pending = 'pending',
  Active = 'active',
  Completed = 'completed',
  Refunded = 'refunded',
}

export interface InvestmentViewInvestor {
  id: string;
  kycStatus?: KYCStatus;
  // walletAddress and NFT data: see blockchain/nfts-future branch
}

export interface InvestmentViewProject {
  id: string;
  title?: string;
  category?: string;
  type?: string;
  creatorId?: string;
}

// InvestmentViewNft is preserved in blockchain/nfts-future branch

export interface InvestmentView {
  id: string;
  projectId: string;
  investorId: string;
  amount: number;
  /** ISO-4217 currency code, e.g. 'UGX' */
  currency?: string;
  /** Payment gateway transaction reference */
  txHash?: string | null;
  /** NFT placeholder — will be populated once blockchain/nfts-future is merged */
  nftId?: string | null;
  status: InvestmentStatus;
  createdAt: Date;
  updatedAt: Date;
  project?: InvestmentViewProject;
  investor?: InvestmentViewInvestor;
}
