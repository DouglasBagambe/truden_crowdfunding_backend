export const EscrowEvents = {
  DEPOSIT_CREATED: 'escrow.deposit.created',
  DEPOSIT_CONFIRMED: 'escrow.deposit.confirmed',
  RELEASE_REQUESTED: 'escrow.release.requested',
  RELEASE_CONFIRMED: 'escrow.release.confirmed',
  DISPUTE_RAISED: 'escrow.dispute.raised',
  REFUND_PROCESSED: 'escrow.refund.processed',
} as const;

export type EscrowEventName = (typeof EscrowEvents)[keyof typeof EscrowEvents];
