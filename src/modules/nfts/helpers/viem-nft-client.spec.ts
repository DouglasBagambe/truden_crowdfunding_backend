import { ViemNftClient } from './viem-nft-client';

describe('ViemNftClient', () => {
  it('does not bind the legacy transferable NFT ABI when KEIBO receipt is configured', () => {
    const config = {
      get: <T>(key: string): T | undefined =>
        (key === 'KEIBO_RECEIPT_CONTRACT_ADDRESS'
          ? '0x0000000000000000000000000000000000000001'
          : undefined) as T | undefined,
    };
    const client = new ViemNftClient(config as never, {} as never);

    expect(client.nftAddress).toBeUndefined();
    expect(() => client.getPublicClient()).toThrow('operations are disabled');
  });

  it('does not bind a legacy NFT ABI when KEIBO mode is enabled by another KEIBO contract address', () => {
    const config = {
      get: <T>(key: string): T | undefined =>
        ({
          BLOCKCHAIN_FEATURES_ENABLED: 'true',
          KEIBO_ESCROW_CONTRACT_ADDRESS:
            '0x0000000000000000000000000000000000000001',
        })[key] as T | undefined,
    };
    const client = new ViemNftClient(config as never, {} as never);

    expect(client.nftAddress).toBeUndefined();
    expect(() => client.getPublicClient()).toThrow('operations are disabled');
  });
});
