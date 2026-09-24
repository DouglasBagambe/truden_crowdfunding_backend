import { MarketplaceService } from './marketplace.service';

describe('MarketplaceService', () => {
  it('keeps resale disabled when the non-transferable KEIBO receipt is configured', async () => {
    const service = new MarketplaceService(
      {} as never,
      {} as never,
      {} as never,
      {
        get: (key: string) =>
          key === 'KEIBO_RECEIPT_CONTRACT_ADDRESS'
            ? '0x0000000000000000000000000000000000000001'
            : 'true',
      } as never,
    );

    await expect(service.getActiveListings()).rejects.toThrow(
      'non-transferable',
    );
  });
});
