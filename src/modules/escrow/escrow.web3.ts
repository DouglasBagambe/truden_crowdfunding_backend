import {
  ConflictException,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  createPublicClient,
  decodeEventLog,
  encodeFunctionData,
  http,
  isHash,
  isAddress,
  type Address,
  type Hash,
  type Hex,
} from 'viem';
import { KeiboContractConfigService } from '../../common/services/keibo-contract-config.service';
import { PlatformSignerService } from '../../common/services/platform-signer.service';
import { EscrowCurrency } from './types';

// Curated KEIBO escrow ABI. Legacy Escrow.json is deliberately not imported.
export const KEIBO_CAMPAIGN_ESCROW_ABI = [
  {
    type: 'function',
    name: 'createCampaign',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'asset', type: 'address' },
      { name: 'cap', type: 'uint128' },
      { name: 'deadline', type: 'uint64' },
      { name: 'milestoneAmounts', type: 'uint128[]' },
    ],
    outputs: [{ name: 'id', type: 'uint256' }],
  },
  {
    type: 'event',
    name: 'CampaignCreated',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'creator', type: 'address' },
      { indexed: true, name: 'asset', type: 'address' },
      { indexed: false, name: 'cap', type: 'uint256' },
      { indexed: false, name: 'deadline', type: 'uint64' },
    ],
  },

  {
    type: 'function',
    name: 'campaigns',
    stateMutability: 'view',
    inputs: [{ type: 'uint256', name: '' }],
    outputs: [
      { type: 'address', name: 'creator' },
      { type: 'address', name: 'asset' },
      { type: 'uint128', name: 'cap' },
      { type: 'uint128', name: 'raised' },
      { type: 'uint64', name: 'deadline' },
      { type: 'uint8', name: 'state' },
    ],
  },
  {
    type: 'function',
    name: 'contribute',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint128', name: 'amount' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'approveMilestone',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint256', name: 'milestoneId' },
      { type: 'bytes32', name: 'evidenceHash' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'releaseMilestone',
    stateMutability: 'nonpayable',
    inputs: [
      { type: 'uint256', name: 'campaignId' },
      { type: 'uint256', name: 'milestoneId' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    name: 'refund',
    stateMutability: 'nonpayable',
    inputs: [{ type: 'uint256', name: 'campaignId' }],
    outputs: [],
  },
  {
    type: 'event',
    name: 'Contributed',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'MilestoneReleased',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'milestoneId', type: 'uint256' },
      { indexed: false, name: 'creatorAmount', type: 'uint256' },
      { indexed: false, name: 'feeAmount', type: 'uint256' },
    ],
  },
  {
    type: 'event',
    name: 'Refunded',
    inputs: [
      { indexed: true, name: 'campaignId', type: 'uint256' },
      { indexed: true, name: 'contributor', type: 'address' },
      { indexed: false, name: 'amount', type: 'uint256' },
    ],
  },
] as const;

/**
 * Testnet-only adapter for KeiboCampaignEscrow. It never sends a contribution,
 * creator release, or refund using a platform key: those functions use msg.sender
 * and must be signed by the actual contributor/creator wallet.
 */
@Injectable()
export class EscrowWeb3Service {
  constructor(
    private readonly keiboConfig: KeiboContractConfigService,
    private readonly platformSigner: PlatformSignerService,
  ) {}

  async creatorNonce(
    creator: Address,
    blockTag: 'pending' | 'latest' = 'pending',
  ) {
    const { client } = await this.readyClient();
    return client.getTransactionCount({ address: creator, blockTag });
  }

  async prepareCampaign(params: {
    creator: Address;
    asset: Address;
    cap: bigint;
    deadline: bigint;
    milestoneAmounts: bigint[];
  }) {
    if (
      !isAddress(params.creator) ||
      !isAddress(params.asset) ||
      /^0x0{40}$/i.test(params.asset)
    )
      throw new ConflictException('Invalid campaign wallet or asset');
    if (
      params.cap <= 0n ||
      params.cap >= 2n ** 128n ||
      params.deadline <= BigInt(Math.floor(Date.now() / 1000)) ||
      params.deadline >= 2n ** 64n
    )
      throw new ConflictException('Invalid campaign cap or deadline');
    if (
      !params.milestoneAmounts.length ||
      params.milestoneAmounts.length > 32 ||
      params.milestoneAmounts.some((value) => value <= 0n) ||
      params.milestoneAmounts.reduce((a, b) => a + b, 0n) !== params.cap
    )
      throw new ConflictException(
        'Milestone amounts must sum exactly to the cap',
      );
    const { client, config } = await this.readyClient();
    if (config.chainId !== 11155111)
      throw new ConflictException(
        'Campaign provisioning requires Ethereum Sepolia',
      );
    const data = encodeFunctionData({
      abi: KEIBO_CAMPAIGN_ESCROW_ABI,
      functionName: 'createCampaign',
      args: [
        params.asset,
        params.cap,
        params.deadline,
        params.milestoneAmounts,
      ],
    });
    try {
      await client.call({
        account: params.creator,
        to: config.escrow,
        data,
        value: 0n,
      });
    } catch (error) {
      throw new ConflictException(
        `Campaign creation would revert on Sepolia: ${this.rpcErrorMessage(error)}`,
      );
    }
    return {
      to: config.escrow,
      chainId: config.chainId,
      account: params.creator,
      data,
    };
  }

  async verifyRevertedCreation(
    hash: Hash,
    plan: { creator: Address; nonce: number; data: string; escrow: string },
  ) {
    if (!isHash(hash)) throw new ConflictException('Invalid transaction hash');
    const { client, config } = await this.readyClient();
    if (plan.escrow.toLowerCase() !== config.escrow.toLowerCase())
      throw new ConflictException('Signing plan belongs to another deployment');
    const [receipt, transaction] = await Promise.all([
      client.waitForTransactionReceipt({ hash, confirmations: 2 }),
      client.getTransaction({ hash }),
    ]);
    if (
      receipt.status !== 'reverted' ||
      transaction.from.toLowerCase() !== plan.creator.toLowerCase() ||
      transaction.to?.toLowerCase() !== config.escrow.toLowerCase() ||
      transaction.input.toLowerCase() !== plan.data.toLowerCase() ||
      transaction.nonce !== plan.nonce
    )
      throw new ConflictException(
        'Only the mined, reverted reserved transaction may be retried with a new nonce',
      );
  }

  async verifyCampaignCreation(
    hash: Hash,
    params: {
      creator: Address;
      asset: Address;
      cap: bigint;
      deadline: bigint;
      milestoneAmounts: bigint[];
    },
    expectedNonce: number,
  ): Promise<string> {
    if (!isHash(hash)) throw new ConflictException('Invalid transaction hash');
    const expected = await this.prepareCampaign(params);
    const { client, config } = await this.readyClient();
    const [receipt, transaction] = await Promise.all([
      client.waitForTransactionReceipt({ hash, confirmations: 2 }),
      client.getTransaction({ hash }),
    ]);
    const invalidProof = (reason: string) =>
      new ConflictException(
        `Transaction does not prove the requested creator campaign: ${reason}`,
      );
    if (receipt.status !== 'success') {
      let reason = 'transaction reverted';
      try {
        await client.call({
          account: transaction.from,
          to: transaction.to ?? undefined,
          data: transaction.input,
          value: transaction.value,
          blockNumber:
            receipt.blockNumber > 0n ? receipt.blockNumber - 1n : undefined,
        });
      } catch (error) {
        reason = `transaction reverted: ${this.rpcErrorMessage(error)}`;
      }
      throw invalidProof(reason);
    }
    if (transaction.to?.toLowerCase() !== expected.to.toLowerCase())
      throw invalidProof('escrow target mismatch');
    if (transaction.from.toLowerCase() !== params.creator.toLowerCase())
      throw invalidProof('creator sender mismatch');
    if (transaction.input.toLowerCase() !== expected.data.toLowerCase())
      throw invalidProof('campaign calldata mismatch');
    if (transaction.value !== 0n)
      throw invalidProof('unexpected native value');
    if (transaction.nonce !== expectedNonce)
      throw invalidProof(
        `reserved nonce mismatch (expected ${expectedNonce}, mined ${transaction.nonce})`,
      );
    for (const log of receipt.logs) {
      if (log.address.toLowerCase() !== config.escrow.toLowerCase()) continue;
      try {
        const decoded = decodeEventLog({
          abi: KEIBO_CAMPAIGN_ESCROW_ABI,
          data: log.data,
          topics: log.topics,
        });
        if (decoded.eventName !== 'CampaignCreated') continue;
        const event = decoded.args;
        if (
          event.creator.toLowerCase() !== params.creator.toLowerCase() ||
          event.asset.toLowerCase() !== params.asset.toLowerCase() ||
          event.cap !== params.cap ||
          event.deadline !== params.deadline
        )
          continue;
        const campaign = await this.getCampaign(event.campaignId.toString());
        if (
          campaign.creator.toLowerCase() !== params.creator.toLowerCase() ||
          campaign.asset.toLowerCase() !== params.asset.toLowerCase() ||
          campaign.cap !== params.cap ||
          campaign.deadline !== params.deadline ||
          campaign.state !== 0
        )
          throw new ConflictException(
            'Campaign is no longer funding or does not match',
          );
        return event.campaignId.toString();
      } catch (error) {
        if (error instanceof ConflictException) throw error;
      }
    }
    throw new ConflictException('Missing matching CampaignCreated evidence');
  }

  getRuntimeConfig() {
    return this.keiboConfig.getRequired();
  }

  async getCampaign(projectOnchainId: string) {
    const { client, config } = await this.readyClient();
    const campaign = (await client.readContract({
      address: config.escrow,
      abi: KEIBO_CAMPAIGN_ESCROW_ABI,
      functionName: 'campaigns',
      args: [this.uint(projectOnchainId, 'projectOnchainId')],
    })) as readonly [Address, Address, bigint, bigint, bigint, number];
    if (campaign[0] === '0x0000000000000000000000000000000000000000') {
      throw new ConflictException('KEIBO campaign does not exist');
    }
    return {
      creator: campaign[0],
      asset: campaign[1],
      cap: campaign[2],
      raised: campaign[3],
      deadline: campaign[4],
      state: campaign[5],
    };
  }

  async prepareContribution(params: {
    projectOnchainId: string;
    amount: bigint;
    currency: EscrowCurrency;
  }): Promise<{ to: Address; data: Hex }> {
    if (params.currency !== EscrowCurrency.USDC) {
      throw new ConflictException(
        'KEIBO escrow only supports its configured ERC-20 asset',
      );
    }
    if (params.amount <= 0n || params.amount > 2n ** 128n - 1n) {
      throw new ConflictException(
        'Contribution amount is outside uint128 range',
      );
    }
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'contribute',
        args: [
          this.uint(params.projectOnchainId, 'projectOnchainId'),
          params.amount,
        ],
      }),
    };
  }

  /** Verify mined receipt evidence; it does not reserve the hash in the ledger. */
  async verifyDepositTx(params: {
    hash: Hash;
    projectOnchainId: string;
    investor: Address;
    amount: bigint;
  }): Promise<boolean> {
    const campaignId = this.uint(params.projectOnchainId, 'projectOnchainId');
    const args = await this.eventArgs(params.hash, 'Contributed');
    const event = args as {
      campaignId?: bigint;
      contributor?: Address;
      amount?: bigint;
    };
    return (
      event.campaignId === campaignId &&
      event.contributor?.toLowerCase() === params.investor.toLowerCase() &&
      event.amount === params.amount
    );
  }

  /** Only the campaign-manager boundary can approve an evidenced milestone. */
  async approveMilestoneOnchain(params: {
    projectOnchainId: string;
    milestoneId: string;
    evidenceHash: Hex;
  }): Promise<Hash> {
    if (!/^0x[0-9a-fA-F]{64}$/.test(params.evidenceHash)) {
      throw new ConflictException('evidenceHash must be bytes32');
    }
    const { client, config } = await this.readyClient();
    const hash = await this.platformSigner.writeContract({
      address: config.escrow,
      abi: KEIBO_CAMPAIGN_ESCROW_ABI,
      functionName: 'approveMilestone',
      args: [
        this.uint(params.projectOnchainId, 'projectOnchainId'),
        this.uint(params.milestoneId, 'milestoneId'),
        params.evidenceHash,
      ],
    });
    await this.successfulReceipt(client, hash, 'milestone approval');
    return hash;
  }

  async prepareRelease(params: {
    projectOnchainId: string;
    milestoneId: string;
  }): Promise<{ to: Address; data: Hex }> {
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'releaseMilestone',
        args: [
          this.uint(params.projectOnchainId, 'projectOnchainId'),
          this.uint(params.milestoneId, 'milestoneId'),
        ],
      }),
    };
  }

  /** Verifies the creator's wallet transaction and the exact on-chain fee event. */
  async releaseOnchain(params: {
    transactionHash: Hash;
    projectOnchainId: string;
    milestoneId: string;
  }): Promise<{ creatorAmount: bigint; feeAmount: bigint }> {
    const event = (await this.eventArgs(
      params.transactionHash,
      'MilestoneReleased',
    )) as {
      campaignId?: bigint;
      milestoneId?: bigint;
      creatorAmount?: bigint;
      feeAmount?: bigint;
    };
    if (
      event.campaignId !==
        this.uint(params.projectOnchainId, 'projectOnchainId') ||
      event.milestoneId !== this.uint(params.milestoneId, 'milestoneId') ||
      event.creatorAmount === undefined ||
      event.feeAmount === undefined
    ) {
      throw new ConflictException(
        'Receipt does not prove the requested milestone release',
      );
    }
    return { creatorAmount: event.creatorAmount, feeAmount: event.feeAmount };
  }

  async prepareRefund(
    projectOnchainId: string,
  ): Promise<{ to: Address; data: Hex }> {
    const { config } = await this.readyClient();
    return {
      to: config.escrow,
      data: encodeFunctionData({
        abi: KEIBO_CAMPAIGN_ESCROW_ABI,
        functionName: 'refund',
        args: [this.uint(projectOnchainId, 'projectOnchainId')],
      }),
    };
  }

  async refundOnchain(params: {
    transactionHash: Hash;
    projectOnchainId: string;
    to: Address;
  }): Promise<bigint> {
    const event = (await this.eventArgs(
      params.transactionHash,
      'Refunded',
    )) as { campaignId?: bigint; contributor?: Address; amount?: bigint };
    if (
      event.campaignId !==
        this.uint(params.projectOnchainId, 'projectOnchainId') ||
      event.contributor?.toLowerCase() !== params.to.toLowerCase() ||
      event.amount === undefined
    ) {
      throw new ConflictException(
        'Receipt does not prove the requested contributor refund',
      );
    }
    return event.amount;
  }

  private async eventArgs(
    hash: Hash,
    expectedEvent: 'Contributed' | 'MilestoneReleased' | 'Refunded',
  ): Promise<unknown> {
    if (!isHash(hash)) throw new ConflictException('Invalid transaction hash');
    const { client, config } = await this.readyClient();
    try {
      const [receipt, transaction] = await Promise.all([
        client.waitForTransactionReceipt({ hash }),
        client.getTransaction({ hash }),
      ]);
      if (
        receipt.status !== 'success' ||
        transaction.to?.toLowerCase() !== config.escrow.toLowerCase()
      ) {
        throw new ConflictException(
          'Transaction did not succeed against KEIBO escrow',
        );
      }
      for (const log of receipt.logs) {
        if (log.address.toLowerCase() !== config.escrow.toLowerCase()) continue;
        try {
          const decoded = decodeEventLog({
            abi: KEIBO_CAMPAIGN_ESCROW_ABI,
            data: log.data,
            topics: log.topics,
          });
          if (decoded.eventName === expectedEvent) return decoded.args;
        } catch {
          /* unrelated receipt log */
        }
      }
      throw new ConflictException(
        `Missing ${expectedEvent} evidence in transaction receipt`,
      );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw this.rpcFailure(`verify ${expectedEvent} transaction`, error);
    }
  }

  private async readyClient() {
    const config = this.keiboConfig.getRequired();
    const client = createPublicClient({ transport: http(config.rpcUrl) });
    try {
      const [chainId, bytecode] = await Promise.all([
        client.getChainId(),
        client.getCode({ address: config.escrow }),
      ]);
      if (chainId !== config.chainId)
        throw new ServiceUnavailableException(
          'RPC chain ID does not match CHAIN_ID',
        );
      if (!bytecode || bytecode === '0x')
        throw new ServiceUnavailableException(
          'KEIBO escrow address has no deployed bytecode',
        );
      return { client, config };
    } catch (error) {
      if (error instanceof ServiceUnavailableException) throw error;
      throw this.rpcFailure('validate KEIBO escrow runtime', error);
    }
  }

  private async successfulReceipt(
    client: ReturnType<typeof createPublicClient>,
    hash: Hash,
    operation: string,
  ): Promise<void> {
    try {
      const receipt = await client.waitForTransactionReceipt({ hash });
      if (receipt.status !== 'success')
        throw new ConflictException(
          `KEIBO escrow ${operation} transaction reverted`,
        );
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      throw this.rpcFailure(operation, error);
    }
  }

  private uint(value: string, field: string): bigint {
    if (!/^(0|[1-9][0-9]*)$/.test(value))
      throw new ConflictException(`${field} must be an unsigned integer`);
    return BigInt(value);
  }

  private rpcErrorMessage(error: unknown): string {
    if (!error || typeof error !== 'object')
      return error instanceof Error ? error.message : 'unknown RPC failure';
    const candidate = error as {
      shortMessage?: unknown;
      details?: unknown;
      message?: unknown;
      cause?: { shortMessage?: unknown; details?: unknown; message?: unknown };
    };
    for (const value of [
      candidate.shortMessage,
      candidate.details,
      candidate.cause?.shortMessage,
      candidate.cause?.details,
      candidate.message,
      candidate.cause?.message,
    ]) {
      if (typeof value === 'string' && value.trim()) return value.trim();
    }
    return 'unknown RPC failure';
  }

  private rpcFailure(
    operation: string,
    error: unknown,
  ): ServiceUnavailableException {
    return new ServiceUnavailableException(
      `Unable to ${operation}: ${this.rpcErrorMessage(error)}`,
    );
  }
}
