// Placeholder for BullMQ workers related to escrow transactions.
// This can be extended to submit on-chain transactions, confirm receipts,
// and reconcile on-chain events with the database.

export const ESCROW_TX_QUEUE = 'escrow-tx-queue';
export const ESCROW_CONFIRMATION_QUEUE = 'escrow-confirmation-queue';
export const ESCROW_RECONCILE_QUEUE = 'escrow-reconcile-queue';
