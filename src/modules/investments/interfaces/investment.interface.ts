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
  walletAddress?: string | null;
}

export interface InvestmentViewProject {
  id: string;
  title?: string;
  name?: string;
  category?: string;
  projectType?: string;
  type?: string;
  creatorId?: string;
  imageUrl?: string | null;
}

export interface InvestmentViewNft {
  projectId?: number | null;
  tokenAmount?: number | null;
  txHash?: string | null;
  metadataUri?: string | null;
  minted: boolean;
  listed: boolean;
}

export interface InvestmentView {
  id: string;
  projectId: string;
  investorId: string;
  amount: number;
  /** ISO-4217 currency code, e.g. 'UGX' */
  currency?: string;
  /** Payment gateway transaction reference */
  txHash?: string | null;
  /** Self-custodial wallet address for NFT delivery */
  walletAddress?: string | null;
  nftProjectId?: number | null;
  nftTokenAmount?: number | null;
  nftTxHash?: string | null;
  nftMetadataUri?: string | null;
  nftMinted?: boolean;
  listed?: boolean;
  nft?: InvestmentViewNft;
  status: InvestmentStatus;
  createdAt: Date;
  updatedAt: Date;
  project?: InvestmentViewProject;
  investor?: InvestmentViewInvestor;
}
