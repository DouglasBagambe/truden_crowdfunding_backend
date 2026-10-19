import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import * as viem from 'viem';
import { EscrowWeb3Service } from './escrow.web3';
import { EscrowCurrency } from './types';

jest.mock('viem', () => ({
  ...jest.requireActual<typeof import('viem')>('viem'),
  createPublicClient: jest.fn(),
  decodeEventLog: jest.fn(),
  encodeFunctionData: jest.fn(() => '0x1234'),
  http: jest.fn(() => ({})),
}));

const escrow = '0x0000000000000000000000000000000000000001' as const;
const investor = '0x0000000000000000000000000000000000000002' as const;
const hash = `0x${'a'.repeat(64)}` as const;
const metamaskDelegationManager =
  '0xdb9B1e94B5b69Df7e401DDbedE43491141047dB3' as const;

const client = (overrides: Record<string, unknown> = {}) => ({
  getChainId: jest.fn().mockResolvedValue(11155111),
  getCode: jest.fn().mockResolvedValue('0x1234'),
  readContract: jest.fn(),
  waitForTransactionReceipt: jest.fn().mockResolvedValue({
    status: 'success',
    logs: [{ address: escrow, data: '0x', topics: [] }],
  }),
  getTransaction: jest.fn().mockResolvedValue({ to: escrow, value: 0n }),
  call: jest.fn().mockResolvedValue({}),
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

  it('accepts a delegated contribution for campaign zero only with matching escrow evidence', async () => {
    const runtime = client({
      getTransaction: jest.fn().mockResolvedValue({
        to: metamaskDelegationManager,
        value: 0n,
      }),
    });
    (viem.createPublicClient as jest.Mock).mockReturnValue(runtime);
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'Contributed',
      args: { campaignId: 0n, contributor: investor, amount: 1000000n },
    });
    const service = new EscrowWeb3Service(config as never, signer as never);
    const request = { hash, projectOnchainId: '0', investor, amount: 1000000n };
    await expect(service.verifyDepositTx(request)).resolves.toBe(true);
    await expect(
      service.verifyDepositTx({ ...request, amount: 2n }),
    ).resolves.toBe(false);
    await expect(
      service.verifyDepositTx({ ...request, investor: escrow }),
    ).resolves.toBe(false);
    await expect(
      service.verifyDepositTx({ ...request, projectOnchainId: '1' }),
    ).resolves.toBe(false);
    runtime.waitForTransactionReceipt.mockResolvedValue({
      status: 'reverted',
      logs: [{ address: escrow, data: '0x', topics: [] }],
    });
    await expect(service.verifyDepositTx(request)).rejects.toThrow(
      'Transaction did not succeed against KEIBO escrow',
    );
    runtime.waitForTransactionReceipt.mockResolvedValue({
      status: 'success',
      logs: [{ address: investor, data: '0x', topics: [] }],
    });
    await expect(service.verifyDepositTx(request)).rejects.toThrow(
      'Missing Contributed',
    );
  });

  it.each([
    { to: investor, value: 0n },
    { to: metamaskDelegationManager, value: 1n },
    { to: escrow, value: 1n },
  ])('rejects contribution target/value mismatch: %s', async (transaction) => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({
        getTransaction: jest.fn().mockResolvedValue(transaction),
      }),
    );
    const service = new EscrowWeb3Service(config as never, signer as never);
    await expect(
      service.verifyDepositTx({
        hash,
        projectOnchainId: '0',
        investor,
        amount: 1000000n,
      }),
    ).rejects.toThrow('Transaction did not succeed against KEIBO escrow');
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

describe('Creator campaign provisioning evidence', () => {
  const params = {
    creator: investor,
    asset: escrow,
    cap: 100n,
    deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
    milestoneAmounts: [100n],
  };
  beforeEach(() => jest.clearAllMocks());
  function evidence(overrides: Record<string, unknown> = {}) {
    const runtime = client({
      getTransaction: jest.fn().mockResolvedValue({
        to: escrow,
        from: investor,
        input: '0x1234',
        value: 0n,
        nonce: 7,
      }),
      readContract: jest
        .fn()
        .mockResolvedValue([investor, escrow, 100n, 0n, params.deadline, 0]),
      ...overrides,
    });
    (viem.createPublicClient as jest.Mock).mockReturnValue(runtime);
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'CampaignCreated',
      args: {
        campaignId: 0n,
        creator: investor,
        asset: escrow,
        cap: 100n,
        deadline: params.deadline,
      },
    });
    return {
      runtime,
      service: new EscrowWeb3Service(config as never, signer as never),
    };
  }
  it('prepares createCampaign for the creator without any platform write', async () => {
    const { service } = evidence();
    expect(await service.prepareCampaign(params)).toMatchObject({
      account: investor,
      chainId: 11155111,
      to: escrow,
    });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });
  it('validates receipt, sender, exact calldata and current state; accepts campaign ID zero', async () => {
    const { service, runtime } = evidence();
    await expect(service.verifyCampaignCreation(hash, params, 7)).resolves.toBe(
      '0',
    );
    expect(runtime.waitForTransactionReceipt).toHaveBeenCalledWith({
      hash,
      confirmations: 2,
    });
    expect(signer.writeContract).not.toHaveBeenCalled();
  });
  it.each([
    { to: investor, from: investor, input: '0x1234', value: 0n },
    { to: escrow, from: escrow, input: '0x1234', value: 0n },
    { to: escrow, from: investor, input: '0xdead', value: 0n },
    { to: escrow, from: investor, input: '0x1234', value: 1n },
  ])(
    'rejects wrong target, creator, calldata or attached value',
    async (transaction) => {
      const { service } = evidence({
        getTransaction: jest.fn().mockResolvedValue(transaction),
      });
      await expect(
        service.verifyCampaignCreation(hash, params, 7),
      ).rejects.toThrow('does not prove');
    },
  );
  it('accepts MetaMask delegated execution only when creator, nonce, value, event and campaign state still match', async () => {
    const { service } = evidence({
      getTransaction: jest.fn().mockResolvedValue({
        to: metamaskDelegationManager,
        from: investor,
        input: '0xdeadbeef',
        value: 0n,
        nonce: 7,
      }),
    });
    await expect(service.verifyCampaignCreation(hash, params, 7)).resolves.toBe(
      '0',
    );
  });

  it('rejects reverted receipts and closed campaigns', async () => {
    const reverted = evidence({
      waitForTransactionReceipt: jest
        .fn()
        .mockResolvedValue({ status: 'reverted', logs: [] }),
    });
    await expect(
      reverted.service.verifyCampaignCreation(hash, params, 7),
    ).rejects.toThrow();
    const closed = evidence({
      readContract: jest
        .fn()
        .mockResolvedValue([investor, escrow, 100n, 0n, params.deadline, 1]),
    });
    await expect(
      closed.service.verifyCampaignCreation(hash, params, 7),
    ).rejects.toThrow('no longer funding');
  });
  it('rejects a mismatched milestone total and unsupported chain', async () => {
    const { service } = evidence();
    await expect(
      service.prepareCampaign({ ...params, milestoneAmounts: [99n] }),
    ).rejects.toThrow('sum exactly');
    evidence({ getChainId: jest.fn().mockResolvedValue(1) });
    await expect(service.prepareCampaign(params)).rejects.toThrow('chain ID');
  });
});

describe('Nonce-bound campaign retries', () => {
  it('refuses a mined creation transaction with a different nonce', async () => {
    const runtime = client({
      getTransaction: jest.fn().mockResolvedValue({
        from: investor,
        to: escrow,
        input: '0x1234',
        value: 0n,
        nonce: 8,
      }),
    });
    (viem.createPublicClient as jest.Mock).mockReturnValue(runtime);
    const service = new EscrowWeb3Service(config as never, signer as never);
    await expect(
      service.verifyCampaignCreation(
        hash,
        {
          creator: investor,
          asset: escrow,
          cap: 100n,
          deadline: BigInt(Math.floor(Date.now() / 1000) + 86400),
          milestoneAmounts: [100n],
        },
        7,
      ),
    ).rejects.toThrow('does not prove');
  });
  it('allows a new nonce only for a matching mined reverted transaction', async () => {
    const runtime = client({
      waitForTransactionReceipt: jest
        .fn()
        .mockResolvedValue({ status: 'reverted' }),
      getTransaction: jest.fn().mockResolvedValue({
        from: investor,
        to: escrow,
        input: '0x1234',
        nonce: 7,
      }),
    });
    (viem.createPublicClient as jest.Mock).mockReturnValue(runtime);
    const service = new EscrowWeb3Service(config as never, signer as never);
    const plan = { creator: investor, escrow, nonce: 7, data: '0x1234' };
    await expect(
      service.verifyRevertedCreation(hash, plan),
    ).resolves.toBeUndefined();
    runtime.waitForTransactionReceipt.mockResolvedValue({ status: 'success' });
    await expect(service.verifyRevertedCreation(hash, plan)).rejects.toThrow(
      'Only the mined, reverted',
    );
  });
});
