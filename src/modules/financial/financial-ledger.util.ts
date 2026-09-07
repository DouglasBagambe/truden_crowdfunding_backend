export const CAMPAIGN_SUCCESS_FEE_BPS = 500n;

export function calculateCampaignSuccessFee(releasedMinor: bigint): {
  ownerProceedsMinor: bigint;
  keiboFeeMinor: bigint;
} {
  if (releasedMinor <= 0n) throw new Error('Released amount must be positive');
  const keiboFeeMinor = (releasedMinor * CAMPAIGN_SUCCESS_FEE_BPS) / 10_000n;
  return { ownerProceedsMinor: releasedMinor - keiboFeeMinor, keiboFeeMinor };
}

export function assertBalancedPosting(
  lines: Array<{ debitMinor: bigint; creditMinor: bigint }>,
): boolean {
  return (
    lines.length >= 2 &&
    lines.reduce((sum, line) => sum + line.debitMinor, 0n) ===
      lines.reduce((sum, line) => sum + line.creditMinor, 0n)
  );
}
