export type FinancialState =
  | 'pending'
  | 'authorized'
  | 'captured'
  | 'settled'
  | 'released'
  | 'refunded'
  | 'failed'
  | 'reversed'
  | 'adjusted';

export interface LedgerLine {
  account: string;
  debitMinor: bigint;
  creditMinor: bigint;
  metadata?: Record<string, string>;
}

export interface PaymentIntentInput {
  projectId: string;
  contributorId: string;
  amountMinor: bigint;
  currency: string;
  idempotencyKey: string;
  correlationId: string;
}

export interface ProviderEvent {
  provider: string;
  providerEventId: string;
  eventType:
    | 'authorized'
    | 'captured'
    | 'settled'
    | 'failed'
    | 'refunded'
    | 'reversed';
  paymentIntentId: string;
  amountMinor: bigint;
  currency: string;
  providerFeeMinor?: bigint;
  receivedAt: Date;
}
