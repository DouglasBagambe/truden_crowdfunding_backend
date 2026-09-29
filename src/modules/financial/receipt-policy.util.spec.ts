import {
  canonicalReceiptPolicy,
  RECEIPT_POLICY_VERSION,
  receiptReasonHash,
} from './receipt-policy.util';

describe('receipt policy', () => {
  const input = {
    chainId: 11155111,
    investor: '0x1111111111111111111111111111111111111111' as const,
    campaignId: 7n,
    amount: 9500n,
    settlementId: 'settlement-1',
    expiresAt: 1234567890n,
  };
  it('is deterministic and fixed-versioned', () => {
    expect(canonicalReceiptPolicy(input)).toEqual(
      canonicalReceiptPolicy({ ...input }),
    );
    expect(RECEIPT_POLICY_VERSION).toBe('KEIBO_RECEIPT_ELIGIBILITY_V1');
  });
  it.each([
    { amount: 1n },
    { campaignId: 8n },
    { settlementId: 'other' },
    { expiresAt: 1234567891n },
    { chainId: 1 },
    { investor: '0x2222222222222222222222222222222222222222' as const },
  ])('changes hash when authoritative input changes', (change) =>
    expect(canonicalReceiptPolicy(input).policyHash).not.toBe(
      canonicalReceiptPolicy({ ...input, ...change }).policyHash,
    ),
  );
  it('hashes equivalent trimmed revocation reasons deterministically', () =>
    expect(receiptReasonHash(' reason ')).toBe(receiptReasonHash('reason')));
});
