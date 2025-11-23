import { Types } from 'mongoose';

export type ObjectId = Types.ObjectId;

export enum EscrowStatus {
  ACTIVE = 'ACTIVE',
  PAUSED = 'PAUSED',
  CLOSED = 'CLOSED',
}

export enum DepositStatus {
  PENDING = 'PENDING',
  PENDING_TX = 'PENDING_TX',
  CONFIRMED = 'CONFIRMED',
  RELEASED = 'RELEASED',
  REFUNDED = 'REFUNDED',
  DISPUTED = 'DISPUTED',
}

export enum EscrowCurrency {
  ETH = 'ETH',
  USDC = 'USDC',
  UGX = 'UGX',
  FIAT = 'FIAT',
}

export enum FundingSource {
  ONCHAIN = 'ONCHAIN',
  FIAT = 'FIAT',
  OFFCHAIN = 'OFFCHAIN',
}

export enum MilestoneLockStatus {
  LOCKED = 'LOCKED',
  RELEASED = 'RELEASED',
  CANCELLED = 'CANCELLED',
}

export interface ActorInfo {
  id: string;
  role: string;
}
