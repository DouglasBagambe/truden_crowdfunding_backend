import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import * as viem from 'viem';
import { EscrowWeb3Service } from './escrow.web3';
import { EscrowCurrency } from './types';

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(),
  decodeEventLog: jest.fn(),
  encodeFunctionData: jest.fn(() => '0x1234'),
  http: jest.fn(() => ({})),
}));

const escrow = '0x0000000000000000000000000000000000000001' as const;
const investor = '0x0000000000000000000000000000000000000002' as const;
const hash = `0x${'a'.repeat(64)}` as const;

const client = (overrides: Record<string, unknown> = {}) => ({
  getChainId: jest.fn().mockResolvedValue(11155111),
  getCode: jest.fn().mockResolvedValue('0x1234'),
  readContract: jest.fn(),
  waitForTransactionReceipt: jest
    .fn()
    .mockResolvedValue({
      status: 'success',
      logs: [{ address: escrow, data: '0x', topics: [] }],
    }),
  getTransaction: jest.fn().mockResolvedValue({ to: escrow }),
  ...overrides,
});

const config = {
  getRequired: () => ({
    rpcUrl: 'https://rpc.example.test',
    chainId: 11155111,
    escrow,
    governance: escrow,
    receipt: escrow,
    evidence: escrow,
  }),
};
const signer = { writeContract: jest.fn().mockResolvedValue(hash) };

describe('EscrowWeb3Service', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates contribution calldata without using a platform wallet', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    const service = new EscrowWeb3Service(config as never, signer as never);

    await expect(
      service.prepareContribution({
        projectOnchainId: '3',
        amount: 1n,
        currency: EscrowCurrency.USDC,
      }),
    ).resolves.toEqual({ to: escrow, data: '0x1234' });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });

  it('accepts only matching mined contribution evidence', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'Contributed',
      args: { campaignId: 3n, contributor: investor, amount: 7n },
    });
    const service = new EscrowWeb3Service(config as never, signer as never);

    await expect(
      service.verifyDepositTx({
        hash,
        projectOnchainId: '3',
        investor,
        amount: 7n,
      }),
    ).resolves.toBe(true);
    await expect(
      service.verifyDepositTx({
        hash,
        projectOnchainId: '3',
        investor,
        amount: 8n,
      }),
    ).resolves.toBe(false);
  });

  it('fails closed for wrong chain and missing deployed code', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({ getChainId: jest.fn().mockResolvedValue(1) }),
    );
    const service = new EscrowWeb3Service(config as never, signer as never);
    await expect(service.prepareRefund('1')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );

    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({ getCode: jest.fn().mockResolvedValue('0x') }),
    );
    await expect(service.prepareRefund('1')).rejects.toThrow(
      'no deployed bytecode',
    );
  });

  it('does not treat a reverted release as success', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({
        waitForTransactionReceipt: jest
          .fn()
          .mockResolvedValue({ status: 'reverted', logs: [] }),
      }),
    );
    const service = new EscrowWeb3Service(config as never, signer as never);

    await expect(
      service.approveMilestoneOnchain({
        projectOnchainId: '1',
        milestoneId: '0',
        evidenceHash: `0x${'b'.repeat(64)}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
  });

  it('surfaces RPC failure instead of accepting unverified evidence', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({ getChainId: jest.fn().mockRejectedValue(new Error('offline')) }),
    );
    const service = new EscrowWeb3Service(config as never, signer as never);

    await expect(
      service.prepareRelease({ projectOnchainId: '1', milestoneId: '0' }),
    ).rejects.toThrow('offline');
  });
});
