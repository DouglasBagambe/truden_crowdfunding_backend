import { ConflictException, ServiceUnavailableException } from '@nestjs/common';
import * as viem from 'viem';
import { KeiboDealRoomEvidenceService } from './keibo-deal-room-evidence.service';

jest.mock('viem', () => ({
  ...jest.requireActual('viem'),
  createPublicClient: jest.fn(),
  decodeEventLog: jest.fn(),
  http: jest.fn(() => ({})),
}));
const address = '0x0000000000000000000000000000000000000001' as const;
const hash = `0x${'a'.repeat(64)}` as const;
const bytes32 = `0x${'b'.repeat(64)}` as const;
const config = {
  getRequired: () => ({
    rpcUrl: 'https://rpc.example.test',
    chainId: 11155111,
    escrow: address,
    governance: address,
    receipt: address,
    evidence: address,
    eligibilitySigner: address,
  }),
};
const signer = { writeContract: jest.fn().mockResolvedValue(hash) };
const client = (overrides: Record<string, unknown> = {}) => ({
  getChainId: jest.fn().mockResolvedValue(11155111),
  getCode: jest.fn().mockResolvedValue('0x1234'),
  readContract: jest.fn().mockResolvedValue(false),
  waitForTransactionReceipt: jest
    .fn()
    .mockResolvedValue({
      status: 'success',
      logs: [{ address, data: '0x', topics: [] }],
    }),
  ...overrides,
});

describe('KeiboDealRoomEvidenceService', () => {
  beforeEach(() => jest.clearAllMocks());
  it('records only hash evidence and verifies the event', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(client());
    (viem.decodeEventLog as jest.Mock).mockReturnValue({
      eventName: 'DocumentRecorded',
      args: {},
    });
    const service = new KeiboDealRoomEvidenceService(
      config as never,
      signer as never,
    );
    await expect(
      service.recordDocument({
        campaignId: '1',
        documentHash: bytes32,
        accessPolicyHash: bytes32,
      }),
    ).resolves.toBe(hash);
  });
  it('rejects invalid and duplicate document evidence before write', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({ readContract: jest.fn().mockResolvedValue(true) }),
    );
    const service = new KeiboDealRoomEvidenceService(
      config as never,
      signer as never,
    );
    await expect(
      service.recordDocument({
        campaignId: '1',
        documentHash: '0x0' as never,
        accessPolicyHash: bytes32,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    await expect(
      service.recordDocument({
        campaignId: '1',
        documentHash: bytes32,
        accessPolicyHash: bytes32,
      }),
    ).rejects.toThrow('already recorded');
  });
  it.each([
    ['wrong chain', client({ getChainId: jest.fn().mockResolvedValue(1) })],
    [
      'missing bytecode',
      client({ getCode: jest.fn().mockResolvedValue('0x') }),
    ],
  ])('fails closed on %s', async (_n, c) => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(c);
    const service = new KeiboDealRoomEvidenceService(
      config as never,
      signer as never,
    );
    await expect(service.isKnownDocument(bytes32)).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
  it('rejects revert and missing evidence event', async () => {
    (viem.createPublicClient as jest.Mock).mockReturnValue(
      client({
        waitForTransactionReceipt: jest
          .fn()
          .mockResolvedValue({ status: 'reverted', logs: [] }),
      }),
    );
    const service = new KeiboDealRoomEvidenceService(
      config as never,
      signer as never,
    );
    await expect(
      service.recordDocument({
        campaignId: '1',
        documentHash: bytes32,
        accessPolicyHash: bytes32,
      }),
    ).rejects.toThrow('reverted');
  });
});
