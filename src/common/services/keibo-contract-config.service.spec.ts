import { KeiboContractConfigService } from './keibo-contract-config.service';

const address = (suffix: string) =>
  `0x${suffix.padStart(40, '0')}`;

const values = (overrides: Record<string, unknown> = {}) => ({
  BLOCKCHAIN_FEATURES_ENABLED: 'true',
  RPC_URL: 'https://rpc.example.test',
  CHAIN_ID: '11155111',
  KEIBO_ESCROW_CONTRACT_ADDRESS: address('1'),
  KEIBO_GOVERNANCE_CONTRACT_ADDRESS: address('2'),
  KEIBO_RECEIPT_CONTRACT_ADDRESS: address('3'),
  KEIBO_EVIDENCE_CONTRACT_ADDRESS: address('4'),
  ...overrides,
});

const config = (entries: Record<string, unknown>) => ({
  get: <T>(key: string): T | undefined => entries[key] as T | undefined,
});

describe('KeiboContractConfigService', () => {
  it('accepts only an explicit complete KEIBO configuration', () => {
    const result = new KeiboContractConfigService(config(values()) as never).getRequired();

    expect(result.chainId).toBe(11155111);
    expect(result.escrow).toBe(address('1'));
    expect(result.receipt).toBe(address('3'));
  });

  it('fails closed when blockchain integration is disabled', () => {
    const service = new KeiboContractConfigService(
      config(values({ BLOCKCHAIN_FEATURES_ENABLED: 'false' })) as never,
    );

    expect(() => service.getRequired()).toThrow('integration is disabled');
  });

  it.each([
    ['missing address', { KEIBO_ESCROW_CONTRACT_ADDRESS: '' }, 'KEIBO_ESCROW_CONTRACT_ADDRESS is required'],
    ['legacy address cannot substitute', { KEIBO_ESCROW_CONTRACT_ADDRESS: undefined, ESCROW_CONTRACT_ADDRESS: address('9') }, 'KEIBO_ESCROW_CONTRACT_ADDRESS is required'],
    ['invalid address', { KEIBO_RECEIPT_CONTRACT_ADDRESS: 'not-an-address' }, 'KEIBO_RECEIPT_CONTRACT_ADDRESS must be a non-zero address'],
    ['zero address', { KEIBO_EVIDENCE_CONTRACT_ADDRESS: address('0') }, 'KEIBO_EVIDENCE_CONTRACT_ADDRESS must be a non-zero address'],
    ['invalid rpc', { RPC_URL: 'file:///tmp/rpc' }, 'RPC_URL must be a valid HTTP(S) URL'],
    ['invalid chain', { CHAIN_ID: '0' }, 'CHAIN_ID must be a positive integer'],
  ])('%s', (_name, override, message) => {
    const service = new KeiboContractConfigService(
      config(values(override)) as never,
    );

    expect(() => service.getRequired()).toThrow(message);
  });
});
