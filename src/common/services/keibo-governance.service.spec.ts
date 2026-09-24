import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import * as viem from 'viem';
import { KeiboGovernanceService } from './keibo-governance.service';

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(),
  decodeEventLog: jest.fn(),
  http: jest.fn(() => ({})),
}));

const address = '0x0000000000000000000000000000000000000001' as const;
const account = '0x0000000000000000000000000000000000000002' as const;
const hash = `0x${'a'.repeat(64)}` as const;
const role = `0x${'b'.repeat(64)}` as const;
const config = {
  getRequired: () => ({
    rpcUrl: 'https://rpc.example.test',
    chainId: 11155111,
    escrow: address,
    governance: address,
    receipt: address,
    evidence: address,
    eligibilitySigner: account,
  }),
};
const signer = { writeContract: jest.fn().mockResolvedValue(hash) };

const client = (overrides: Record<string, unknown> = {}) => ({
  getChainId: jest.fn().mockResolvedValue(11155111),
  getCode: jest.fn().mockResolvedValue('0x1234'),
  readContract: jest.fn().mockResolvedValue([0, role, account, 0n, 0n, 0]),
  waitForTransactionReceipt: jest
    .fn()
    .mockResolvedValue({
      status: 'success',
      logs: [{ address, data: '0x', topics: [] }],
    }),
  ...overrides,
});

describe('KeiboGovernanceService', () => {
  beforeEach(() => jest.clearAllMocks());
  it('submits only a bounded valid proposal and verifies its event', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'ProposalCreated',
      args: {},
    });
    const service = new KeiboGovernanceService(
      config as never,
      signer as never,
    );
    await expect(service.propose({ action: 0, role, account })).resolves.toBe(
      hash,
    );
    expect(signer.writeContract).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'propose', address }),
    );
  });
  it('rejects unsupported actions and zero cancellation reasons before writes', async () => {
    const service = new KeiboGovernanceService(
      config as never,
      signer as never,
    );
    await expect(
      service.propose({ action: 4 as never, role, account }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.cancel('1', `0x${'0'.repeat(64)}`),
    ).rejects.toBeInstanceOf(ConflictException);
  });
  it('rejects non-executable proposals', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({
        readContract: jest
          .fn()
          .mockResolvedValue([
            0,
            role,
            account,
            BigInt(Math.floor(Date.now() / 1000) + 3600),
            0n,
            0,
          ]),
      }),
    );
    const service = new KeiboGovernanceService(
      config as never,
      signer as never,
    );
    await expect(service.execute('1')).rejects.toThrow('not executable');
  });
  it.each([
    [
      'wrong chain',
      client({ getChainId: jest.fn().mockResolvedValue(1) }),
      ServiceUnavailableException,
    ],
    [
      'missing bytecode',
      client({ getCode: jest.fn().mockResolvedValue('0x') }),
      ServiceUnavailableException,
    ],
  ])('fails closed on %s', async (_name, chainClient, error) => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(chainClient);
    const service = new KeiboGovernanceService(
      config as never,
      signer as never,
    );
    await expect(
      service.propose({ action: 0, role, account }),
    ).rejects.toBeInstanceOf(error);
  });
  it('propagates signer failures and rejects reverted or eventless transactions', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    signer.writeContract.mockRejectedValueOnce(
      new Error('unauthorized signer'),
    );
    const service = new KeiboGovernanceService(
      config as never,
      signer as never,
    );
    await expect(service.propose({ action: 0, role, account })).rejects.toThrow(
      'unauthorized signer',
    );
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({
        waitForTransactionReceipt: jest
          .fn()
          .mockResolvedValue({ status: 'reverted', logs: [] }),
      }),
    );
    signer.writeContract.mockResolvedValue(hash);
    await expect(service.propose({ action: 0, role, account })).rejects.toThrow(
      'reverted',
    );
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'ProposalExecuted',
      args: {},
    });
    await expect(service.propose({ action: 0, role, account })).rejects.toThrow(
      'Missing ProposalCreated',
    );
  });
});
