import { Types } from 'mongoose';

export enum TreasuryTransactionType {
  FEE = 'FEE',
  DONATION = 'DONATION',
  WITHDRAWAL = 'WITHDRAWAL',
  DISTRIBUTION = 'DISTRIBUTION',
  REFUND = 'REFUND',
  RESERVE = 'RESERVE',
}

export interface TreasuryTransactionView {
  id: string;
  type: TreasuryTransactionType;
  amount: number;
  txHash?: string;
  initiatedBy?: string | null;
  metadata?: Record<string, any> | null;
  createdAt: Date;
}

export interface TreasuryBalanceView {
  totalBalance: number;
  availableBalance: number;
  reservedBalance: number;
}

export interface TreasurySummaryMonthView {
  month: string;
  fees: number;
  donations: number;
  distributions: number;
}

export interface TreasurySummaryView {
  feesCollected: number;
  donations: number;
  totalDistributions: number;
  monthly: TreasurySummaryMonthView[];
}

export type TreasuryTransactionId = Types.ObjectId;
