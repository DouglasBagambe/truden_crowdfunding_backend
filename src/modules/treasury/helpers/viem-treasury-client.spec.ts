import { ViemTreasuryClient } from './viem-treasury-client';

describe('ViemTreasuryClient', () => {
  it('does not bind a legacy treasury ABI when KEIBO mode is enabled by a KEIBO contract address', async () => {
    const config = {
      get: <T>(key: string): T | undefined =>
        ({
          BLOCKCHAIN_FEATURES_ENABLED: 'true',
          KEIBO_ESCROW_CONTRACT_ADDRESS:
            '0x0000000000000000000000000000000000000001',
        })[key] as T | undefined,
    };
    const client = new ViemTreasuryClient(config as never, {} as never);

    await expect(
      client.adminWithdraw({
        to: '0x0000000000000000000000000000000000000001',
        amount: 1n,
      }),
    ).rejects.toThrow('operations are disabled');
  });
});
