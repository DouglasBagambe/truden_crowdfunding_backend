import {
  assertBalancedPosting,
  calculateCampaignSuccessFee,
} from './financial-ledger.util';

describe('financial ledger primitives', () => {
  it('keeps the campaign-owner success fee distinct at five percent', () => {
    expect(calculateCampaignSuccessFee(100_000n)).toEqual({
      ownerProceedsMinor: 95_000n,
      keiboFeeMinor: 5_000n,
    });
  });

  it('recognizes balanced double-entry postings', () => {
    expect(
      assertBalancedPosting([
        { debitMinor: 100n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 100n },
      ]),
    ).toBe(true);
    expect(
      assertBalancedPosting([
        { debitMinor: 100n, creditMinor: 0n },
        { debitMinor: 0n, creditMinor: 99n },
      ]),
    ).toBe(false);
  });
});
